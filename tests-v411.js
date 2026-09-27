'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.11 : « AUJOURD'HUI », DES POINTS QUI DESCENDENT,
 *          DES TITRES QUE TU AS ÉCRITS                     node tests-v411.js
 * ----------------------------------------------------------------------------
 * Vu en ligne le 28 sept (0 h 25 – 1 h 03) sur la v4.10.1 / v4.10.2 :
 *  T  [S99] titre d'un événement jamais pris hors de tes mots (« Ajoute
 *     l'événement… mercredi 30 » → « hand » tiré des souvenirs ; « Ajoute
 *     même choses tout les vendredis… » → « Même choses tout ») ; [S100]
 *     rédaction échouée (« Dacc ») : dire quoi écrire.
 * Chaque test ECHOUE sur la v4.10.2, sauf ceux marques « garde » :
 *                                      JARVIS_DIR=../v4102 node tests-v411.js
 * Serveur dans CE processus (faux Claude, faux Google, faux Gmail, faux
 * iCloud), horloges avancables ; la page dans jsdom.
 * ========================================================================== */
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { EventEmitter } = require('events');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v411';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4540;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));
let avance = 0;
const vraiPerf = performance.now.bind(performance), vraiNow = Date.now;
performance.now = () => vraiPerf() + avance;
Date.now = () => vraiNow() + avance;
const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };

/* ---- Face ID (exige par la configuration de l'instance privee) ---- */
const EL = require(path.join(DIR, 'jarvis-elevation.js'));
const b64u = EL.b64u, sha = (b) => crypto.createHash('sha256').update(b).digest();
const { privateKey: cleFaceId, publicKey: pubFaceId } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const idCle = crypto.randomBytes(32), jwkF = pubFaceId.export({ format: 'jwk' });
const PASSKEY = b64u(JSON.stringify({ id: b64u(idCle), x: jwkF.x, y: jwkF.y }));
let compteur = 0;
function signerFaceId(challenge, rp = 'localhost') {
  const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://' + rp, crossOrigin: false }));
  const c = Buffer.alloc(4); c.writeUInt32BE(++compteur);
  const ad = Buffer.concat([sha(Buffer.from(rp)), Buffer.from([0x05]), c]);
  return { id: b64u(idCle), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(crypto.sign('sha256', Buffer.concat([ad, sha(cd)]), cleFaceId)) };
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const COMPTE = JSON.stringify({ type: 'service_account', project_id: 'jarvis-test', private_key_id: 'k', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'robot@jarvis-test.iam.gserviceaccount.com' });
const AGENDA_ID = 'agendajarvis411@group.calendar.google.com';
const PORTEE_E = 'https://www.googleapis.com/auth/gmail.send', PORTEE_L = 'https://www.googleapis.com/auth/gmail.readonly';
const CLIENT = JSON.stringify({ web: { client_id: '1234567890-jarvistest.apps.googleusercontent.com', client_secret: 'GOCSPX-secret-de-test-411' } });
const RT_E = '1//0g-rt-envoi-de-test-jarvis-411', RT_L = '1//0g-rt-lecture-de-test-jarvis-411';
const MOI = 'jarvis.essai@gmail.com';

/* ---- le temps de Paris, calcule ICI ---- */
const J = 86400000;
const parisParts = (ms) => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value; return p; };
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const parisMs = (jourDecal, h, mi) => {
  const p = parisParts(Date.now() + jourDecal * J); const voulu = Date.UTC(+p.year, +p.month - 1, +p.day, h, mi); let g = voulu;
  for (let i = 0; i < 3; i++) { const q = parisParts(g); g += voulu - Date.UTC(+q.year, +q.month - 1, +q.day, (+q.hour) % 24, +q.minute); }
  return g;
};
const nomJour = (decal) => JOURS[new Date(parisMs(decal, 12, 0)).getUTCDay()];

/* ---- LE MONDE EXTERIEUR : Claude, Google Agenda, Gmail, iCloud ---- */
/* un anniversaire annuel dans 10 jours (jamais « aujourd'hui ni demain », quel que soit le jour du test) */
const jourAnniv = (d) => { const p = parisParts(Date.now() + d * J); return '2020' + p.month + p.day; };
const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iCloud//EN', 'BEGIN:VEVENT', 'UID:anniv-1', 'DTSTART;VALUE=DATE:' + jourAnniv(10), 'DTEND;VALUE=DATE:' + jourAnniv(11),
  'RRULE:FREQ=YEARLY', 'SUMMARY:Anniversaire Aylin', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
