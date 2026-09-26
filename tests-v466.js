'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.6.6 : BRANCHER GOOGLE              node tests-v466.js
 * ----------------------------------------------------------------------------
 * Avant le premier evenement reel, les erreurs de mise en place doivent se
 * voir et se nommer, sans rien ecrire chez Google :
 *  E  ecriture 1.1 (module seul, faux Google) : diagnostic cle -> agenda ->
 *     droit d'ecriture ; erreurs nommees ; JSON mal colle nomme
 *  S  serveur : /api/ecriture, /api/ecriture/diagnostic (derriere la cle),
 *     /api/health « erreur-config » + motif pour une variable abimee
 *  P  page : bloc « Agenda JARVIS (Google) » et bouton « Vérifier »
 * Chaque test ECHOUE sur la v4.6.5, sauf ceux marques « garde ».
 *   JARVIS_DIR=../v465 node tests-v466.js   -> doit echouer
 * ========================================================================== */
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v466';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4083;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };
const log = console.log;
const fatale = (e) => { log('ECHEC fatale : ' + (e && e.message || e)); process.exit(1); };
process.on('unhandledRejection', fatale);
setTimeout(() => fatale('delai de 100 s depasse'), 100000);

/* ---- un vrai compte de service de test (cle RSA generee ici) ---- */
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const EMAIL = 'jarvis-robot@jarvis-test-123.iam.gserviceaccount.com';
const COMPTE = JSON.stringify({ type: 'service_account', project_id: 'jarvis-test-123', private_key_id: 'kidSECRET', private_key: PEM, client_email: EMAIL });
const AGENDA_ID = 'secretagenda42abc@group.calendar.google.com';

/* ---- faux Google : un scenario a la fois ---- */
const google = { scenario: 'ok', appels: [] };
function reponseGoogle(methode, url) {
  const u = new URL(url); google.appels.push({ methode, url: u.pathname });
  const sc = google.scenario;
  if (u.hostname === 'oauth2.googleapis.com') {
    if (sc === 'compte-supprime') return [400, { error: 'invalid_grant', error_description: 'Invalid grant: account not found' }];
    if (sc === 'cle-revoquee') return [400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }];
    if (sc === 'horloge') return [400, { error: 'invalid_grant', error_description: 'Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.' }];
    return [200, { access_token: 'ya29.JETON-SECRET-GOOGLE', expires_in: 3600 }];
  }
  if (sc === 'api-off') return [403, { error: { code: 403, message: 'Google Calendar API has not been used in project 123 before or it is disabled.',
    errors: [{ reason: 'accessNotConfigured', domain: 'usageLimits' }], status: 'PERMISSION_DENIED' } }];
  if (sc === 'introuvable') return [404, { error: { code: 404, message: 'Not Found', errors: [{ reason: 'notFound' }] } }];
  if (sc === 'interdit') return [403, { error: 'forbidden' }];
  if (methode === 'GET') return [200, { kind: 'calendar#events', accessRole: sc === 'lecture' ? 'reader' : 'writer', items: [] }];
  if (methode === 'POST' && sc === 'lecture') return [403, { error: { code: 403, message: 'You need to have writer access to this calendar.', errors: [{ reason: 'requiredAccessLevel' }] } }];
  if (methode === 'POST') return [200, { id: 'x', status: 'confirmed' }];
  return [400, {}];
}
const transport = async (methode, url) => { const [status, json] = reponseGoogle(methode, url); return { ok: true, status, texte: JSON.stringify(json) }; };

