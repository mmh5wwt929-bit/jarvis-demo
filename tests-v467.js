'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.6.7 : TOUT FAIT VERIFIABLE VIENT DU SERVEUR
 *                                                           node tests-v467.js
 * ----------------------------------------------------------------------------
 * Les defauts vus en ligne le 26 sept (v4.6.6), rejoues avec un faux Claude
 * qui fait EXACTEMENT les erreurs observees, et un faux Google :
 *  A « Supprimer » tape -> « C'est fait » sans rien supprimer
 *  B « J'ai quoi demain ? » -> 0 evenement (agenda JARVIS jamais lu)
 *  C « Et dimanche ? » -> le 28 annonce dimanche ; « hand mercredi » -> 7 oct
 *  D diagnostic « lecture seule » alors que l'ecriture marche
 *  E « je peux seulement lire » / « un seul evenement a la fois »
 *  F « Quel jour sommes-nous ? » -> la date d'un souvenir
 *  G « Ajoute hand mercredi » (sans heure) -> 18:00 -> 19:30 inventes
 * Chaque test ECHOUE sur la v4.6.6, sauf ceux marques « garde ».
 *   JARVIS_DIR=../v466 node tests-v467.js   -> doit echouer
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v467';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4167;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };
const log = console.log;
const serveurs = [];
const fatale = (e) => { log('ECHEC fatale : ' + (e && e.message || e)); for (const x of serveurs) { const t = x.sortie(); if (/Error|at /.test(t)) log(t.slice(-1500)); } process.exit(1); };
process.on('unhandledRejection', fatale);
setTimeout(() => fatale('delai de 150 s depasse'), 150000);
const exiger = (nom) => { try { return require(path.join(DIR, nom)); } catch { return null; } };
/* sur une ancienne version, une fonction absente fait ECHOUER le test, jamais la suite */
const essai = async (f, defaut) => { try { return await f(); } catch { return defaut; } };

/* ---- le calendrier, calcule ICI sans le module teste ---- */
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const parisAuj = () => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day); };
const jour = (plus) => new Date(parisAuj() + plus * 86400000);                       /* minuit UTC du jour civil */
const iso = (d) => d.toISOString().slice(0, 10);
const nomJour = (d) => JOURS[d.getUTCDay()];
const prochain = (w) => { const a = jour(0).getUTCDay(); return jour(((w - a + 7) % 7) || 7); };   /* strictement apres aujourd'hui */
const MERCREDI = prochain(3);

/* ---- compte de service de test ---- */
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const COMPTE = JSON.stringify({ type: 'service_account', project_id: 'jarvis-test', private_key_id: 'k', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'robot@jarvis-test.iam.gserviceaccount.com' });
const AGENDA_ID = 'agendajarvis42@group.calendar.google.com';