const W = { plans: [], reponses: [], conv: [], agenda: [], crees: new Map(), pannes: { jarvis: false, ical: false, gmail: false }, ical: 0,
  gmail: { jetons: { [RT_E]: PORTEE_E, [RT_L]: PORTEE_L }, envoyes: [], appels: [], fils: [] } };
const b64 = (x) => Buffer.from(x, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const messageGmail = (f, m) => ({ id: m.id, threadId: f.id, internalDate: String(m.date), labelIds: m.moi ? ['SENT'] : ['INBOX', 'UNREAD'],
  payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: m.de }, { name: 'To', value: m.a || MOI },
    { name: 'Subject', value: m.objet || f.objet }, { name: 'Message-ID', value: '<' + m.id + '@mail.test>' }]
    .concat(m.repondreA ? [{ name: 'Reply-To', value: m.repondreA }] : []).concat(m.references ? [{ name: 'References', value: m.references }] : []),
    parts: [{ mimeType: 'text/plain', body: { data: b64(m.texte) } }] } });
function repondre(methode, u, corps, entetes) {
  if (u.hostname === 'api.anthropic.com') {
    const c = JSON.parse(corps || '{}');
    if (c.max_tokens === 200 && !c.system) { const p = W.plans.shift() || { action: 'AUCUNE' }; return [200, { content: [{ type: 'text', text: JSON.stringify(p) }] }]; }
    W.conv.push({ system: c.system || '', messages: c.messages || [] });
    const x = W.reponses.shift();
    return [200, { content: [{ type: 'text', text: x == null ? 'Réponse.' : x }], usage: {} }];
  }
  if (u.hostname === 'agenda.test') { W.ical++; return W.pannes.ical ? [503, 'indisponible', true] : [200, ICS, true]; }
  if (u.hostname === 'oauth2.googleapis.com') {
    const q = new URLSearchParams(corps || '');
    if (q.get('grant_type') !== 'refresh_token') return [200, { access_token: 'ya29.agenda', expires_in: 3600 }];
    const sc = W.gmail.jetons[q.get('refresh_token')];
    if (sc === undefined) return [400, { error: 'invalid_grant' }];
    return [200, { access_token: 'at|' + sc, expires_in: 3599, scope: sc }];
  }
  if (u.hostname === 'gmail.googleapis.com') {
    const tok = String((entetes || {}).Authorization || '').replace(/^Bearer at\|/, '');
    W.gmail.appels.push({ type: 'api', methode, path: u.pathname, search: u.search, jeton: tok });
    if (methode === 'POST' && /\/messages\/send$/.test(u.pathname)) {
      const id = '18c' + crypto.randomBytes(6).toString('hex'), tid = JSON.parse(corps || '{}').threadId || null;
      const brut = Buffer.from(String(JSON.parse(corps || '{}').raw || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      W.gmail.envoyes.push({ id, threadId: tid, a: ((/^To:\s*(.*)$/mi.exec(brut) || [])[1] || '').trim() });
      const fil = tid && W.gmail.fils.find(f => f.id === tid);   /* la reponse entre dans SA conversation, comme chez Gmail */
      if (fil) fil.messages.push({ id: 'e' + id.slice(3), de: 'JARVIS essai <' + MOI + '>', a: 'luc@club-hand.fr', objet: 'Re: ' + fil.objet, date: Date.now(), moi: true, texte: 'Réponse envoyée par JARVIS.' });
      return [200, { id, threadId: JSON.parse(corps || '{}').threadId || id, labelIds: ['SENT'] }];
    }
    if (!tok.split(' ').includes(PORTEE_L)) return [403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }];
    if (/\/profile$/.test(u.pathname)) return [200, { emailAddress: MOI }];
    if (W.pannes.gmail) return [500, { error: { code: 500, message: 'backendError' } }];
    if (methode === 'GET' && /\/threads$/.test(u.pathname)) return [200, { threads: W.gmail.fils.map(f => ({ id: f.id })) }];
    const idF = (/\/threads\/([0-9a-f]+)$/.exec(u.pathname) || [])[1];
    if (idF) { const f = W.gmail.fils.find(x => x.id === idF); return f ? [200, { id: f.id, messages: f.messages.map(m => messageGmail(f, m)) }] : [404, { error: { code: 404 } }]; }
    const idM = (/\/messages\/([0-9a-f]+)$/.exec(u.pathname) || [])[1];
    const e = idM && W.gmail.envoyes.find(x => x.id === idM);
    if (e) return [200, { id: e.id, threadId: e.threadId, labelIds: ['SENT'], payload: { headers: [{ name: 'To', value: e.a }] } }];
    return [404, { error: { code: 404 } }];
  }
  if (u.hostname === 'www.googleapis.com') {
    const id = decodeURIComponent(u.pathname.split('/events/')[1] || '');
    if (methode === 'GET' && !id) {
      if (W.pannes.jarvis) return [500, { error: { code: 500, message: 'backendError', errors: [{ reason: 'backendError' }] } }];
      return [200, { kind: 'calendar#events', accessRole: 'writer', items: W.agenda.concat([...W.crees.values()].map(e => ({ ...e, status: 'confirmed' }))) }];
    }
    if (methode === 'POST') { const b = JSON.parse(corps || '{}'); W.crees.set(b.id, b); return [200, { id: b.id, status: 'confirmed' }]; }
    if (methode === 'GET') { const e = W.crees.get(id); return e ? [200, { ...e, status: 'confirmed' }] : [404, { error: { code: 404 } }]; }
    if (methode === 'DELETE') { W.crees.delete(id); return [204, null]; }
  }
  return [404, {}];
}
function fausse(url, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  let u;
  if (typeof url === 'object' && !(url instanceof URL)) { opts = url; u = new URL('https://' + url.hostname + (url.path || '/')); }
  else u = new URL(String(url));
  const q = new EventEmitter(); let corps = '';
  q.write = (x) => { corps += x; }; q.setTimeout = () => q; q.destroy = () => q;
  q.end = (x) => { if (x) corps += x;
    setTimeout(() => {
      const [st, json, brut] = repondre((opts && opts.method) || 'GET', u, corps, (opts && opts.headers) || {});
      const r = new EventEmitter(); r.statusCode = st; r.headers = {}; r.complete = true; r.resume = () => {}; cb(r);
      if (json != null) r.emit('data', Buffer.from(brut ? json : JSON.stringify(json)));
      r.emit('end'); r.emit('close'); }, 2); };
  return q;
}
https.request = fausse;
https.get = (url, opts, cb) => { const q = fausse(url, opts, cb); q.end(); return q; };

Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', PORT: String(PORT), JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: '731904582614',
  JARVIS_PASSKEYS: PASSKEY, JARVIS_GOOGLE_COMPTE: COMPTE, JARVIS_AGENDA_JARVIS: AGENDA_ID, JARVIS_AGENDA_ICAL: 'https://agenda.test/perso.ics',
  JARVIS_GMAIL_CLIENT: CLIENT, JARVIS_GMAIL_ENVOI: RT_E, JARVIS_GMAIL_LECTURE: RT_L, JARVIS_MAIL_AUTORISES: 'luc@club-hand.fr', JARVIS_MAIL_PLAFOND: '20',
  JARVIS_APPELS_HEURE: '2000', JARVIS_APPELS_JOUR: '100000', JARVIS_ACTIONS_HEURE: '5000' });
