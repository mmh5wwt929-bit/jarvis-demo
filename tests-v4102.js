'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.10.2 : « À GÉRER » FIABLE SUR UN VRAI AGENDA
 *                                                          node tests-v4102.js
 * ----------------------------------------------------------------------------
 * Vu en ligne le 27 sept (23 h 20 – 23 h 37) sur la v4.10.1 :
 *  R  [S95] après « Préparer une réponse » (session au rouge) et UN message
 *     tapé, plus aucune lecture déclenchée par un toucher ne passait :
 *     « à gérer », « Voir la conversation », « Vérifier dans mon agenda »,
 *     une 2e réponse, le point du jour → CONTEXTE_NON_DECLARE. Seul
 *     « Repartir au vert » débloquait.
 *  E  [S96] lecture en échec affichée « rien d'urgent » ; échec gardé 60 s.
 *  A  [S97] une des deux sources d'agenda non lue (iCloud / agenda JARVIS) :
 *     ignorée sans le dire → « Rien dans l'agenda », « Tu es libre ».
 *  N  [S98] compteurs : « Agenda (1) » pour « Rien… », « Mails (1) » pour une
 *     erreur ; carte verte même quand la lecture est incomplète.
 * Chaque test ECHOUE sur la v4.10.1, sauf ceux marques « garde » :
 *                                      JARVIS_DIR=../v4101 node tests-v4102.js
 * Serveur dans CE processus (faux Claude, faux Google, faux Gmail, faux
 * iCloud), horloges avancables ; la page dans jsdom.
 * ========================================================================== */
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { EventEmitter } = require('events');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v4102';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4530;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));
let avance = 0;
const vraiPerf = performance.now.bind(performance), vraiNow = Date.now;
performance.now = () => vraiPerf() + avance;
Date.now = () => vraiNow() + avance;
const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };

/* ---- Face ID (exige par la configuration de l'instance privee) ---- */
const EL = require(path.join(DIR, 'jarvis-elevation.js'));
const b64u = EL.b64u;
const { publicKey: pubFaceId } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwkF = pubFaceId.export({ format: 'jwk' });
const PASSKEY = b64u(JSON.stringify({ id: b64u(crypto.randomBytes(32)), x: jwkF.x, y: jwkF.y }));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const COMPTE = JSON.stringify({ type: 'service_account', project_id: 'jarvis-test', private_key_id: 'k', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'robot@jarvis-test.iam.gserviceaccount.com' });
const AGENDA_ID = 'agendajarvis4102@group.calendar.google.com';
const PORTEE_E = 'https://www.googleapis.com/auth/gmail.send', PORTEE_L = 'https://www.googleapis.com/auth/gmail.readonly';
const CLIENT = JSON.stringify({ web: { client_id: '1234567890-jarvistest.apps.googleusercontent.com', client_secret: 'GOCSPX-secret-de-test-4102' } });
const RT_E = '1//0g-rt-envoi-de-test-jarvis-4102', RT_L = '1//0g-rt-lecture-de-test-jarvis-4102';
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
      const id = '18c' + crypto.randomBytes(6).toString('hex');
      W.gmail.envoyes.push({ id, threadId: JSON.parse(corps || '{}').threadId || null });
      return [200, { id, threadId: JSON.parse(corps || '{}').threadId || id, labelIds: ['SENT'] }];
    }
    if (!tok.split(' ').includes(PORTEE_L)) return [403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }];
    if (/\/profile$/.test(u.pathname)) return [200, { emailAddress: MOI }];
    if (W.pannes.gmail) return [500, { error: { code: 500, message: 'backendError' } }];
    if (methode === 'GET' && /\/threads$/.test(u.pathname)) return [200, { threads: W.gmail.fils.map(f => ({ id: f.id })) }];
    const idF = (/\/threads\/([0-9a-f]+)$/.exec(u.pathname) || [])[1];
    if (idF) { const f = W.gmail.fils.find(x => x.id === idF); return f ? [200, { id: f.id, messages: f.messages.map(m => messageGmail(f, m)) }] : [404, { error: { code: 404 } }]; }
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
let IP = '90.1.1.1';
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

