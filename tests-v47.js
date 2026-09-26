'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.7 : LA CONVERSATION D'ABORD          node tests-v47.js
 * ----------------------------------------------------------------------------
 * Retours du 26 sept sur la v4.6.7 (tests en ligne d'Alsid), rejoues avec le
 * meme faux Claude et le meme faux Google que tests-v467.js :
 *  T  titre lu dans les mots tapes (« 18h » repartait de zero : « Quel jour ? »)
 *  Q  « Quelle jours sommes nous » repondu par le serveur
 *  D  suppression avec une faute (« le teste » pour « test ») ; « annule le paiement »
 *  I  le modele n'imite plus les messages et les cartes du serveur
 *  E  « Tester l'ecriture » : creation puis suppression verifiee, par le circuit gouverne
 *  A  appli sur l'ecran d'accueil : manifeste, icones, CSP, sans service worker
 *  P  page : conversation plein ecran, sections repliables, trace repliee
 * Chaque test ECHOUE sur la v4.6.7, sauf ceux marques « garde ».
 *   JARVIS_DIR=../v467 node tests-v47.js   -> doit echouer
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v47';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4270;
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-v47-'));
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

const PAGE = (() => { try { return fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'); } catch { return ''; } })();

(async () => {
  const V = exiger('jarvis-verite.js') || {};
  const f = (nom) => (typeof V[nom] === 'function' ? V[nom] : () => undefined);

  /* =========================== M : MODULE =========================== */
  await t('T1', "titre lu dans les mots tapés : « Ajoute hand mercredi » → Hand ; « …entraînement U18 jeudi à 18h30 pendant 1h30 » → Entraînement U18 ; « 18h » → rien", async () => {
    const a = f('titreTape')('Ajoute hand mercredi'), b = f('titreTape')('ajoute entraînement U18 jeudi à 18h30 pendant 1h30'), c = f('titreTape')('18h'),
      d = f('titreTape')('Ajoute rendez-vous dentiste mardi prochain à 9h15');
    return { ok: a === 'Hand' && b === 'Entraînement U18' && c === '' && d === 'Rendez-vous dentiste', info: [a, b, c, d].map(x => JSON.stringify(x)).join(' ') };
  });
  await t('Q1', "« Quelle jours sommes nous », « quels jours on est », « Quelles heures il est » : reconnus comme questions de date", async () => {
    const sam = Date.parse('2026-09-26T11:07:00Z');
    const r = ['Quelle jours sommes nous', 'quels jours on est', 'Quelles heures il est'].map(x => f('questionDate')(x, sam));
    return { ok: r[0] === 'Nous sommes le samedi 26 septembre 2026.' && r[1] === r[0] && /^Il est 13:07/.test(r[2] || ''), info: r.join(' | ') };
  });
  await t('I1', "imitation : « touche « Supprimer » », « disparition vérifiée », « confirmé par Google » retirés d'une réponse du modèle ; une ligne d'agenda normale gardée", async () => {
    const x = f('imiteServeur')("Rien n'est supprimé avant ton toucher : touche « Supprimer » sous l'événement ci-dessous. C'est confirmé par Google.") || { retirees: [] };
    const y = f('imiteServeur')('Dimanche 27 septembre : 10:00 → 11:00 · test (agenda JARVIS).') || { retirees: [1] };
    return { ok: x.retirees.length === 2 && y.retirees.length === 0, info: x.retirees.length + ' retirées / ' + y.retirees.length };
  });

  /* =========================== S : SERVEUR =========================== */
  scenario({}); viderJournal();
  const srv = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_GOOGLE_COMPTE: COMPTE, JARVIS_AGENDA_JARVIS: AGENDA_ID, JARVIS_AGENDA_ICAL: 'https://agenda.test/basic.ics' });
  await t('S0', 'garde : serveur démarré, agenda et écriture actifs', async () => ({ ok: srv.sante && srv.sante.ecriture === 'actif', info: srv.sante && srv.sante.passerelle }));

  /* T : le « 18h » du 26 sept */
  scenario({ plans: { 'Ajoute hand mercredi': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: iso(MERCREDI) } } });   /* aucun titre exploitable */
  const t1 = await srv.chat('Ajoute hand mercredi');
  const t2 = await srv.chat('18h');
  await t('T2', "vu en ligne : le modèle ne donne pas de titre → « À quelle heure ? » puis « 18h » → carte « Hand » du mercredi (plus « Quel jour ? »)", async () =>
    ({ ok: t1.motif === 'HEURE_ABSENTE' && t2.aConfirmer && t2.aConfirmer.cible === iso(MERCREDI) + 'T18:00|60|Hand', info: t1.motif + ' → ' + (t2.aConfirmer ? t2.aConfirmer.cible : (t2.motif || t2.etape)) }));
  scenario({ plans: { 'Ajoute mercredi à 18h': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: '' } } });
  const t3 = await srv.chat('Ajoute mercredi à 18h');
  const t4 = await srv.chat('entraînement U18');
  await t('T3', "aucun titre nulle part → « Quel titre ? » → « entraînement U18 » → carte « Entraînement U18 » mercredi 18:00", async () =>
    ({ ok: t3.motif === 'TITRE_ABSENT' && t4.aConfirmer && t4.aConfirmer.cible === iso(MERCREDI) + 'T18:00|60|Entraînement U18', info: (t3.motif || t3.etape) + ' → ' + (t4.aConfirmer ? t4.aConfirmer.cible : (t4.motif || t4.etape)) }));
  scenario({ plans: { 'Ajoute mercredi': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: '' } } });
  const t5 = await srv.chat('Ajoute mercredi');
  const t6 = await srv.chat('18h');
  const t7 = await srv.chat('hand');
  await t('T4', "ni titre ni heure : « À quelle heure ? » → « 18h » → « Quel titre ? » → « hand » → carte « Hand » mercredi 18:00 (rien d'oublié entre deux réponses)", async () =>
    ({ ok: t5.motif === 'HEURE_ABSENTE' && t6.motif === 'TITRE_ABSENT' && t7.aConfirmer && t7.aConfirmer.cible === iso(MERCREDI) + 'T18:00|60|Hand',
       info: [t5, t6].map(x => x.motif || x.etape).join(' → ') + ' → ' + (t7.aConfirmer ? t7.aConfirmer.cible : (t7.motif || t7.etape)) }));

  /* Q */
  viderJournal();
  const q1 = await srv.chat('Quelle jours sommes nous');
  await t('Q2', "vu en ligne : « Quelle jours sommes nous » → réponse du SERVEUR (signée JARVIS), sans modèle", async () =>
    ({ ok: q1.etape === 'SERVEUR' && /^Nous sommes le /.test(q1.reponse || '') && conv().length === 0 && plansJ().length === 0, info: (q1.etape || '') + ' ' + (q1.reponse || '').slice(0, 40) }));

  /* D : suppression */
  scenario({ plans: { 'Ajoute un test demain à 10h': { action: 'CREATE', resource: 'AGENDA_JARVIS', target: iso(jour(1)) + 'T10:00|60|test' } } });
  const d0 = await srv.chat('Ajoute un test demain à 10h');
  const d1 = await srv.req('POST', '/api/confirmer', { sessionId: srv.sid, action: 'CREATE', resource: 'AGENDA_JARVIS', cible: d0.aConfirmer && d0.aConfirmer.cible });
  const txD = d1.decision && d1.decision.transactionId;
  scenario({ reponse: "Rien n'est supprimé avant ton toucher : touche « Supprimer » sous l'événement ci-dessous." }); viderJournal();
  const d2 = await srv.chat('Supprime le teste stp');
  await t('D1', "vu en ligne : « Supprime le teste stp » (l'événement s'appelle « test ») → les cartes du SERVEUR, sans modèle", async () =>
    ({ ok: !!txD && Array.isArray(d2.aSupprimer) && d2.aSupprimer.some(x => x.transactionId === txD) && conv().length === 0, info: (d2.motif || d2.etape) + ' ; appels modèle ' + conv().length }));
  scenario({ plans: { 'supprime le fichier rapport.pdf': { action: 'DELETE', resource: 'FICHIER', target: 'rapport.pdf' } } });
  const d3 = await srv.chat('supprime le fichier rapport.pdf');
  await t('D2', "garde : « supprime le fichier rapport.pdf » (un fichier, pas un événement) n'affiche pas les cartes d'agenda", async () =>
    ({ ok: !d3.aSupprimer, info: (d3.decide || '') + ' ' + (d3.etape || '') }));
  await srv.req('POST', '/api/compenser', { sessionId: srv.sid, transactionId: txD });
  scenario({ plans: { 'paie la facture à marc@exemple.fr': { action: 'PAY', resource: 'BANQUE', target: 'marc@exemple.fr' } }, reponse: "C'est annulé." });
  const d4 = await srv.chat('paie la facture à marc@exemple.fr');
  viderJournal();
  const d5 = await srv.chat('annule le paiement');
  await t('D3', "« annule le paiement » pendant un paiement retenu → le SERVEUR dit « Annulé : le paiement à marc@… », sans modèle", async () =>
    ({ ok: d4.decide === 'EN_ATTENTE' && d5.motif === 'ACTION_ANNULEE' && /le paiement à marc@exemple\.fr/.test(d5.reponse || '') && conv().length === 0,
       info: d4.decide + ' → ' + (d5.motif || d5.etape) }));

  /* I : imitation */
  scenario({ reponse: "Rien n'est supprimé avant ton toucher : touche « Supprimer » sous l'événement ci-dessous. Je peux t'aider autrement." });
  const i1 = await srv.chat('merci, et sinon ça va ?');
  await t('I2', "le modèle recopie un message du serveur → phrase retirée, et c'est dit", async () =>
    ({ ok: !/touche « Supprimer »/.test(i1.reponse || '') && /imitait un message du serveur/.test(i1.reponse || '') && /Je peux t'aider autrement/.test(i1.reponse || ''), info: (i1.reponse || '').replace(/\n/g, ' ').slice(0, 80) }));
  scenario({ reponse: 'Bien sûr.' }); viderJournal();
  await srv.chat('Quel jour sommes-nous ?');
  await srv.chat('et toi ?');
  const hist = JSON.stringify((conv()[0] || {}).messages || []);
  await t('I3', "dans l'historique donné au modèle, un message du serveur est marqué « [Affiché par le serveur JARVIS… » (plus sa parole)", async () =>
    ({ ok: /\[Affiché par le serveur JARVIS, pas par toi : Nous sommes le /.test(hist), info: (hist.match(/\[Affiché[^\]]{0,50}/) || ['absent'])[0] }));

  /* E : tester l'ecriture */
  viderJournal();
  const e1 = await srv.req('POST', '/api/ecriture/test', { sessionId: srv.sid });
  const g = journal().filter(x => x.type === 'google').map(x => x.methode);
  await t('E1', "« Tester l'écriture » → création réelle PUIS suppression vérifiée (POST puis DELETE chez Google), « Écriture prouvée »", async () =>
    ({ ok: e1.ok === true && /Écriture prouvée/.test(e1.message || '') && g.includes('POST') && g.includes('DELETE') && g.indexOf('POST') < g.indexOf('DELETE'),
       info: (e1.message || e1.erreur || e1.brut || '').slice(0, 50) + ' ; Google ' + g.join(',') }));
  await t('E2', "la trace de ce test passe par le noyau (geste → autorisé → effet réel → annulé)", async () =>
    ({ ok: e1.trace && e1.trace.effet && e1.trace.effet.compense === true, info: JSON.stringify(e1.trace && e1.trace.effet || null).slice(0, 80) }));
  const dg = await srv.req('GET', '/api/ecriture/diagnostic?sessionId=' + srv.sid);
  await t('E3', "garde : après ce test, le diagnostic dit « Prêt » (écriture prouvée)", async () => ({ ok: dg.ok === true && dg.prouvee === true, info: dg.code + ' prouvee=' + dg.prouvee }));
  const sansCle = await fetch('http://localhost:' + (port - 1) + '/api/ecriture/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: srv.sid }) }).then(r => r.status).catch(() => 0);
  await t('E4', "garde : sans la clé d'accès, « Tester l'écriture » est refusé (401)", async () => ({ ok: sansCle === 401, info: String(sansCle) }));

  /* A : l'appli sur l'ecran d'accueil — SANS cle (l'ecran d'accueil les demande avant toute cle) */
  const brut = (chemin) => fetch('http://localhost:' + (port - 1) + chemin).then(async (r) => ({ status: r.status, type: r.headers.get('content-type') || '',
    csp: r.headers.get('content-security-policy') || '', corps: Buffer.from(await r.arrayBuffer()) })).catch(() => ({ status: 0, type: '', csp: '', corps: Buffer.alloc(0) }));
  const man = await brut('/manifest.webmanifest');
  let mj = null; try { mj = JSON.parse(man.corps.toString('utf8')); } catch { mj = null; }
  await t('A1', "manifeste de l'appli public (sans clé) : « JARVIS », plein écran, départ « / », icônes 192 et 512", async () =>
    ({ ok: man.status === 200 && /application\/manifest\+json/.test(man.type) && mj && mj.name === 'JARVIS' && mj.display === 'standalone' && mj.start_url === '/'
        && ['192x192', '512x512'].every(z => (mj.icons || []).some(i => i.sizes === z && i.type === 'image/png')), info: man.status + ' ' + man.type }));
  const dims = async (chemin) => { const r = await brut(chemin);
    const png = r.corps.length > 24 && r.corps.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return r.status === 200 && r.type === 'image/png' && png ? r.corps.readUInt32BE(16) + 'x' + r.corps.readUInt32BE(20) : r.status + ' ' + r.type; };
  const vus = [await dims('/icone-192.png'), await dims('/icone-512.png'), await dims('/apple-touch-icon.png'), await dims('/icone-180.png')];
  await t('A2', "icônes publiques, vrais PNG aux bonnes tailles (192, 512, et 180 pour l'iPhone)", async () =>
    ({ ok: vus.join(',') === '192x192,512x512,180x180,180x180', info: vus.join(',') }));
  const pg = await brut('/'), html = pg.corps.toString('utf8');
  await t('A3', "la page déclare l'appli (manifeste, icône iPhone, plein écran) et la CSP l'autorise (manifest-src 'self')", async () =>
    ({ ok: /manifest-src 'self'/.test(pg.csp) && /<link rel="manifest" href="\/manifest\.webmanifest">/.test(html) && /rel="apple-touch-icon"/.test(html)
        && /name="apple-mobile-web-app-capable" content="yes"/.test(html) && /name="apple-mobile-web-app-title" content="JARVIS"/.test(html), info: (pg.csp.match(/manifest-src[^;]*/) || ['absent'])[0] }));
  const inc = await brut('/icone-999.png'), traverse = await brut('/icone-192.png/../server.js');
  await t('A4', "garde : pas de service worker, taille inconnue → 404, rien d'autre servi par ces routes", async () =>
    ({ ok: !/serviceWorker/.test(html) && inc.status === 404 && traverse.status === 404 && !/require\(/.test(traverse.corps.toString('utf8')), info: inc.status + ' ' + traverse.status }));
  const mfj = essai(() => JSON.parse(fs.readFileSync(path.join(DIR, 'MANIFESTE.json'), 'utf8')), null);
  const mfv = await mfj;
  await t('A5', "le manifeste d'intégrité couvre le nouveau module jarvis-appli.js", async () =>
    ({ ok: !!(mfv && mfv.fichiers && mfv.fichiers['jarvis-appli.js']), info: mfv ? Object.keys(mfv.fichiers || {}).length + ' fichiers' : 'illisible' }));
  srv.arreter();

  /* =========================== P : LA PAGE =========================== */
  let J = null;
  try { J = require(process.env.JSDOM || 'jsdom'); } catch { J = null; }
  if (J) {
    const HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    const TRACE_ANNULEE = { intention: { nature: 'CONFIRMATION_GESTE', reverifiee: true }, plan: { classe: 'COMPENSABLE' }, confirmation: {},
      effet: { etat: 'COMPENSATED', reel: { ok: true }, compense: true } };
    /* une page dans jsdom, avec un faux serveur qui note chaque appel */
    const page = async ({ perso = false, stockage = null } = {}) => {
      const vc = new J.VirtualConsole(); const err = []; vc.on('jsdomError', (e) => err.push(e.message));
      const appels = [];
      const repondre = (u) => u.includes('/api/session') ? { sessionId: 's1' }
        : u.includes('/api/ecriture/test') ? { ok: true, message: "Écriture prouvée : un événement de test a été créé chez Google puis supprimé (disparition vérifiée).", trace: TRACE_ANNULEE }
        : u.includes('/api/ecriture') ? (perso ? { configuree: true, actif: true } : {}) : {};
      const dom = new J.JSDOM(HTML, { url: 'http://localhost:1/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
        beforeParse(w) {
          if (stockage) for (const [k, v] of Object.entries(stockage)) w.localStorage.setItem(k, v);
          w.fetch = async (url, o) => { const u = String(url); appels.push({ u, m: (o && o.method) || 'GET' }); const j = repondre(u);
            return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j), clone() { return this; } }; };
          w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
        } });
      await dort(250);
      return { w: dom.window, d: dom.window.document, err, appels };
    };
    const A = await page();
    const { d } = A;
    const IDS = ['fil', 'msg', 'micro', 'envoyer', 'rangManuel', 'action', 'cible', 'basculeManuel', 'mLedger', 'mAudit', 'mAncres', 'mCouv', 'pVal', 'pBar', 'pOrigine',
      'jtLancer', 'blocMemoire', 'souvenirs', 'nbSouvenirs', 'toutOublier', 'blocFaceId', 'etatFaceId', 'fidPreparer', 'fidCreer', 'fidMessage', 'fidResultat', 'fidValeur', 'fidCopier',
      'blocGoogle', 'etatGoogle', 'googleVerifier', 'googleMessage', 'googleEtapes', 'reset', 'lancerM', 'mitigations', 'toutAttaquer', 'attaques', 'verifier', 'rayon', 'chaine',
      'tests', 'resTests', 'porteCle', 'champCle', 'validerCle', 'erreurCle', 'contact', 'sante'];
    const manquants = IDS.filter(x => !d.getElementById(x));
    const pastille = d.getElementById('pastille'), detail = d.getElementById('enteteDetail');
    await t('P1', "l'en-tête tient sur une ligne : JARVIS + pastille du plancher ; jauge, origine et mesures repliées dessous", async () =>
      ({ ok: !!pastille && !!detail && detail.hidden === true && pastille.contains(d.getElementById('pVal')) && detail.contains(d.getElementById('pBar'))
          && detail.contains(d.getElementById('mLedger')) && detail.contains(d.getElementById('pOrigine')), info: pastille ? 'pastille, détail ' + (detail && detail.hidden ? 'replié' : 'ouvert') : 'pas de pastille' }));
    const blocs = [...d.querySelectorAll('#defense details.bloc')];
    await t('P2', "les 8 sections de défense sont repliées sous un « + », et tous les identifiants d'avant existent encore", async () =>
      ({ ok: blocs.length === 8 && blocs.every(b => !b.open && b.querySelector('summary h2')) && manquants.length === 0,
         info: blocs.length + ' blocs, ' + blocs.filter(b => b.open).length + ' ouverts, manquants : ' + (manquants.join(',') || 'aucun') }));
    const conv = d.getElementById('fil').closest('.colonne');
    await t('P3', "l'écran commence par la conversation : fil et saisie dans la 1re colonne, l'accueil porte le parcours guidé", async () =>
      ({ ok: conv && conv.contains(d.querySelector('.saisie')) && !conv.contains(d.getElementById('blocMemoire')) && d.getElementById('fil').contains(d.getElementById('jtLancer')),
         info: d.getElementById('jtLancer') ? d.getElementById('jtLancer').parentElement.className : 'absent' }));
    const bA = d.getElementById('blocAttaques'); if (bA) { bA.open = true; bA.dispatchEvent(new A.w.Event('toggle')); }
    let memo = null; try { memo = A.w.localStorage.getItem('jarvis_ouverts'); } catch { memo = null; }
    const B = await page({ stockage: { jarvis_ouverts: JSON.stringify(['blocJournal']) } });
    const B2 = await page({ stockage: { jarvis_ouverts: '{pas du json' } });
    await t('P4', "un bloc ouvert le reste au retour (ce navigateur) ; un stockage abîmé laisse tout replié, sans erreur", async () =>
      ({ ok: /blocAttaques/.test(memo || '') && !!B.d.getElementById('blocJournal') && B.d.getElementById('blocJournal').open === true && B.d.getElementById('blocTests').open === false
          && [...B2.d.querySelectorAll('details.bloc')].every(x => !x.open) && B2.err.length === 0, info: String(memo) }));
    const avant = d.querySelectorAll('#fil .tour').length;
    A.w.eval('rendreDecision')({ decide: 'AUTORISE', outil: 'agenda-jarvis', etape: 'COMPLET', evenement: { lisible: 'mercredi 30 septembre, 18:00 → 19:00 · Hand', transactionId: 'tx_9' },
      trace: { intention: { nature: 'CONFIRMATION_GESTE', reverifiee: true }, plan: { classe: 'COMPENSABLE' }, confirmation: {}, effet: { etat: 'EXECUTED', reel: { ok: true } } } });
    const apres = [...d.querySelectorAll('#fil .tour')];
    const carte = apres[apres.length - 1], tr = carte && carte.querySelector('details.trace');
    await t('P5', "la trace n'a plus sa bulle : repliée sous la carte (« + détail »), fermée par défaut", async () =>
      ({ ok: apres.length === avant + 1 && !!tr && !tr.open && /détail/.test(tr.querySelector('summary').textContent) && !!carte.querySelector('[data-compenser="tx_9"]')
          && /effet réel confirmé/.test(tr.textContent), info: (apres.length - avant) + ' bulle(s) ; ' + (tr ? tr.textContent.slice(0, 60) : 'pas de trace repliée') }));
    const rT = A.w.eval('resumeTrace');
    const tExe = tr ? tr.textContent : '', tAnn = rT(TRACE_ANNULEE);
    await t('P6', "la trace est en français jusqu'au bout : « → exécuté. », « → annulé (disparition vérifiée). » (plus « executed » ni « compensated »)", async () =>
      ({ ok: /→ exécuté\.$/.test(tExe) && /annulé \(disparition vérifiée\)\.$/.test(tAnn) && !/executed|compensated|failed|pending/i.test(tExe + tAnn),
         info: tExe.slice(-20) + ' | ' + tAnn.slice(-40) }));
    const G = await page({ perso: true });
    G.d.getElementById('googleTester') && G.d.getElementById('googleTester').click();
    await dort(200);
    const postTest = G.appels.filter(x => /\/api\/ecriture\/test/.test(x.u));
    await t('P7', "bouton « Tester l'écriture » (bloc Google) → POST /api/ecriture/test, le résultat et la trace s'affichent", async () =>
      ({ ok: postTest.length === 1 && postTest[0].m === 'POST' && /Écriture prouvée/.test(G.d.getElementById('googleMessage').textContent)
          && G.d.getElementById('etatGoogle').textContent === 'écriture prouvée' && /annulé \(disparition vérifiée\)/.test(G.d.getElementById('googleEtapes').textContent),
         info: postTest.length + ' appel(s) ; ' + G.d.getElementById('googleMessage').textContent.slice(0, 40) }));
    const accueil = G.d.getElementById('accueil');
    await t('P8', "ton instance (agenda relié) : l'accueil parle de ton agenda, la démo et son parcours guidé sont masqués", async () =>
      ({ ok: G.d.body.classList.contains('perso') && !!accueil && /ton agenda/.test(accueil.textContent) && !/e-mail piégé/.test(accueil.textContent)
          && !d.body.classList.contains('perso') && /e-mail piégé/.test(d.getElementById('accueil').textContent) && G.d.getElementById('blocGoogle').hidden === false,
         info: accueil ? accueil.textContent.slice(5, 60) : 'pas d\'accueil' }));
    pastille && pastille.click();
    const ouvert = detail && detail.hidden === false && pastille.getAttribute('aria-expanded') === 'true';
    pastille && pastille.click();
    A.w.eval('majEtat')({ plancher: 'CONTENT_DERIVED', influences: [{ source: 'email' }] });
    const C = await page();
    await essai(() => { C.w.eval('devoiler')(C.d.getElementById('attaques')); C.w.eval('devoiler')(C.d.querySelector('.plancher')); });
    await t('P9', "pastille : touche = détail ouvert / refermé ; point rouge si contenu externe ; le parcours guidé déplie ce qu'il montre", async () =>
      ({ ok: ouvert && detail.hidden === true && d.getElementById('pPoint').className === 'point b1' && /contenu externe/.test(pastille.textContent)
          && !!C.d.getElementById('blocAttaques') && C.d.getElementById('blocAttaques').open === true && C.d.getElementById('enteteDetail').hidden === false,
         info: 'point ' + (d.getElementById('pPoint') || {}).className }));
    await t('P10', "garde : aucune erreur JavaScript dans les pages", async () =>
      ({ ok: [A, B, B2, C, G].every(x => x.err.length === 0), info: [A, B, B2, C, G].map(x => x.err[0]).filter(Boolean).join(' | ').slice(0, 90) || 'aucune' }));
  }

  log('JARVIS v4.7 — la conversation d\'abord (' + DIR + ')\n');
  for (const x of R) log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(5) + x.nom + (x.info !== undefined ? '  [' + x.info + ']' : ''));
  const ko = R.filter(x => !x.ok).length;
  log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* rien */ }
  process.exit(ko ? 1 : 0);
})().catch(fatale);