for (const k of ['JARVIS_CONFIG_ATTENDUE', 'JARVIS_HISTORIQUE']) delete process.env[k];
const log = console.log; console.log = () => {}; console.error = () => {};
require(path.join(DIR, 'server.js'));
const B = 'http://localhost:' + PORT;
let IP = '91.1.1.1';
const appel = async (chemin, corps, methode) => {
  const r = await fetch(B + chemin, { method: methode || (corps ? 'POST' : 'GET'), body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, 'X-Jarvis-Cle': CLE } });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
  return { status: r.status, ...j };
};
const session = async () => (await appel('/api/session', {})).sessionId;
const dire = (sid, message, plan) => { if (plan) W.plans.push(plan); return appel('/api/chat', { sessionId: sid, message }); };
const gerer = (sid, frais = true) => appel('/api/gerer', { sessionId: sid, souvenirs: [], frais });
const items = (g, titre) => ((g.sections || []).find(x => x.titre === titre) || { items: [] }).items;
const erreurs = (g) => (g.sections || []).flatMap(x => x.items || []).filter(x => x.type === 'erreur');
const brouillon = (texte) => JSON.stringify({ objet: 'x', texte });
const resume = (g) => String(g.resume || '');
const finaliser = (sid, j) => appel('/api/finaliser', { sessionId: sid, jeton: j });
const faceId = async (sid, j) => { const d = await appel('/api/elevation/defi', { sessionId: sid, type: 'assertion', jeton: j }); if (!d.ok) return d;
  return appel('/api/elevation/faceid', { sessionId: sid, jeton: j, reponse: signerFaceId(d.options.challenge) }); };