/* ---- faux Claude + faux Google + faux iCal, pilotes par un fichier ---- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-v467-'));
const SC = path.join(TMP, 'scenario.json'), JO = path.join(TMP, 'journal.jsonl'), PRE = path.join(TMP, 'precharge.js');
const scenario = (o) => fs.writeFileSync(SC, JSON.stringify(o));
const journal = () => { try { return fs.readFileSync(JO, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const viderJournal = () => fs.writeFileSync(JO, '');
fs.writeFileSync(PRE, `'use strict';
const https = require('https'); const fs = require('fs'); const { EventEmitter } = require('events');
const SC = ${JSON.stringify(SC)}, JO = ${JSON.stringify(JO)};
const lire = () => { try { return JSON.parse(fs.readFileSync(SC, 'utf8')); } catch { return {}; } };
const noter = (x) => fs.appendFileSync(JO, JSON.stringify(x) + '\\n');
const crees = new Map();
function repondre(methode, u, corps) {
  const sc = lire();
  if (u.hostname === 'api.anthropic.com') {
    const b = JSON.parse(corps || '{}');
    if (!b.system) {   /* le planificateur : le plan du scenario dont la cle figure dans la demande (la plus longue) */
      const p = typeof b.messages[0].content === 'string' ? b.messages[0].content : '';
      noter({ type: 'plan', prompt: p });
      /* seulement la demande de CE message (le prompt contient aussi les precedentes) */
      const dem = p.split("Demande de l'utilisateur :\\n").pop().trim();
      let best = null; for (const k of Object.keys(sc.plans || {})) if (dem.includes(k) && (!best || k.length > best.length)) best = k;
      return [200, { content: [{ type: 'text', text: JSON.stringify(best ? sc.plans[best] : { action: 'AUCUNE' }) }] }];
    }
    noter({ type: 'conv', system: b.system, messages: b.messages });
    return [200, { content: [{ type: 'text', text: sc.reponse || "D'accord." }], usage: {} }];
  }
  if (u.hostname === 'oauth2.googleapis.com') return [200, { access_token: 'ya29.X', expires_in: 3600 }];
  if (u.hostname === 'www.googleapis.com') {
    noter({ type: 'google', methode, path: u.pathname, query: u.search });
    const id = decodeURIComponent(u.pathname.split('/events/')[1] || '');
    if (methode === 'GET' && !id) {
      if (sc.jarvisStatut) return [sc.jarvisStatut, { error: { code: sc.jarvisStatut, message: 'Forbidden', errors: [{ reason: 'forbidden' }] } }];
      return [200, { kind: 'calendar#events', ...(sc.accessRole === null ? {} : { accessRole: sc.accessRole || 'writer' }), items: sc.jarvisItems || [] }];
    }
    if (methode === 'POST') { const b = JSON.parse(corps || '{}'); crees.set(b.id, b); return [200, { id: b.id, status: 'confirmed' }]; }
    if (methode === 'GET') { const e = crees.get(id); return e ? [200, { ...e, status: 'confirmed' }] : [404, { error: { code: 404 } }]; }
    if (methode === 'DELETE') { crees.delete(id); return [204, null]; }
  }
  if (u.hostname === 'agenda.test') return [200, sc.ics || 'BEGIN:VCALENDAR\\nEND:VCALENDAR\\n', true];
  return [404, {}];
}
function fausse(url, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (typeof url === 'object' && !(url instanceof URL)) { opts = url; url = 'https://' + url.hostname + (url.path || '/'); }
  const u = new URL(String(url)); const q = new EventEmitter(); let corps = '';
  q.write = (c) => { corps += c; }; q.setTimeout = () => q; q.destroy = () => q;
  q.end = (c) => { if (c) corps += c; setTimeout(() => {
    const [st, json, brut] = repondre((opts && opts.method) || 'GET', u, corps);
    const r = new EventEmitter(); r.statusCode = st; r.headers = {}; r.complete = true; r.resume = () => {}; cb(r);
    if (json != null) r.emit('data', Buffer.from(brut ? json : JSON.stringify(json)));
    r.emit('end'); r.emit('close'); }, 3); };
  return q;
}
https.request = fausse;
https.get = (url, opts, cb) => { const q = fausse(url, opts, cb); q.end(); return q; };
`);

let port = PORT;
async function lancer(env) {
  const p = port++;
  const enfant = spawn(process.execPath, ['-r', PRE, 'server.js'], { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'test', PORT: String(p), JARVIS_APPELS_HEURE: '500', ...env } });   /* beaucoup de messages depuis une seule IP */
  let sortie = ''; enfant.stdout.on('data', (d) => { sortie += d; }); enfant.stderr.on('data', (d) => { sortie += d; });
  const cle = env.JARVIS_CLE_ACCES || '';
  const entetes = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '94.7.7.' + (p % 200), ...(cle ? { 'X-Jarvis-Cle': cle } : {}) };
  const req = async (methode, chemin, corps) => {
    const r = await fetch('http://localhost:' + p + chemin, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(8000) });
    const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; } return { status: r.status, ...j };
  };
  let sante = null;
  for (let i = 0; i < 100 && !sante && enfant.exitCode === null; i++) { await dort(100); try { const h = await req('GET', '/api/health'); if (h.passerelle) sante = h; } catch { /* pas encore */ } }
  const sid = (await req('POST', '/api/session')).sessionId;
  const chat = (message) => req('POST', '/api/chat', { sessionId: sid, message });
  const x = { sante, req, chat, sid, sortie: () => sortie, arreter: () => enfant.kill() };
  serveurs.push(x);
  return x;
}
const conv = () => journal().filter(x => x.type === 'conv');
const plansJ = () => journal().filter(x => x.type === 'plan');

(async () => {
  const V = exiger('jarvis-verite.js') || {};
  const EC = exiger('jarvis-ecriture.js');

  /* =========================== M : MODULES =========================== */
  const sam = Date.parse('2026-09-26T00:15:00Z');   /* samedi 26 sept, 2h15 a Paris */
  await t('M1', "C : « mercredi » tapé le samedi 26 sept = mercredi 30 sept (pas le 7 oct) ; « dimanche » = le 27", async () => {
    const a = V.resoudreDates('Ajoute hand mercredi', sam).dates[0], b = V.resoudreDates('Et dimanche ?', sam).dates[0];
    return { ok: a.iso === '2026-09-30' && b.iso === '2026-09-27' && /^dimanche 27 septembre/.test(b.libelle), info: a.iso + ' ' + b.libelle };
  });
  await t('M2', "C : « mercredi » tapé un mercredi = le mercredi SUIVANT, signalé ; « aujourd'hui » = le jour même", async () => {
    const mer = Date.parse('2026-09-30T10:00:00Z');
    const a = V.resoudreDates('hand mercredi', mer).dates[0], b = V.resoudreDates("hand aujourd'hui", mer).dates[0];
    return { ok: a.iso === '2026-10-07' && a.ambigu === true && b.iso === '2026-09-30', info: a.iso + (a.ambigu ? ' (signalé)' : '') + ' / ' + b.iso };
  });
  await t('M3', "C : « dimanche 28 septembre » écrit par le modèle → corrigé en « lundi », et la correction est rendue", async () => {
    const c = V.corrigerJours('Dimanche 28 septembre, tu es libre.', Date.parse('2026-09-26T10:00:00Z'));
    return { ok: c.texte.startsWith('Lundi 28 septembre') && c.corrections.length === 1, info: c.texte };
  });
  await t('M4', "G : heures lues dans les mots tapés — rien, 18h, 18h-19h30, « pendant 1h30 », deux heures = ambigu, « après-midi » n'est pas midi", async () => {
    const h = (x) => V.resoudreHeures(x);
    const a = h('Ajoute hand mercredi'), b = h('ajoute hand mercredi à 18h'), c = h('hand mercredi 18h-19h30'), d = h('test demain à 10h pendant 1h30'),
      e = h('à 10h ou 11h'), f = h('entraînement U18 jeudi'), g = h('réunion demain après-midi');
    return { ok: !a.debut && b.debut.h === 18 && b.duree === null && c.duree === 90 && d.debut.h === 10 && d.duree === 90 && e.ambigu && !f.debut && !g.debut,
      info: [a, b, c, d, e, f, g].map(x => x.debut ? x.debut.h + ':' + x.debut.mi + '/' + x.duree : '—' + (x.ambigu ? '?' : '')).join(' ') };
  });
  await t('M5', "A : « C'est fait », « j'ai supprimé l'événement » retirés ; négation, question, futur et texte gardés", async () => {
    const r = V.retirerAffirmations("C'est fait. J'ai supprimé l'événement de ton agenda. Veux-tu autre chose ?");
    const g = ["Je n'ai rien supprimé.", "Veux-tu que je supprime l'événement ?", "Je vais te proposer une carte.", "J'ai ajouté un exemple à ma réponse."]
      .map(x => V.retirerAffirmations(x).retirees.length);
    return { ok: r.retirees.length === 2 && /Veux-tu autre chose/.test(r.texte) && g.every(n => n === 0), info: r.retirees.length + ' retirées ; gardes ' + g.join('') };
  });
  await t('M6', "A/E : « Supprimer » seul = suppression nue, « supprime le fichier x.pdf » non ; série reconnue, question sur une série non", async () =>
    ({ ok: V.suppressionNue('Supprimer') && V.suppressionNue('annule ça stp') && !V.suppressionNue('supprime le fichier rapport.pdf')
         && V.demandeSerie("Ajoute sur mon calendrier que tous les mercredis et vendredis j'ai handball") && V.demandeSerie('Ajoute hand tous les mercredis')
         && !V.demandeSerie("qu'est-ce que j'ai tous les mercredis ?") && !V.demandeSerie('ajoute hand mercredi à 18h') && !V.demandeSerie('ajoute toutes les infos au mail'),
       info: 'ok' }));
  await t('M12', "A : sans demande d'action, « Voilà, c'est fait : » (sous un texte reformulé) est gardé ; une action nommée reste retirée", async () => {
    const a = V.retirerAffirmations("Voilà, c'est fait :\nLe texte reformulé.", { strict: false }), b = V.retirerAffirmations("C'est fait, j'ai supprimé l'événement.", { strict: false });
    return { ok: a.retirees.length === 0 && b.retirees.length === 1 && V.demandeAction('supprime ça') && !V.demandeAction('Reformule ce paragraphe'), info: a.retirees.length + ' / ' + b.retirees.length };
  });
  await t('M7', "F : « Quel jour sommes-nous ? » répondu sans modèle ; « à quelle heure est mon rendez-vous ? » laissé au modèle", async () => {
    const x = V.questionDate('Quel jour sommes-nous ?', sam), y = V.questionDate('à quelle heure est mon rendez-vous ?', Date.now());
    return { ok: x === 'Nous sommes le samedi 26 septembre 2026.' && y === null, info: x };
  });

  const googleM = { accessRole: 'reader', items: [] };
  const transportM = async (methode, url) => { const u = new URL(url);
    if (u.hostname === 'oauth2.googleapis.com') return { ok: true, status: 200, texte: JSON.stringify({ access_token: 'j', expires_in: 3600 }) };
    if (methode === 'GET' && /\/events\?/.test(url)) return { ok: true, status: 200, texte: JSON.stringify({ accessRole: googleM.accessRole, items: googleM.items, ...(googleM.suite ? { nextPageToken: 'x' } : {}) }) };
    if (methode === 'POST') return { ok: true, status: 200, texte: '{}' };
    return { ok: true, status: 404, texte: '{}' }; };
  const mod = EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA_ID, transport: transportM });
  const d1 = await essai(() => mod.diagnostic(), { etapes: [] });
  await t('M8', "D : accessRole « reader » → valeur brute rendue, verdict ECRITURE_NON_CONFIRMEE (plus « lecture seule »)", async () =>
    ({ ok: d1.code === 'ECRITURE_NON_CONFIRMEE' && d1.acces === 'reader' && d1.etapes[2].valeur === 'reader' && d1.etapes[2].ok === null, info: d1.code + ' ' + d1.acces }));
  const tx = 'tx_' + crypto.randomUUID();
  await essai(() => mod.creer(mod.permis({ action: 'CREATE', resource: 'AGENDA_JARVIS', target: mod.validerCible(iso(jour(2)) + 'T10:00|30|Test').cle, transactionId: tx })));
  await dort(20);
  const d2 = await essai(() => mod.diagnostic(), {});
  await t('M9', "D : après une création réelle réussie, le diagnostic dit PRET (écriture prouvée), même si accessRole reste « reader »", async () =>
    ({ ok: d2.ok === true && d2.code === 'PRET' && d2.prouvee === true && d2.acces === 'reader' && !d2.recent, info: d2.code + ' prouvee=' + d2.prouvee }));
  googleM.items = [
    { id: 'a', status: 'confirmed', summary: 'Hand', start: { dateTime: iso(jour(1)) + 'T16:00:00Z' }, end: { dateTime: iso(jour(1)) + 'T17:30:00Z' }, extendedProperties: { private: { jarvisTx: tx } } },
    { id: 'b', status: 'cancelled', summary: 'Annulé', start: { dateTime: iso(jour(1)) + 'T08:00:00Z' }, end: { dateTime: iso(jour(1)) + 'T09:00:00Z' } },
    { id: 'c', status: 'confirmed', summary: 'Tournoi <script>', start: { date: iso(jour(1)) }, end: { date: iso(jour(3)) } }];
  googleM.suite = true;
  const pl = await essai(() => mod.permisLecture({ action: 'READ', resource: 'AGENDA', target: iso(jour(1)) + '..' + iso(jour(2)), transactionId: 'tx_' + crypto.randomUUID() }), null);
  const l1 = await essai(() => mod.lister(pl), { evenements: [] }), l2 = await essai(() => mod.lister(pl), {});
  let refus = ''; try { mod.permisLecture({ action: 'CREATE', resource: 'AGENDA_JARVIS', target: 'x' }); } catch (e) { refus = e.message; }
  await t('M10', "B : lister() — annulés ignorés, journée entière (fin exclusive → incluse), titre nettoyé, page suivante = incomplet, marque JARVIS", async () => {
    const [h, c] = [l1.evenements.find(e => e.titre === 'Hand'), l1.evenements.find(e => e.journee)];
    return { ok: l1.ok && l1.evenements.length === 2 && h.parJarvis && c.debut === iso(jour(1)) && c.fin === iso(jour(2)) && !/[<>]/.test(c.titre) && l1.tronque,
      info: l1.evenements.map(e => e.titre + ' ' + e.debut + '→' + e.fin).join(' | ') };
  });
  await t('M11', "B : permis de lecture à usage unique, et seulement d'un READ AGENDA", async () =>
    ({ ok: l2.ok === false && l2.code === 'PERMIS_DEJA_UTILISE' && refus === 'PERMIS_REFUSE' && (await mod.lister({ lecture: true })).code === 'PERMIS_INCONNU', info: l2.code + ' ' + refus }));

  /* =========================== S : SERVEUR =========================== */
  scenario({}); viderJournal();
  const D3 = jour(3), D3ms = Date.parse(iso(D3) + 'T08:00:00Z');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:r1@test', 'DTSTAMP:20260101T000000Z',
    'DTSTART:' + iso(D3).replace(/-/g, '') + 'T080000Z', 'DTEND:' + iso(D3).replace(/-/g, '') + 'T090000Z', 'SUMMARY:Réunion', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const srv = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_GOOGLE_COMPTE: COMPTE, JARVIS_AGENDA_JARVIS: AGENDA_ID, JARVIS_AGENDA_ICAL: 'https://agenda.test/basic.ics' });
  await t('S0', 'passerelle v4.6.7, agenda et écriture actifs', async () =>
    ({ ok: srv.sante && /^v4\.(6\.7|[7-9]\.\d+)$/.test(srv.sante.passerelle) && srv.sante.agenda === 'actif' && srv.sante.ecriture === 'actif', info: srv.sante && srv.sante.passerelle }));

  /* F */
  viderJournal();
  const f1 = await srv.chat('Quel jour sommes-nous ?');
  await t('S1', "F : « Quel jour sommes-nous ? » → le serveur répond la date du jour, sans appeler le modèle", async () =>
    ({ ok: f1.etape === 'SERVEUR' && f1.reponse && f1.reponse.includes(' ' + jour(0).getUTCDate() + ' ') && f1.reponse.includes(nomJour(jour(0))) && conv().length === 0 && plansJ().length === 0,
       info: (f1.reponse || f1.etape) + ' ; appels ' + journal().length }));
  scenario({ reponse: 'Bonjour !' }); viderJournal();
  await srv.chat('bonjour');
  const sys1 = (conv()[0] || {}).system || '';
  await t('S2', "F : le modèle de conversation reçoit la date et l'heure du serveur, et l'interdiction de la déduire d'un souvenir", async () =>
    ({ ok: sys1.includes("aujourd'hui = " + nomJour(jour(0))) && sys1.includes(iso(jour(0))) && /souvenir/.test(sys1.split('DATE ET HEURE')[1] || ''), info: (sys1.match(/aujourd'hui = [^;.]*/) || ['absente'])[0] }));
  await t('S3', "E : écriture active → le prompt dit « créer UN événement », plus « Tu ne peux ni créer », et interdit d'expliquer la configuration", async () =>
    ({ ok: /créer UN événement/.test(sys1) && !/Tu ne peux ni créer/.test(sys1) && /n'explique jamais comment un compte/.test(sys1), info: /Tu ne peux ni créer/.test(sys1) ? 'ancienne phrase présente' : 'ok' }));

  /* E : series */
  viderJournal();
  const e1 = await srv.chat("Ajoute sur mon calendrier que tous les mercredis et vendredis j'ai handball");
  const e2 = await srv.chat('Ajoute hand tous les mercredis');
  /* [v4.8] les series existent : la reponse reste celle du SERVEUR, sans modele
   * (deux jours -> « un seul jour par semaine » ; sans heure ni fin -> la question) */
  await t('S4', "E : deux demandes de série → réponses du serveur, sans modèle, ni « seulement lire » ni rien d'inventé", async () =>
    ({ ok: e1.motif === 'SERIE_PLUSIEURS_JOURS' && e2.motif === 'SERIE_INCOMPLETE' && e1.etape === 'SERVEUR' && e2.etape === 'SERVEUR' && conv().length === 0 && plansJ().length === 0,
       info: (e1.motif || e1.etape) + ' / ' + (e2.motif || e2.etape) }));

  /* G + C : creation */
  const planFaux = { action: 'CREATE', resource: 'AGENDA_JARVIS', target: iso(jour(11)) + 'T18:00|90|Hand' };   /* date fausse, heure et duree inventees */
  scenario({ plans: { 'Ajoute hand mercredi': planFaux } }); viderJournal();
  const g1 = await srv.chat('Ajoute hand mercredi');
  await t('S5', "G : « Ajoute hand mercredi » (sans heure), le modèle invente 18:00→19:30 → PAS de carte, « À quelle heure ? »", async () =>
    ({ ok: !g1.aConfirmer && g1.motif === 'HEURE_ABSENTE' && /^À quelle heure/.test(g1.reponse || ''), info: (g1.decide || '') + ' ' + (g1.motif || '') + ' ' + (g1.aConfirmer ? g1.aConfirmer.lisible : '') }));
  const g2 = await srv.chat('18h');
  const attendu = iso(MERCREDI) + 'T18:00|60|Hand';
  await t('S6', "G + C : réponse « 18h » → carte du mercredi " + iso(MERCREDI) + " à 18:00, 1 h par défaut DITE (ni le 7 oct, ni 19:30)", async () =>
    ({ ok: g2.aConfirmer && g2.aConfirmer.cible === attendu && /par défaut/.test((g2.aConfirmer.avertissements || []).join(' ')) && g2.aConfirmer.lisible.startsWith(nomJour(MERCREDI)),
       info: g2.aConfirmer ? g2.aConfirmer.cible + ' — ' + g2.aConfirmer.lisible : (g2.motif || g2.etape) }));
  scenario({ plans: { 'Ajoute hand mercredi de 18h à 19h30': planFaux } });
  const g3 = await srv.chat('Ajoute hand mercredi de 18h à 19h30');
  await t('S7', "C : le modèle propose le " + iso(jour(11)) + " → la carte suit les mots tapés (" + iso(MERCREDI) + ", 90 min) et le signale", async () =>
    ({ ok: g3.aConfirmer && g3.aConfirmer.cible === iso(MERCREDI) + 'T18:00|90|Hand' && g3.corrige && g3.corrige.modele.startsWith(iso(jour(11))),
       info: g3.aConfirmer ? g3.aConfirmer.cible + ' corrigé=' + JSON.stringify(g3.corrige) : (g3.motif || g3.etape) }));
  scenario({ plans: { 'Ajoute hand à 18h': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: iso(jour(1)) + 'T18:00|60|Hand' } } });
  const g4 = await srv.chat('Ajoute hand à 18h');
  await t('S8', "G : jour non écrit (le modèle choisit demain) → « Quel jour ? », pas de carte", async () =>
    ({ ok: !g4.aConfirmer && g4.motif === 'JOUR_ABSENT', info: (g4.motif || g4.etape) }));
  await srv.chat('bonjour');   /* la question est perimee : un message sans rapport passe */
  const g5 = await srv.chat('18h');
  await t('S9', "garde : une réponse « 18h » qui n'arrive pas juste après la question ne crée rien", async () =>
    ({ ok: !g5.aConfirmer && g5.decide === 'SANS_OBJET', info: g5.decide + ' ' + (g5.motif || '') }));
  scenario({ plans: { 'Ajoute hand mercredi': planFaux } });
  await srv.chat('Ajoute hand mercredi');
  scenario({ plans: { 'ajoute réunion jeudi à 9h': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: '||Réunion' } } });
  const g6 = await srv.chat('ajoute réunion jeudi à 9h');
  await t('S10', "G : après « À quelle heure ? », une NOUVELLE demande de création n'est pas mélangée à la précédente", async () =>
    ({ ok: g6.aConfirmer && g6.aConfirmer.cible === iso(prochain(4)) + 'T09:00|60|Réunion', info: g6.aConfirmer ? g6.aConfirmer.cible : (g6.motif || g6.etape) }));
  scenario({ reponse: "C'est fait, j'ai ajouté la réunion à ton agenda." }); viderJournal();
  const g7 = await srv.chat('Ajoute réunion demain à 10h');
  await t('S11', "G : création demandée mais pas préparée par le modèle → le serveur le dit, sans modèle (aucun « c'est fait »)", async () =>
    ({ ok: g7.motif === 'CREATION_NON_PREPAREE' && conv().length === 0 && !/C'est fait/.test(g7.reponse || ''), info: (g7.motif || g7.etape) + ' ' + (g7.reponse || '').slice(0, 50) }));

  /* A : creer, puis « Supprimer » tape */
  const demain10 = iso(jour(1)) + 'T10:00|30|Test';
  scenario({ plans: { 'Ajoute un test demain à 10h pendant 30 minutes': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: demain10 } } });
  const a0 = await srv.chat('Ajoute un test demain à 10h pendant 30 minutes');
  const a1 = await srv.req('POST', '/api/confirmer', { sessionId: srv.sid, action: 'CREATE', resource: 'AGENDA_JARVIS', cible: a0.aConfirmer && a0.aConfirmer.cible });
  const txA = a1.decision && a1.decision.transactionId;
  await t('S12', "garde : création confirmée d'un geste → « confirmé par Google » (le parcours validé en ligne reste intact)", async () =>
    ({ ok: a0.aConfirmer && a0.aConfirmer.cible === demain10 && a1.decision && a1.decision.etape === 'COMPLET' && !!txA, info: a1.decision ? a1.decision.etape : a1.erreur }));
  scenario({ reponse: "C'est fait, j'ai supprimé l'événement." }); viderJournal();
  const a2 = await srv.chat('Supprimer');
  const deleteAvant = journal().filter(x => x.type === 'google' && x.methode === 'DELETE').length;
  await t('S13', "A : « Supprimer » tapé → le SERVEUR montre la vraie carte (l'événement créé), sans modèle ; rien n'est supprimé avant le toucher", async () =>
    ({ ok: Array.isArray(a2.aSupprimer) && a2.aSupprimer.length === 1 && a2.aSupprimer[0].transactionId === txA && conv().length === 0 && plansJ().length === 0 && deleteAvant === 0,
       info: JSON.stringify(a2.aSupprimer || a2.reponse).slice(0, 90) }));
  const a2b = await srv.chat('supprime le test de demain');
  await t('S14', "A : « supprime le test de demain » (titre nommé) → la même carte", async () =>
    ({ ok: Array.isArray(a2b.aSupprimer) && a2b.aSupprimer[0].transactionId === txA, info: a2b.motif || a2b.etape }));
  const a3 = await srv.req('POST', '/api/compenser', { sessionId: srv.sid, transactionId: txA });
  const a4 = await srv.chat('Supprimer');
  await t('S15', "A : le bouton de cette carte supprime pour de vrai (vérifié) ; ensuite « Supprimer » ne le propose plus et le dit", async () =>
    ({ ok: a3.etat === 'COMPENSE' && !a4.aSupprimer && a4.motif === 'RIEN_A_SUPPRIMER' && /Rien n'a été supprimé/.test(a4.reponse || ''), info: a3.etat + ' / ' + (a4.motif || '') }));
  viderJournal();
  const a5 = await srv.chat("tu peux m'aider pour mon planning ?");
  await t('S16', "A : réponse du modèle « C'est fait, j'ai supprimé l'événement » sans aucune action → phrase retirée, et c'est dit", async () =>
    ({ ok: !/C'est fait|j'ai supprimé/.test(a5.reponse || '') && /JARVIS a retiré une phrase/.test(a5.reponse || '') && a5.retirees === 1, info: (a5.reponse || '').slice(0, 90) }));
  scenario({ plans: { 'Ajoute un essai demain à 11h': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: '||Essai' } } });
  await srv.chat('Ajoute un essai demain à 11h');
  const a6 = await srv.chat('annule');
  await t('S17', "A : « annule » juste après une carte « Créer » → « Rien n'a été créé » (et la carte n'est plus valable)", async () =>
    ({ ok: a6.motif === 'PROPOSITION_ABANDONNEE' && /Rien n'a été créé/.test(a6.reponse || ''), info: (a6.motif || a6.etape) }));

  /* G : la reponse l'emporte sur la demande ; ce qu'elle ne dit pas vient de la demande */
  scenario({ plans: { 'Ajoute hand mercredi': planFaux } });
  await srv.chat('Ajoute hand mercredi');
  const r1 = await srv.chat('jeudi 18h');
  await t('S26', "G : « Ajoute hand mercredi » → « À quelle heure ? » → « jeudi 18h » → carte du JEUDI (la réponse l'emporte), pas de boucle", async () =>
    ({ ok: r1.aConfirmer && r1.aConfirmer.cible === iso(prochain(4)) + 'T18:00|60|Hand', info: r1.aConfirmer ? r1.aConfirmer.cible : (r1.motif || r1.etape) }));
  scenario({ plans: { 'Ajoute hand mercredi pendant 1h30': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: '||Hand' } } });
  await srv.chat('Ajoute hand mercredi pendant 1h30');
  const r2 = await srv.chat('18h');
  await t('S27', "G : « … pendant 1h30 » → « À quelle heure ? » → « 18h » → la durée tapée d'abord est gardée (90 min)", async () =>
    ({ ok: r2.aConfirmer && r2.aConfirmer.cible === iso(MERCREDI) + 'T18:00|90|Hand', info: r2.aConfirmer ? r2.aConfirmer.cible : (r2.motif || r2.etape) }));
  scenario({ plans: { 'Ajoute hand mercredi': planFaux } });
  await srv.chat('Ajoute hand mercredi');
  const r3 = await srv.chat("18h c'est trop tard, laisse tomber");
  await t('S28', "garde : une réponse qui renonce (« 18h c'est trop tard, laisse tomber ») ne fait pas de carte", async () =>
    ({ ok: !r3.aConfirmer, info: r3.decide + ' ' + (r3.motif || '') }));
  scenario({ plans: { 'Ajoute hand mercredi': planFaux } });
  await srv.chat('Ajoute hand mercredi');
  await srv.chat("retiens que je préfère le hand le soir");
  const r3b = await srv.chat('18h');
  await t('S31', "garde : « 18h » qui n'arrive pas JUSTE après « À quelle heure ? » (un « retiens que » entre les deux) ne fait pas de carte", async () =>
    ({ ok: !r3b.aConfirmer, info: r3b.decide + ' ' + (r3b.motif || '') }));
  scenario({ plans: { 'envoie la facture à pierre@exemple.fr': { action: 'SEND', resource: 'EMAIL', target: 'pierre@exemple.fr' } }, reponse: "C'est annulé, j'ai bien annulé l'envoi." });
  const r4 = await srv.chat('envoie la facture à pierre@exemple.fr');
  viderJournal();
  const r5 = await srv.chat('annule');
  await t('S29', "A : « annule » pendant qu'un envoi attend → le SERVEUR dit ce qui est annulé (l'envoi à pierre@…), sans modèle", async () =>
    ({ ok: r4.decide === 'EN_ATTENTE' && r5.motif === 'ACTION_ANNULEE' && /l'envoi à pierre@exemple\.fr/.test(r5.reponse || '') && conv().length === 0 && plansJ().length === 0,
       info: r4.decide + ' → ' + (r5.motif || r5.etape) + ' ' + (r5.reponse || '').slice(0, 60) }));

  scenario({ reponse: "Voilà, c'est fait :\nBonjour à toutes et à tous." });
  const r6 = await srv.chat('Reformule plus poliment : salut tout le monde');
  await t('S30', "A : sans demande d'action, « Voilà, c'est fait : » sous un texte reformulé n'est PAS retiré (pas de fausse alerte)", async () =>
    ({ ok: /c'est fait/.test(r6.reponse || '') && !/JARVIS a retiré/.test(r6.reponse || '') && r6.retirees === 0, info: (r6.reponse || '').replace(/\n/g, ' ').slice(0, 60) }));

  /* B + C : lecture */
  const Wd3 = D3.getUTCDay();
  const faux = JOURS[(Wd3 + 1) % 7];
  const nomFaux = faux.charAt(0).toUpperCase() + faux.slice(1);
  const qLecture = "Qu'est-ce que j'ai " + JOURS[Wd3] + ' ?';
  scenario({ ics, plans: { [qLecture]: { action: 'READ', resource: 'AGENDA', target: iso(jour(4)) } },
    reponse: nomFaux + ' ' + D3.getUTCDate() + ' ' + MOIS[D3.getUTCMonth()] + ' : une réunion et du hand.',
    jarvisItems: [
      { id: 'h', status: 'confirmed', summary: 'Hand', start: { dateTime: new Date(D3ms + 8 * 3600000).toISOString() }, end: { dateTime: new Date(D3ms + 9.5 * 3600000).toISOString() } },
      { id: 'd', status: 'confirmed', summary: 'Réunion', start: { dateTime: new Date(D3ms).toISOString() }, end: { dateTime: new Date(D3ms + 3600000).toISOString() } }] });
  viderJournal();
  const b1 = await srv.chat(qLecture);
  const donnees = JSON.stringify((conv()[0] || {}).messages || []);
  await t('S18', "C : « " + qLecture + " », le modèle vise le " + iso(jour(4)) + " → période du serveur " + iso(D3) + ", en toutes lettres", async () =>
    ({ ok: b1.agenda && b1.agenda.periode === iso(D3) + '..' + iso(D3) && (b1.agenda.libelle || '').startsWith(JOURS[Wd3] + ' ' + D3.getUTCDate()), info: b1.agenda ? b1.agenda.periode + ' « ' + b1.agenda.libelle + ' »' : (b1.motif || b1.etape) }));
  await t('S19', "B : l'agenda JARVIS est lu AVEC l'agenda principal, source indiquée, doublon retiré (2 événements, pas 3)", async () =>
    ({ ok: b1.agenda && b1.agenda.evenements === 2 && b1.agenda.doublons === 1 && (b1.agenda.sources || []).join('+') === 'principal+JARVIS'
         && /Hand · agenda JARVIS/.test(donnees) && /Réunion · agenda principal \+ JARVIS/.test(donnees),
       info: b1.agenda ? b1.agenda.evenements + ' évts, doublons ' + b1.agenda.doublons + ', sources ' + b1.agenda.sources : (b1.motif || '') }));
  await t('S20', "C : le modèle écrit « " + nomFaux + ' ' + D3.getUTCDate() + " » → corrigé en « " + JOURS[Wd3] + " » dans la réponse, correction dite", async () =>
    ({ ok: (b1.reponse || '').toLowerCase().startsWith(JOURS[Wd3] + ' ' + D3.getUTCDate()) && /corrigé le jour de la semaine/.test(b1.reponse || ''), info: (b1.reponse || '').slice(0, 80) }));
  const gl = journal().filter(x => x.type === 'google' && x.methode === 'GET' && /\/events$/.test(x.path));
  await t('S21', "B : l'agenda JARVIS est lu en lecture seule, bornes timeMin/timeMax, aucune écriture pendant une lecture", async () =>
    ({ ok: gl.length === 1 && /timeMin=/.test(gl[0].query) && /timeMax=/.test(gl[0].query) && journal().filter(x => x.type === 'google' && x.methode !== 'GET').length === 0,
       info: gl.length + ' lecture(s) ; écritures ' + journal().filter(x => x.type === 'google' && x.methode !== 'GET').length }));
  scenario({ ics, jarvisStatut: 403, plans: { "Qu'est-ce que j'ai demain ?": { action: 'READ', resource: 'AGENDA', target: 'demain' } } });
  const b2 = await srv.chat("Qu'est-ce que j'ai demain ?");
  await t('S22', "B : agenda JARVIS en échec → l'agenda principal est quand même lu, et l'échec est dit (pas « 0 événement » muet)", async () =>
    ({ ok: b2.decide === 'AUTORISE' && b2.agenda && (b2.agenda.sources || []).join() === 'principal' && (b2.agenda.nonLus || []).length === 1 && b2.agenda.nonLus[0].source === 'JARVIS',
       info: b2.agenda ? 'sources ' + b2.agenda.sources + ' ; non lus ' + JSON.stringify(b2.agenda.nonLus) : (b2.motif || '') }));
  const Dsem = prochain(1);
  scenario({ ics, plans: { 'la semaine du': { action: 'READ', resource: 'AGENDA', target: iso(Dsem) + '..' + iso(new Date(Dsem.getTime() + 6 * 86400000)) } } });
  const b3 = await srv.chat("qu'est-ce que j'ai la semaine du " + Dsem.getUTCDate() + ' ' + MOIS[Dsem.getUTCMonth()] + ' ?');
  await t('S23', "garde : « la semaine du " + Dsem.getUTCDate() + " » → le modèle peut élargir à 7 jours autour de la date tapée", async () =>
    ({ ok: b3.agenda && b3.agenda.periode === iso(Dsem) + '..' + iso(new Date(Dsem.getTime() + 6 * 86400000)), info: b3.agenda ? b3.agenda.periode : (b3.motif || b3.etape) }));

  /* D serveur */
  scenario({ accessRole: 'reader' });
  const srvD = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_GOOGLE_COMPTE: COMPTE, JARVIS_AGENDA_JARVIS: AGENDA_ID });
  const dg = await srvD.req('GET', '/api/ecriture/diagnostic?sessionId=' + srvD.sid);
  await t('S24', "D : /api/ecriture/diagnostic affiche la valeur brute (« reader ») et ne conclut plus « lecture seule »", async () =>
    ({ ok: dg.code === 'ECRITURE_NON_CONFIRMEE' && /« reader »/.test(dg.message || '') && !/lecture seule/.test(dg.message || '') && /Rien n'a été écrit/.test(dg.message || ''),
       info: dg.code + ' — ' + String(dg.message || '').slice(0, 70) }));
  srvD.arreter();

  /* E demo publique */
  scenario({ reponse: 'Salut.' }); viderJournal();
  const demo = await lancer({});
  await demo.chat('salut');
  const sysDemo = (conv()[0] || {}).system || '';
  const dS = await demo.chat('Ajoute hand tous les mercredis');
  await t('S25', "E : démo publique — aucun outil réel annoncé, série → « ne crée aucun événement réel »", async () =>
    ({ ok: /aucun outil réel/.test(sysDemo) && !/créer UN événement/.test(sysDemo) && /ne crée aucun événement réel/.test(dS.reponse || ''), info: (dS.reponse || dS.etape || '').slice(0, 70) }));
  demo.arreter();

  /* =========================== P : LA PAGE =========================== */
  let P = null;
  try { P = require(process.env.JSDOM || 'jsdom'); } catch { P = null; }
  if (P) {
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    const vc = new P.VirtualConsole(); const err = []; vc.on('jsdomError', (e) => err.push(e.message));
    const dom = new P.JSDOM(html, { url: 'http://localhost:1/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
      beforeParse(w) { w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
    await dort(300);
    const w = dom.window, d = w.document;
    const rendre = (x) => w.eval('rendreDecision')(x);
    rendre({ decide: 'SANS_OBJET', etape: 'SERVEUR', reponse: "Rien n'est supprimé avant ton toucher.", aSupprimer: [{ transactionId: 'tx_1', lisible: 'dimanche 27 septembre, 10:00 → 10:30 · Test' }] });
    const bS = d.querySelector('[data-compenser="tx_1"]');
    await t('P1', "A : la page affiche la carte de suppression envoyée par le serveur, avec son vrai bouton « Supprimer »", async () =>
      ({ ok: !!bS && /dimanche 27 septembre/.test(bS.closest('.creation').textContent), info: bS ? 'bouton présent' : 'absent' }));
    rendre({ decide: 'CONFIRMATION_REQUISE', aConfirmer: { cible: 'x', lisible: 'mercredi 30 septembre, 18:00 → 19:00 · Hand', avertissements: ['Durée non précisée : 1 h par défaut.'] } });
    await t('P2', "G : la carte de création montre l'avertissement « durée par défaut » et « lus dans tes mots »", async () =>
      ({ ok: /1 h par défaut/.test(d.body.textContent) && /lus dans tes mots/.test(d.body.textContent), info: 'ok' }));
    rendre({ decide: 'AUTORISE', outil: 'agenda', etape: 'COMPLET', agenda: { periode: '2026-09-27..2026-09-27', libelle: 'dimanche 27 septembre 2026', evenements: 2, sources: ['principal', 'JARVIS'] }, reponse: 'ok' });
    const cartes = [...d.querySelectorAll('.decision.autorise .plan')].map(x => x.textContent);
    await t('P3', "C + B : la carte de lecture dit « dimanche 27 septembre 2026 » (pas une date ISO seule) et les agendas lus", async () =>
      ({ ok: cartes.some(x => /dimanche 27 septembre 2026/.test(x)) && /agenda principal \+ agenda JARVIS/.test(d.body.textContent), info: cartes.pop() }));
    rendre({ decide: 'SANS_OBJET', etape: 'SERVEUR', reponse: 'À quelle heure ?' });
    const auteur = [...d.querySelectorAll('#fil .tour')].pop().textContent;
    await t('P4', "G : une question du serveur est signée JARVIS, pas Claude", async () => ({ ok: /JARVIS/.test(auteur) && !/Claude/.test(auteur), info: auteur.slice(0, 40) }));
    await t('P5', "garde : aucune erreur JavaScript dans la page", async () => ({ ok: err.length === 0, info: err.slice(0, 2).join(' | ') || 'aucune' }));
  }

  srv.arreter();
  log('JARVIS v4.6.7 — tout fait vérifiable vient du serveur (' + DIR + ')\n');
  for (const x of R) log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(5) + x.nom + (x.info !== undefined ? '  [' + x.info + ']' : ''));
  const ko = R.filter(x => !x.ok).length;
  log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* rien */ }
  process.exit(ko ? 1 : 0);
})().catch(fatale);