(async () => {
  /* ======================= E : MODULE ECRITURE 1.1 ======================= */
  const EC = require(path.join(DIR, 'jarvis-ecriture.js'));
  const mod = (sc) => { google.scenario = sc; return EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA_ID, transport }); };
  const diag = async (sc) => { const m = mod(sc); return typeof m.diagnostic === 'function' ? m.diagnostic() : { ok: false, code: 'PAS_DE_DIAGNOSTIC' }; };

  google.appels = [];
  const d1 = await diag('ok');
  const ecrits = google.appels.filter(a => a.methode !== 'GET' && !/token/.test(a.url)).length;
  await t('E1', "diagnostic : clé → agenda → droit d'écriture, « PRET », et RIEN d'écrit chez Google", async () =>
    ({ ok: d1.ok && d1.code === 'PRET' && (d1.etapes || []).length === 3 && d1.etapes.every(e => e.ok) && d1.compte === EMAIL && ecrits === 0,
       info: d1.code + ' ; étapes ' + (d1.etapes || []).map(e => e.etape + (e.ok ? '✓' : '✗')).join(' ') + ' ; écritures ' + ecrits }));
  const d2 = await diag('lecture');
  /* [v4.6.7 - S52] E2 s'inverse : vu en ligne le 26 sept, ce champ disait
   * « lecture seule » alors que l'ecriture marchait. Il n'est plus un verdict :
   * valeur brute rendue, « non confirmee » (le vrai test est une creation). */
  await t('E2', "accessRole « reader » : valeur brute rendue, verdict ECRITURE_NON_CONFIRMEE (plus « lecture seule »), rien écrit", async () =>
    ({ ok: !d2.ok && d2.code === 'ECRITURE_NON_CONFIRMEE' && d2.acces === 'reader', info: d2.code + ' ; accès ' + d2.acces }));
  const [d3, d4, d5, d6, d7] = [await diag('introuvable'), await diag('api-off'), await diag('compte-supprime'), await diag('cle-revoquee'), await diag('horloge')];
  await t('E3', "erreurs de mise en place NOMMÉES : agenda introuvable, API non activée, compte supprimé, clé révoquée, horloge", async () =>
    ({ ok: d3.code === 'AGENDA_INTROUVABLE' && d4.code === 'API_AGENDA_NON_ACTIVEE' && d5.code === 'COMPTE_GOOGLE_INTROUVABLE'
         && d6.code === 'CLE_GOOGLE_REVOQUEE' && d7.code === 'HORLOGE_SERVEUR',
       info: [d3, d4, d5, d6, d7].map(x => x.code).join(' ') }));
  const permisDe = (m) => m.permis({ action: 'CREATE', resource: 'AGENDA_JARVIS', target: m.validerCible('2026-12-01T18:30|60|Test').cle, transactionId: 'tx_' + crypto.randomUUID() });
  const mL = mod('lecture'); const cL = await mL.creer(permisDe(mL));
  await t('E4', "création sur un agenda en lecture seule → AGENDA_LECTURE_SEULE (plus un « inaccessible » vague)", async () =>
    ({ ok: !cL.ok && cL.code === 'AGENDA_LECTURE_SEULE', info: cL.code }));
  const mI = mod('interdit'); const cI = await mI.creer(permisDe(mI));
  await t('E5', "garde : 403 sans raison connue → AGENDA_INACCESSIBLE, comme avant", async () => ({ ok: cI.code === 'AGENDA_INACCESSIBLE', info: cI.code }));
  const motif = (texte) => EC.creerEcriture({ compte: texte, agendaId: AGENDA_ID, transport }).motif;
  const abime = COMPTE.replace(/MII[A-Za-z0-9+/]{20}/, 'MIIxxxxxxxxxxxxxxxxxxxxx');
  const [m1, m2, m3, m4] = [motif('{ pas du json'), motif(JSON.stringify({ type: 'authorized_user', client_id: 'x' })), motif(abime),
    EC.creerEcriture({ compte: COMPTE, agendaId: 'mon agenda', transport }).motif];
  await t('E6', "JSON mal collé nommé : illisible / pas un compte de service / clé privée abîmée ; identifiant d'agenda faux", async () =>
    ({ ok: m1 === 'COMPTE_JSON_ILLISIBLE' && m2 === 'COMPTE_PAS_UN_COMPTE_DE_SERVICE' && m3 === 'COMPTE_CLE_PRIVEE_ILLISIBLE' && m4 === 'AGENDA_ID_INVALIDE',
       info: [m1, m2, m3, m4].join(' ') }));
  google.appels = []; google.scenario = 'ok';
  const mT = mod('ok'); const a1 = typeof mT.diagnostic === 'function' ? await mT.diagnostic() : {}; const a2 = typeof mT.diagnostic === 'function' ? await mT.diagnostic() : {};
  await t('E7', "diagnostic répété : 1 vérification toutes les 20 s au plus (pas de rafale vers Google)", async () =>
    ({ ok: a1.ok && a2.recent === true && google.appels.length === 2, info: 'appels Google ' + google.appels.length }));
  const tout = JSON.stringify([d1, d2, d3, d4, d5, d6, d7]);
  await t('E8', "garde : aucun secret dans un diagnostic (jeton, clé privée, identifiant de clé, identifiant d'agenda)", async () =>
    ({ ok: !/JETON-SECRET|PRIVATE KEY|kidSECRET|secretagenda42/.test(tout), info: tout.length + ' caractères examinés' }));

  /* ======================= S : SERVEUR ======================= */
  /* un serveur enfant, avec un faux Google ET un faux Claude precharges */
  const fs = require('fs'), os = require('os');
  const PRE = path.join(os.tmpdir(), 'jarvis-v466-precharge.js');
  fs.writeFileSync(PRE, `'use strict';
const https = require('https'); const { EventEmitter } = require('events');
const vrai = https.request;
https.request = (url, opts, cb) => {
  if (typeof url === 'object' && !(url instanceof URL)) { cb = opts; opts = url; url = 'https://' + opts.hostname + (opts.path || '/'); }
  const u = new URL(String(url));
  const q = new EventEmitter(); let corps = '';
  q.write = (c) => { corps += c; }; q.setTimeout = () => q; q.destroy = () => q;
  q.end = () => setTimeout(() => {
    let st = 200, json;
    if (u.hostname === 'api.anthropic.com') json = { content: [{ type: 'text', text: JSON.stringify({ action: 'AUCUNE' }) }] };
    else if (u.hostname === 'oauth2.googleapis.com') json = { access_token: 'ya29.JETON-SECRET-GOOGLE', expires_in: 3600 };
    else if ((opts.method || 'GET') === 'GET') json = { kind: 'calendar#events', accessRole: 'writer', items: [] };
    else { st = 500; json = {}; }
    global.__appelsGoogle = (global.__appelsGoogle || 0) + (u.hostname.endsWith('googleapis.com') && (opts.method || 'GET') !== 'GET' && !/token/.test(u.pathname) ? 1 : 0);
    const r = new EventEmitter(); r.statusCode = st; r.headers = {}; r.complete = true; cb(r);
    r.emit('data', Buffer.from(JSON.stringify(json))); r.emit('end'); r.emit('close');
  }, 5);
  return q;
};`);
  let port = PORT;
  const lancer = async (env) => {
    const p = port++;
    const enfant = spawn(process.execPath, ['-r', PRE, 'server.js'], { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'test', PORT: String(p), ...env } });
    let sortie = ''; enfant.stdout.on('data', (d) => { sortie += d; }); enfant.stderr.on('data', (d) => { sortie += d; });
    const cle = env.JARVIS_CLE_ACCES || '';
    const appel = async (chemin, avecCle = true) => {
      const r = await fetch('http://localhost:' + p + chemin, { signal: AbortSignal.timeout(6000),
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '93.6.6.' + (p % 200), ...(avecCle && cle ? { 'X-Jarvis-Cle': cle } : {}) } });
      const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
      return { status: r.status, ...j };
    };
    let sante = null;
    for (let i = 0; i < 100 && !sante && enfant.exitCode === null; i++) { await dort(100); try { const h = await appel('/api/health'); if (h.passerelle) sante = h; } catch { /* pas encore */ } }
    const session = async () => { const r = await fetch('http://localhost:' + p + '/api/session', { method: 'POST', headers: { 'CF-Connecting-IP': '93.6.6.' + (p % 200), 'X-Jarvis-Cle': cle } }); return (await r.json()).sessionId; };
    return { sante, appel, session, sortie: () => sortie, arreter: () => enfant.kill() };
  };

  const bon = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_GOOGLE_COMPTE: COMPTE, JARVIS_AGENDA_JARVIS: AGENDA_ID });
  const sid = await bon.session();
  const e0 = await bon.appel('/api/ecriture?sessionId=' + sid);
  const dg = await bon.appel('/api/ecriture/diagnostic?sessionId=' + sid);
  const sansCle = await bon.appel('/api/ecriture/diagnostic?sessionId=' + sid, false);
  await t('S1', "/api/ecriture/diagnostic : « Prêt … Rien n'a été écrit », 3 étapes, e-mail du compte de service à qui partager", async () =>
    ({ ok: e0.configuree === true && e0.actif === true && dg.ok === true && /Rien n'a été écrit/.test(dg.message || '') && dg.compte === EMAIL && (dg.etapes || []).length === 3,
       info: dg.status + ' ' + (dg.message || dg.erreur || dg.brut || '').slice(0, 60) }));
  await t('S2', "garde : sans la clé d'accès, le diagnostic est refusé (401)", async () => ({ ok: sansCle.status === 401, info: String(sansCle.status) }));
  await t('S3', "garde : /api/health (avec la clé) → écriture « actif », passerelle v4.6.x", async () =>
    ({ ok: bon.sante && bon.sante.ecriture === 'actif' && /^v4\.[6-9]\.\d+$/.test(bon.sante.passerelle), info: bon.sante && (bon.sante.passerelle + ' ecriture ' + bon.sante.ecriture) }));
  bon.arreter();

  const mal = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_GOOGLE_COMPTE: '{"type": "service_account", "client_email": "x@y", "private_key": "-----BEGIN PRIVATE', JARVIS_AGENDA_JARVIS: AGENDA_ID });
  const sidM = await mal.session();
  const eM = await mal.appel('/api/ecriture?sessionId=' + sidM);
  const dM = await mal.appel('/api/ecriture/diagnostic?sessionId=' + sidM);
  await t('S4', "variable Google mal collée : /api/health dit « erreur-config » + motif (avant : « inactif » muet)", async () =>
    ({ ok: mal.sante && mal.sante.ecriture === 'erreur-config' && mal.sante.ecritureMotif === 'COMPTE_JSON_ILLISIBLE',
       info: mal.sante && (mal.sante.ecriture + ' ' + mal.sante.ecritureMotif) }));
  await t('S5', "…et la page peut le dire en français : « recolle TOUT le fichier »", async () =>
    ({ ok: eM.configuree === true && eM.actif === false && /recolle TOUT le fichier/.test(eM.message || '') && dM.ok === false && /recolle TOUT/.test(dM.message || ''),
       info: String(eM.message || eM.erreur || eM.brut || '').slice(0, 60) }));
  const fuite = JSON.stringify([eM, dM, mal.sante]) + mal.sortie();
  await t('S6', "garde : le contenu de la variable abîmée n'apparaît nulle part (ni réponse, ni journal)", async () =>
    ({ ok: !/BEGIN PRIVATE|x@y/.test(fuite), info: fuite.length + ' caractères examinés' }));
  mal.arreter();

  /* ============================== P : LA PAGE ============================== */
  const page = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_GOOGLE_COMPTE: COMPTE, JARVIS_AGENDA_JARVIS: AGENDA_ID });
  const pp = port - 1;
  const { JSDOM, VirtualConsole } = require(process.env.JSDOM || 'jsdom');
  const html = await fetch('http://localhost:' + pp + '/').then(r => r.text());
  const vc = new VirtualConsole(); const err = []; vc.on('jsdomError', e => err.push(e.message));
  const dom = new JSDOM(html, { url: 'http://localhost:' + pp + '/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, beforeParse(w) {
    w.localStorage.setItem('jarvis_cle', CLE);
    w.fetch = (u, o = {}) => fetch(new URL(u, 'http://localhost:' + pp + '/').href, { ...o, headers: { ...(o.headers || {}), 'CF-Connecting-IP': '93.6.9.9' } });
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
  } });
  const w = dom.window, d = w.document, $ = (id) => d.getElementById(id);
  await dort(1500);
  const bloc = $('blocGoogle');
  await t('P1', "bloc « Agenda JARVIS (Google) » visible quand les variables Google sont posées", async () =>
    ({ ok: !!bloc && !bloc.hidden && /relié/.test($('etatGoogle').textContent), info: bloc ? (bloc.hidden ? 'caché' : $('etatGoogle').textContent) : 'absent' }));
  if (bloc) { $('googleVerifier').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await dort(1200); }
  const texte = bloc ? bloc.textContent : '';
  await t('P2', "« Vérifier la connexion Google » : « Prêt », ✓ clé / agenda / écriture, e-mail du compte de service", async () =>
    ({ ok: /Prêt/.test(texte) && (texte.match(/✓/g) || []).length === 3 && texte.includes(EMAIL) && /prêt/.test($('etatGoogle').textContent),
       info: texte.replace(/\s+/g, ' ').slice(0, 90) }));
  await t('P3', 'garde : aucune erreur JavaScript dans la page', async () => ({ ok: err.length === 0, info: err.slice(0, 2).join(' | ') }));
  page.arreter();

  log('JARVIS — passerelle v4.6.6 : brancher Google, diagnostic sans rien écrire (' + DIR + ')\n');
  for (const r of R) log((r.ok ? 'OK    ' : 'ECHEC ') + r.id.padEnd(4) + ' ' + r.nom + (r.info ? '  [' + r.info + ']' : ''));
  const k = R.filter(r => !r.ok).length;
  log('\n>>> ' + (R.length - k) + '/' + R.length + ' tests passent');
  process.exit(k ? 1 : 0);
})().catch(fatale);