/* ---- la conversation vue en ligne : Match samedi, avec un rendez-vous propose ---- */
const FIL_MATCH = { id: '18f0000000000401', objet: 'Match samedi', messages: [
  { id: 'm01', de: 'Luc Martin <luc@club-hand.fr>', objet: 'Match samedi', date: Date.now() - 5 * J, texte: "Salut, le match est samedi à 10h. La cotisation est de 120 €." },
  { id: 'm02', de: 'JARVIS essai <' + MOI + '>', a: 'luc@club-hand.fr', objet: 'Re: Match samedi', date: Date.now() - 4 * J, moi: true, texte: "Merci Luc. Peux-tu me confirmer l'heure ?" },
  { id: 'm03', de: 'Luc Martin <luc@club-hand.fr>', objet: 'Re: Match samedi', date: Date.now() - 1 * J,
    texte: "Finalement c'est à 11h, et c'est 150 €. Pouvez-vous me confirmer votre présence ? On se voit " + nomJour(3) + " 14h pour en parler ?" }] };

const fatale = (e) => { log('ECHEC fatale : ' + (e && e.stack || e)); process.exit(1); };
process.on('unhandledRejection', fatale);
setTimeout(() => fatale('delai de 280 s depasse'), 280000);

(async () => {
  await dort(500);
  W.gmail.fils = [FIL_MATCH];

  /* ============================ R [S95] LECTURES DECLENCHEES PAR UN TOUCHER ============================ */
  IP = '90.2.2.1'; let sid = await session();
  const g0 = await gerer(sid);
  const itR = items(g0, 'Mails').find(x => (x.actions || []).includes('repondre')) || {};
  const itC = items(g0, 'Mails').find(x => x.type === 'creneau') || {};
  W.reponses.push(brouillon('Bonjour Luc,\n\nJe ne suis pas disponible à 14h.\n\nÀ bientôt.'));
  const r1 = itR.fil ? await appel('/api/mail/repondre', { sessionId: sid, jeton: itR.fil, consigne: 'dis-lui que je ne suis pas dispo à 14h' }) : {};
  /* le message tape vu en ligne (passe par le planificateur : le sceau de contexte nait) */
  const d1 = await dire(sid, "Ajoute l'événement à mon agenda pour mercredi 30", { action: 'AUCUNE' });
  const g1 = await gerer(sid);
  await t('R0', "garde : le décor est celui vu en ligne — une réponse préparée (session au ROUGE : contenu externe) puis un message tapé", async () =>
    ({ ok: !!r1.aRetaper && r1.plancher === 'CONTENT_DERIVED' && d1.status === 200, info: (r1.code || 'réponse prête') + ' ; plancher ' + r1.plancher + ' ; chat ' + d1.status }));
  await t('R1', "« à gérer » relu après ça : agenda ET boîte lus (avant : « Agenda non lu (CONTEXTE_NON_DECLARE) », « Boîte non lue : échec »)", async () =>
    ({ ok: !erreurs(g1).length && items(g1, 'Mails').some(x => x.type === 'creneau') && items(g1, 'Agenda').length > 0,
       info: erreurs(g1).map(x => x.texte).join(' | ').slice(0, 160) || resume(g1) }));
  const f1 = itR.fil ? await appel('/api/mail/fil', { sessionId: sid, jeton: itR.fil }) : {};
  await t('R2', "« Voir la conversation » : relue, par une lecture GOUVERNÉE (une transaction par fil)", async () =>
    ({ ok: f1.ok === true && (f1.messages || []).length === 3 && Array.isArray(f1.transactions) && f1.transactions.length === 1 && /^tx_/.test(String(f1.transactions[0])),
       info: (f1.code || '') + ' ' + String(f1.message || '').slice(0, 80) + ' ; tx ' + JSON.stringify(f1.transactions || null) }));
  const c1 = itC.fil ? await appel('/api/gerer/creneau', { sessionId: sid, jeton: itC.fil, index: itC.creneau }) : {};
  await t('R3', "« Vérifier dans mon agenda » : vérifié (avant : « Agenda non lu (CONTEXTE_NON_DECLARE) : je ne peux pas dire si tu es libre »)", async () =>
    ({ ok: c1.ok === true && c1.libre === true, info: (c1.code || '') + ' ' + String(c1.message || c1.libelle || '').slice(0, 90) }));
  W.reponses.push(brouillon('Bonjour Luc,\n\nJe confirme ma présence samedi à 11h.\n\nÀ bientôt.'));
  const r2 = itR.fil ? await appel('/api/mail/repondre', { sessionId: sid, jeton: itR.fil, consigne: 'confirme ma présence samedi à 11h' }) : {};
  await t('R4', "une 2e « Préparer une réponse » dans la même session : préparée (avant : « Conversation non relue »)", async () =>
    ({ ok: !!r2.aRetaper && /11h/.test(r2.aRetaper.texte || ''), info: (r2.code || '') + ' ' + String(r2.message || '').slice(0, 90) }));
  const p1 = await appel('/api/point-du-jour', { sessionId: sid, souvenirs: [] });
  await t('R5', "le point du jour demandé dans cette session : agenda lu (avant : « Le noyau a refusé la lecture (CONTEXTE_NON_DECLARE) »)", async () =>
    ({ ok: p1.ok === true && Array.isArray(p1.jours), info: (p1.code || '') + ' ' + String(p1.message || '').slice(0, 90) }));
  await t('R6', "garde : ces lectures ne blanchissent rien — la session reste au ROUGE (contenu externe), rien n'est parti", async () =>
    ({ ok: [g1, f1, c1, r2, p1].every(x => x.plancher === 'CONTENT_DERIVED') && W.gmail.envoyes.length === 0,
       info: [g1, f1, c1, r2, p1].map(x => x.plancher).join(',') + ' ; envoyés ' + W.gmail.envoyes.length }));
  /* garde : la couche elle-meme n'a pas change — un plan (non manuel) sans le bon sceau reste refuse */
  const P = require(path.join(DIR, 'jarvis-plus-5.29.js'));
  const { session: gC, entree: eC } = P.creerSessionGouvernee({ plafond: 100 });
  eC.soumettre('bonjour'); gC.promptDePlanification('bonjour', [], []);
  gC.ingerer({ origine: 'CONTENT_DERIVED', source: 'mail:fil-x', resume: 'Conversation « Match samedi »' });
  const dC = gC.demander({ action: 'READ', resource: 'MAIL', target: 'fils' });
  await t('R7', "garde : dans la couche, un plan sans le sceau de contexte reste refusé (CONTEXTE_NON_DECLARE) — seules les lectures du serveur, déclenchées par un toucher, passent", async () =>
    ({ ok: dC.decide === 'REFUSE' && dC.motif === 'CONTEXTE_NON_DECLARE', info: dC.decide + ' ' + dC.motif }));

  /* ============================ A [S97] UNE DES DEUX SOURCES D'AGENDA NON LUE ============================ */
  IP = '90.3.3.1'; sid = await session();
  W.agenda = [{ id: 'e3', summary: 'Kiné', start: { dateTime: new Date(parisMs(3, 13, 30)).toISOString() }, end: { dateTime: new Date(parisMs(3, 15, 0)).toISOString() } },
    { id: 'e4', summary: 'Entraînement U18', start: { dateTime: new Date(parisMs(0, 18, 0)).toISOString() }, end: { dateTime: new Date(parisMs(0, 20, 0)).toISOString() } }];
  W.pannes.jarvis = true;
  const gA = await gerer(sid);
  const agA = items(gA, 'Agenda');
  await t('A1', "agenda JARVIS en panne, iCloud lu : « à gérer » le DIT (« agenda JARVIS non lu ») au lieu de « Rien dans l'agenda aujourd'hui ni demain »", async () =>
    ({ ok: agA.some(x => x.type === 'erreur' && /agenda JARVIS/.test(x.texte)) && !agA.some(x => /^Rien dans l'agenda aujourd'hui ni demain\.$/.test(x.texte)) && gA.incomplet === true && !/rien d'urgent/.test(resume(gA)),
       info: agA.map(x => x.type + ':' + x.texte).join(' | ').slice(0, 170) + ' ; ' + resume(gA) }));
  const itCA = items(gA, 'Mails').find(x => x.type === 'creneau') || {};
  const cA = itCA.fil ? await appel('/api/gerer/creneau', { sessionId: sid, jeton: itCA.fil, index: itCA.creneau }) : {};
  await t('A2', "« Vérifier dans mon agenda » avec l'agenda JARVIS non lu : JAMAIS « Tu es libre » (ton Kiné de 13h30 y est) — refus clair qui nomme l'agenda non lu", async () =>
    ({ ok: cA.ok === false && cA.libre === undefined && /agenda JARVIS/.test(cA.message || '') && /si tu es libre/.test(cA.message || ''),
       info: cA.ok + ' ; libre ' + cA.libre + ' ; ' + String(cA.message || '').slice(0, 110) }));
  W.pannes.jarvis = false;
  const cA2 = itCA.fil ? await appel('/api/gerer/creneau', { sessionId: sid, jeton: itCA.fil, index: itCA.creneau }) : {};
  const gA2 = await gerer(sid);
  await t('A3', "garde : les deux agendas lus → conflit vu (Kiné), 15:00 proposé ; « à gérer » : l'entraînement du jour, aucune erreur", async () =>
    ({ ok: cA2.ok === true && cA2.libre === false && /Kiné/.test((cA2.conflits || [])[0] || '') && / à 15:00$/.test(cA2.autre || '')
        && items(gA2, 'Agenda').some(x => /Entraînement U18/.test(x.texte)) && !erreurs(gA2).length,
       info: JSON.stringify([cA2.conflits, cA2.autre]) + ' ; ' + items(gA2, 'Agenda').map(x => x.texte).join(' | ').slice(0, 80) }));

  /* ============================ E [S96] ECHEC ≠ « RIEN D'URGENT » ============================ */
  IP = '90.4.4.1'; sid = await session();
  W.agenda = [];
  W.pannes = { jarvis: true, ical: true, gmail: true };
  avance += 6 * 60 * 1000;   /* le module iCal garde une lecture reussie 5 min : on la laisse expirer */
  const gE = await gerer(sid);
  await t('E1', "agenda ET boîte en échec : le résumé ne dit JAMAIS « rien d'urgent » — « lecture incomplète », et la carte le signale (incomplet)", async () =>
    ({ ok: erreurs(gE).length >= 2 && !/rien d'urgent/.test(resume(gE)) && /incompl/.test(resume(gE)) && gE.incomplet === true,
       info: resume(gE) + ' ; erreurs ' + erreurs(gE).length + ' ; incomplet ' + gE.incomplet }));
  W.pannes = { jarvis: false, ical: false, gmail: false };
  avance += 31 * 1000;   /* au-dela des 30 s ou le module iCal garde un echec, en deca des 60 s du cache « à gérer » */
  const gE2 = await gerer(sid, false);
  await t('E2', "un échec n'est pas gardé en cache : « Voir » (sans relecture forcée) 31 s plus tard relit tout (avant : l'échec restait affiché 60 s)", async () =>
    ({ ok: !erreurs(gE2).length && !gE2.incomplet && items(gE2, 'Mails').some(x => x.type === 'creneau'), info: resume(gE2) + ' ; erreurs ' + erreurs(gE2).map(x => x.texte).join(' | ').slice(0, 120) }));
  const gE3 = await gerer(sid, false);
  await t('E3', "garde : une lecture RÉUSSIE reste en cache (même session, sans relecture forcée : pas de 2e lecture de la boîte)", async () => {
    const avant = W.gmail.appels.length; const g = await gerer(sid, false);
    return { ok: W.gmail.appels.length === avant && JSON.stringify(g.sections) === JSON.stringify(gE3.sections), info: 'appels Gmail ' + (W.gmail.appels.length - avant) };
  });

  /* ============================ N [S98] COMPTEURS ============================ */
  IP = '90.5.5.1'; sid = await session();
  W.gmail.fils = []; W.agenda = [];
  const gN = await gerer(sid);
  await t('N1', "« Rien dans l'agenda… » et « Rien dans tes conversations… » sont marqués vides (le compteur de la page affiche 0, pas 1)", async () =>
    ({ ok: items(gN, 'Agenda').length === 1 && items(gN, 'Agenda')[0].vide === true && items(gN, 'Mails').length === 1 && items(gN, 'Mails')[0].vide === true && resume(gN) === "rien d'urgent",
       info: JSON.stringify((gN.sections || []).map(s => s.items.map(i => i.type + (i.vide ? '/vide' : '')))) + ' ; ' + resume(gN) }));

  /* ============================ PAGE (jsdom) ============================ */
  const pagesT = [];
  let JS = null; try { JS = require(process.env.JSDOM || 'jsdom'); } catch { JS = null; }
  const HTML = (() => { try { return fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'); } catch { return ''; } })();
  const page = async ({ prive = false } = {}) => {
    const vcj = new JS.VirtualConsole(); const err = []; vcj.on('jsdomError', (e) => err.push(e.message));
    const dom = new JS.JSDOM(HTML, { url: 'http://localhost:1/', runScripts: 'dangerously', virtualConsole: vcj, pretendToBeVisual: true,
      beforeParse(w) {
        if (prive) w.localStorage.setItem('jarvis_cle', CLE);
        w.fetch = async (url) => {
          const u = String(url);
          const j = u.includes('/api/session') ? { sessionId: 's1', ...(prive ? { acces: 'protege' } : {}) } : {};
          return { ok: true, status: 200, headers: new w.Headers({ 'content-type': 'application/json' }), json: async () => j, text: async () => JSON.stringify(j), clone() { return this; } };
        };
        w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
      } });
    await dort(300);
    return { w: dom.window, d: dom.window.document, err };
  };
  if (JS) {
    const echec = { date: 'lundi 28 septembre', resume: "lecture incomplète : rien n'est garanti", incomplet: true, regle: 'z', sections: [
      { titre: 'Agenda', items: [{ type: 'erreur', texte: 'Agenda non lu (HTTP_503).', certitude: 'fait' }] },
      { titre: 'Mails', items: [{ type: 'mail', vide: true, texte: 'Rien dans tes conversations des 14 derniers jours ne demande ton attention.', certitude: 'deduction' },
        { type: 'reponse', texte: 'Réponse attendue — « Match samedi »', certitude: 'deduction', fil: 'fl_00000000-0000-4000-8000-000000000001', actions: ['voir'] }] }] };
    const vide = { date: 'lundi 28 septembre', resume: "rien d'urgent", regle: 'z', sections: [
      { titre: 'Agenda', items: [{ type: 'agenda', vide: true, texte: "Rien dans l'agenda aujourd'hui ni demain.", certitude: 'fait' }] }] };
    const Pp = await page({ prive: true }); pagesT.push(Pp);
    const Pd = await page(); pagesT.push(Pd);
    for (const Pg of [Pp, Pd]) { Pg.w.eval('afficherGerer')(echec); Pg.w.eval('afficherGerer')(vide); }
    const cartes = (Pg) => [...Pg.d.querySelectorAll('#fil .decision.gerer')];
    const [ePp, vPp] = cartes(Pp).slice(-2), [ePd, vPd] = cartes(Pd).slice(-2);
    const comptes = (c) => c ? [...c.querySelectorAll('.gerer-section > summary .code')].map(x => x.textContent).join(' ') : '';
    await t('N2', "page (instance privée) : compteurs honnêtes — « Agenda (non lu) », « Mails (1) » (le « Rien… » ne compte pas) ; « Agenda (0) » quand il n'y a rien", async () =>
      ({ ok: comptes(ePp) === '(non lu) (1)' && comptes(vPp) === '(0)', info: comptes(ePp) + ' / ' + comptes(vPp) }));
    await t('N3', "page : lecture incomplète → carte ORANGE (« attente »), jamais verte ; lecture complète → verte — sur l'instance privée ET la démo", async () =>
      ({ ok: [ePp, ePd].every(c => c && c.classList.contains('attente') && !c.classList.contains('autorise')) && [vPp, vPd].every(c => c && c.classList.contains('autorise')),
         info: [ePp, vPp, ePd, vPd].map(c => c ? c.className : 'absente').join(' | ') }));
    await t('N4', 'garde : aucune erreur de script', async () => ({ ok: pagesT.every(P => !P.err.length), info: pagesT.map(P => P.err[0]).filter(Boolean).join(' | ').slice(0, 120) }));
  } else await t('N0', 'jsdom absent (npm install --no-save jsdom)', async () => ({ ok: false }));
  for (const Pg of pagesT) Pg.w.close();

  /* ============================ H VERSION ============================ */
  const h = await appel('/health');
  await t('H1', '/health : passerelle v4.10.2', async () => ({ ok: h.passerelle === 'v4.10.2', info: h.passerelle }));

  /* ============================ RESULTATS ============================ */
  log('JARVIS v4.10.2 (' + DIR + ')\n');
  for (const x of R) log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(5) + x.nom + (x.info !== undefined ? '  [' + x.info + ']' : ''));
  const ko = R.filter(x => !x.ok).length;
  log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
  process.exit(ko ? 1 : 0);
})().catch(fatale);