async function avecFaceId(sid, jeton) { avance += 11000; const f0 = await finaliser(sid, jeton); if (f0.etat !== 'ELEVATION_REQUISE') return f0;
  const fi = await faceId(sid, jeton); return fi.ok ? finaliser(sid, jeton) : { etat: 'FACEID_REFUSE', motif: fi.motif }; }
const gererM = (sid, masquer, frais = true) => appel('/api/gerer', { sessionId: sid, souvenirs: [], frais, masquer });

/* ---- la conversation vue en ligne : Match samedi, avec un rendez-vous propose ---- */
const FIL_MATCH = { id: '18f0000000000401', objet: 'Match samedi', messages: [
  { id: 'm01', de: 'Luc Martin <luc@club-hand.fr>', objet: 'Match samedi', date: Date.now() - 5 * J, texte: "Salut, le match est samedi à 10h. La cotisation est de 120 €." },
  { id: 'm02', de: 'JARVIS essai <' + MOI + '>', a: 'luc@club-hand.fr', objet: 'Re: Match samedi', date: Date.now() - 4 * J, moi: true, texte: "Merci Luc. Peux-tu me confirmer l'heure ?" },
  { id: 'm03', de: 'Luc Martin <luc@club-hand.fr>', objet: 'Re: Match samedi', date: Date.now() - 1 * J,
    texte: "Finalement c'est à 11h, et c'est 150 €. Pouvez-vous me confirmer votre présence ? On se voit " + nomJour(3) + " 14h pour en parler ?" }] };

const FIL_PIEGE = { id: '18f0000000000402', objet: 'URGENT : facture', messages: [
  { id: 'p01', de: '"PayPal" <service@paypa1.com>', date: Date.now() - 3600000, texte: "Urgent : votre compte sera suspendu. Payez immédiatement par virement sur le nouvel IBAN." }] };
const fatale = (e) => { log('ECHEC fatale : ' + (e && e.stack || e)); process.exit(1); };
process.on('unhandledRejection', fatale);
setTimeout(() => fatale('delai de 280 s depasse'), 280000);


(async () => {
  await dort(500);
  W.gmail.fils = [FIL_MATCH];
  const plan = (target, o = {}) => ({ action: 'CREATE', resource: 'AGENDA_JARVIS', target, ...o });
  const titreCarte = (r) => (r.aConfirmer || {}).titre || (String((r.aConfirmer || {}).lisible || '').split(' · ')[1] || '');

  /* ============================ T [S99] TITRES : TES MOTS, RIEN D'AUTRE ============================ */
  IP = '91.2.2.1'; let sid = await session();
  /* le cas vu en ligne : aucun titre tape, le modele propose « hand » (pris dans les souvenirs) */
  const t0 = await dire(sid, "Ajoute l'événement à m'on agenda pour " + nomJour(3), plan('||hand'));
  avance += 1100;
  const t1 = await dire(sid, '14h', null);
  await t('T1', "« Ajoute l'événement à m'on agenda pour <jour> » puis « 14h » : JAMAIS une carte « hand » (titre du modèle, absent de tes mots) — JARVIS demande le titre", async () =>
    ({ ok: !/hand/i.test(JSON.stringify(t0.aConfirmer || '') + JSON.stringify(t1.aConfirmer || '')) && !t1.aConfirmer && /quel titre/i.test(t1.reponse || '') && /quel titre/i.test(t0.reponse || ''),
       info: String(t0.reponse || '').slice(0, 70) + ' | ' + String(t1.reponse || '').slice(0, 70) + ' | carte ' + JSON.stringify((t1.aConfirmer || {}).lisible || null) }));
  avance += 1100;
  const t2 = await dire(sid, 'RDV Luc', null);
  await t('T2', "réponse au « Quel titre ? » : la carte porte TON titre (« RDV Luc »), le jour et l'heure tapés, et le titre est donné à part (en gros sur la carte)", async () =>
    ({ ok: (t2.aConfirmer || {}).titre === 'RDV Luc' && /14:00/.test((t2.aConfirmer || {}).lisible || '') && new RegExp(nomJour(3)).test((t2.aConfirmer || {}).lisible || ''), info: JSON.stringify(t2.aConfirmer || t2.reponse).slice(0, 140) }));
  IP = '91.2.2.2'; sid = await session();
  const t3a = await dire(sid, "Ajoute l'événement pour " + nomJour(3), plan('||hand'));
  avance += 1100;
  const t3 = await dire(sid, '14h RDV Luc', null);
  await t('T3', "« 14h RDV Luc » en une réponse : la carte « RDV Luc » tout de suite (la question demandait l'heure ET le titre)", async () =>
    ({ ok: titreCarte(t3) === 'RDV Luc' && /quel titre/i.test(t3a.reponse || ''), info: String(t3a.reponse || '').slice(0, 80) + ' | ' + JSON.stringify(t3.aConfirmer || t3.reponse).slice(0, 100) }));
  IP = '91.2.2.3'; sid = await session();
  const t4 = await dire(sid, 'Ajoute entraînement U18 ' + nomJour(3) + ' à 18h', plan('||Entraînement U18'));
  const t4b = await dire(sid, 'Ajoute match ' + nomJour(4) + ' à 11h', plan('||Match de championnat'));
  await t('T4', "garde : le titre du modèle qui reprend TES mots est gardé tel quel (« Entraînement U18 », accents et majuscules du modèle)", async () =>
    ({ ok: titreCarte(t4) === 'Entraînement U18', info: titreCarte(t4) }));
  await t('T4b', "un titre enrichi par le modèle (« Match de championnat » pour « ajoute match … ») → tes mots seulement (« Match »)", async () =>
    ({ ok: titreCarte(t4b) === 'Match', info: titreCarte(t4b) }));
  /* « meme chose » : la serie du mercredi est creee, puis « Ajoute même choses tout les vendredis… » */
  IP = '91.2.2.4'; sid = await session();
  const fin = "jusqu'au " + (() => { const p = parisParts(Date.now() + 70 * J); return +p.day + ' ' + ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][+p.month - 1]; })();
  const s1 = await dire(sid, 'Ajoute hand tous les mercredis de 18h à 22h ' + fin, null);
  const s1c = s1.aConfirmer ? await appel('/api/confirmer', { sessionId: sid, action: 'CREATE', resource: 'AGENDA_JARVIS', cible: s1.aConfirmer.cible }) : {};
  avance += 1100;
  const s2 = await dire(sid, 'Ajoute même choses tout les vendredis de 18h à 22h ' + fin, null);   /* une serie : lue par le serveur, sans modele */
  await t('T5', "« Ajoute même choses tout les vendredis… » après la série « Hand » : titre « Hand » (repris, et c'est DIT sur la carte), jamais « Même choses tout »", async () =>
    ({ ok: (s1c.decision || {}).etape === 'COMPLET' && titreCarte(s2) === 'Hand' && ((s2.aConfirmer || {}).avertissements || []).some(x => /même titre que ta création précédente/.test(x)) && (s2.aConfirmer || {}).serie > 1,
       info: JSON.stringify((s1c.decision || {}).etape || s1c.erreur || null) + ' ; ' + JSON.stringify(s2.aConfirmer ? [titreCarte(s2), s2.aConfirmer.avertissements] : s2.reponse).slice(0, 160) }));
  IP = '91.2.2.5'; sid = await session();
  const s3 = await dire(sid, 'Ajoute même chose tous les vendredis de 18h à 22h ' + fin, null);
  await t('T6', "« même chose » sans création précédente dans la session : « Quel titre ? » (ni « Même chose », ni un titre du modèle)", async () =>
    ({ ok: !s3.aConfirmer && /quel titre/i.test(s3.reponse || ''), info: JSON.stringify(s3.aConfirmer ? s3.aConfirmer.lisible : s3.reponse).slice(0, 120) }));

  /* ============================ R [S100] REDACTION ECHOUEE ============================ */
  IP = '91.3.3.1'; sid = await session();
  const gR = await gerer(sid);
  const itR = items(gR, 'Mails').find(x => (x.actions || []).includes('repondre')) || {};
  W.reponses.push("Pouvez-vous préciser ce que vous voulez répondre ?");   /* le modele repond hors format */
  const rR = itR.fil ? await appel('/api/mail/repondre', { sessionId: sid, jeton: itR.fil, consigne: 'Dacc' }) : {};
  await t('R1', "« Dacc » que le modèle ne sait pas rédiger : rien n'est préparé, et JARVIS dit QUOI écrire (« en une phrase, par exemple « d'accord pour samedi 11h » »)", async () =>
    ({ ok: rR.ok === false && !rR.aRetaper && /Dacc/.test(rR.message || '') && /en une phrase/.test(rR.message || ''), info: String(rR.message || rR.code).slice(0, 140) }));

  /* ============================ G [S101] LES POINTS DESCENDENT ============================ */
  const FIL_G = () => ({ id: '18f0000000000501', objet: 'Match samedi', messages: FIL_MATCH.messages.map(m => ({ ...m, id: m.id.replace('m', 'g') })) });
  W.gmail.fils = [FIL_G()];
  IP = '91.4.4.1'; sid = await session();
  const g0 = await gerer(sid);
  const mG = items(g0, 'Mails'), types0 = mG.map(x => x.type).sort().join(',');
  const itRep = mG.find(x => x.type === 'reponse') || {};
  W.reponses.push(brouillon('Bonjour Luc,\n\nJe serai présent samedi à 11h.\n\nÀ bientôt.'));
  const rG = itRep.fil ? await appel('/api/mail/repondre', { sessionId: sid, jeton: itRep.fil, consigne: 'dis-lui que je serai présent samedi à 11h' }) : {};
  const rtG = rG.aRetaper ? await appel('/api/mail/retaper', { sessionId: sid, jeton: rG.aRetaper.jeton, adresse: 'luc@club-hand.fr' }) : {};
  const finG = rtG.decision && rtG.decision.jetonAnnulation ? await avecFaceId(sid, rtG.decision.jetonAnnulation) : {};
  const g1 = await gerer(sid, false);   /* « Voir » juste après : sans relecture forcée */
  const mG1 = items(g1, 'Mails');
  await t('G1', "ta réponse envoyée (vrai envoi, Face ID) retire les points de la conversation — répondre, rendez-vous proposé, montants et horaires « à vérifier » — même sans relecture forcée", async () =>
    ({ ok: /contradiction/.test(types0) && /creneau/.test(types0) && /reponse/.test(types0) && finG.envoye === true
        && !mG1.some(x => ['reponse', 'creneau', 'contradiction'].includes(x.type)) && resume(g1) === "rien d'urgent",
       info: 'avant ' + types0 + ' ; envoi ' + (finG.envoye || finG.etat || rG.code) + ' ; après ' + mG1.map(x => x.type + (x.vide ? '/vide' : '')).join(',') + ' ; ' + resume(g1) }));
  const filG = W.gmail.fils[0];
  filG.messages.push({ id: 'g09', de: 'Luc Martin <luc@club-hand.fr>', objet: 'Re: Match samedi', date: Date.now(), texte: 'Super. On se voit ' + nomJour(5) + ' 15h pour les licences ?' });
  avance += 1100;
  const g2 = await gerer(sid);
  await t('G2', "garde : un NOUVEAU message de Luc (nouveau rendez-vous, nouvelle question) fait revenir les points", async () =>
    ({ ok: items(g2, 'Mails').some(x => x.type === 'creneau' && /15:00/.test(x.texte)) && items(g2, 'Mails').some(x => x.type === 'reponse'),
       info: items(g2, 'Mails').map(x => x.type).join(',') }));
  /* les cles : stables, et masquees quand la page les renvoie */
  W.gmail.fils = [FIL_MATCH, FIL_PIEGE];
  IP = '91.4.4.2'; sid = await session();
  const k1 = await gerer(sid);
  const sid2 = await session(); const k2 = await gerer(sid2);
  const cles1 = items(k1, 'Mails').map(x => x.cle), cles2 = items(k2, 'Mails').map(x => x.cle);
  await t('G3', "chaque point porte une clé (20 hex) — la même d'une lecture à l'autre et d'une session à l'autre ; aucune adresse, aucun objet dedans", async () =>
    ({ ok: cles1.length >= 4 && cles1.every(c => /^[0-9a-f]{20}$/.test(c || '')) && new Set(cles1).size === cles1.length && JSON.stringify(cles1) === JSON.stringify(cles2),
       info: cles1.length + ' clés ; ' + JSON.stringify(cles1.slice(0, 2)) }));
  const itC0 = items(k1, 'Mails').find(x => x.type === 'creneau') || {}, itS0 = items(k1, 'Mails').find(x => x.type === 'suspect') || {};
  const m1 = await gererM(sid, [itC0.cle, itS0.cle, 'pas-une-cle', 'ffffffffffffffffffff', 42]);
  await t('G4', "« Fait » / « Plus tard » : les clés envoyées par la page masquent CES points (compte « masques ») ; une clé inconnue ou mal formée ne fait rien", async () =>
    ({ ok: m1.masques === 2 && !items(m1, 'Mails').some(x => x.cle === itC0.cle || x.cle === itS0.cle) && items(m1, 'Mails').length === items(k1, 'Mails').length - 2 && m1.aTraiter === k1.aTraiter - 2,
       info: 'masques ' + m1.masques + ' ; ' + items(k1, 'Mails').length + ' → ' + items(m1, 'Mails').length + ' ; à traiter ' + k1.aTraiter + ' → ' + m1.aTraiter }));
  const cS0 = await appel('/api/gerer/rappel', { sessionId: sid, jeton: itS0.fil });
  await t('G5', "garde : masquer un mail suspect ne donne rien — « Me le rappeler » y reste refusé", async () =>
    ({ ok: cS0.ok === false && cS0.code === 'CONVERSATION_SUSPECTE', info: cS0.code }));
  const pM = await appel('/api/point-du-jour', { sessionId: sid, souvenirs: [], masquer: [itC0.cle, itS0.cle] });
  const pN = await appel('/api/point-du-jour', { sessionId: await session(), souvenirs: [] });
  await t('G6', "le point du jour compte les mails SANS les points masqués (ligne « Mails : … » et nombre)", async () =>
    ({ ok: !!pM.mails && !!pN.mails && pM.mails.nb === pN.mails.nb - 2 && !/suspect/.test(pM.mails.ligne) && /suspect/.test(pN.mails.ligne), info: (pN.mails || {}).ligne + ' → ' + (pM.mails || {}).ligne }));
  const cT = await appel('/api/chat', { sessionId: sid, message: "qu'est-ce que j'ai à gérer ?", masquer: [itC0.cle] });
  await t('G7', "« qu'est-ce que j'ai à gérer ? » tapé : les points marqués restent masqués (la liste part avec le message)", async () =>
    ({ ok: !!cT.gerer && cT.gerer.masques === 1 && !items(cT.gerer, 'Mails').some(x => x.cle === itC0.cle), info: 'masques ' + (cT.gerer || {}).masques }));
  /* une creation relue tout de suite dans « à gérer » (sans attendre 60 s) */
  W.gmail.fils = []; W.agenda = [];
  IP = '91.4.4.3'; sid = await session();
  const a0 = await gerer(sid);
  const cA = await dire(sid, 'Ajoute kiné demain à 17h', plan('||Kiné'));
  const cA2 = cA.aConfirmer ? await appel('/api/confirmer', { sessionId: sid, action: 'CREATE', resource: 'AGENDA_JARVIS', cible: cA.aConfirmer.cible }) : {};
  const a1 = await gerer(sid, false);
  await t('G8', "un événement créé apparaît AUSSITÔT dans « à gérer » (avant : l'ancienne lecture restait 60 s)", async () =>
    ({ ok: (cA2.decision || {}).etape === 'COMPLET' && !items(a0, 'Agenda').some(x => /Kiné/.test(x.texte)) && items(a1, 'Agenda').some(x => /Kiné/.test(x.texte)),
       info: ((cA2.decision || {}).etape || '') + ' ; ' + items(a1, 'Agenda').map(x => x.texte).join(' | ').slice(0, 100) }));

  /* ============================ H VERSION ============================ */
  const h = await appel('/health');
  await t('H1', '/health : passerelle v4.11', async () => ({ ok: h.passerelle === 'v4.11.0', info: h.passerelle }));

  /* ============================ RESULTATS ============================ */
  log('JARVIS v4.11 (' + DIR + ')\n');
  for (const x of R) log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(5) + x.nom + (x.info !== undefined ? '  [' + x.info + ']' : ''));
  const ko = R.filter(x => !x.ok).length;
  log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
  process.exit(ko ? 1 : 0);
})().catch(fatale);
