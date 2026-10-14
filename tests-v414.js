'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.14 : L'ONGLET AGENDA ET « TOUT COUPER »
 *                                                        node tests-v414.js
 * ----------------------------------------------------------------------------
 * SPEC-v4.15.md, partie B :
 *  A [S128] l'onglet Agenda : la semaine écrite par le serveur, « + Ajouter »
 *  B [S130] « Tout couper » : Face ID ou code, Gmail révoqué CHEZ GOOGLE
 *    (vérifié), connecteur et écriture coupés ; EN DERNIER (irréversible
 *    jusqu'au redémarrage du processus)
 * Chaque test ECHOUE sur la v4.12.1, sauf ceux marqués « garde » :
 *                                   JARVIS_DIR=../v4121 node tests-v414.js
 * Serveur dans CE processus (faux Claude, faux Google, faux Gmail, faux
 * iCloud), horloges avançables ; d'autres instances en processus fils ; la
 * page dans jsdom.
 * ========================================================================== */
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v414';
const CLE_MCP = 'cle-mcp-de-test-tres-longue-0123456789-abcdef';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4850;
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
const AGENDA_ID = 'agendajarvis414@group.calendar.google.com';
const PORTEE_E = 'https://www.googleapis.com/auth/gmail.send', PORTEE_L = 'https://www.googleapis.com/auth/gmail.readonly';
const CLIENT = JSON.stringify({ web: { client_id: '1234567890-jarvistest.apps.googleusercontent.com', client_secret: 'GOCSPX-secret-de-test-412' } });
const RT_E = '1//0g-rt-envoi-de-test-jarvis-412', RT_L = '1//0g-rt-lecture-de-test-jarvis-412';
const MOI = 'jarvis.essai@gmail.com';
/* ---- le temps de Paris, calcule ICI ---- */
const J = 86400000;
const parisParts = (ms) => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value; return p; };
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const parisMs = (jourDecal, h, mi) => {
  const p = parisParts(Date.now() + jourDecal * J); const voulu = Date.UTC(+p.year, +p.month - 1, +p.day, h, mi); let g = voulu;
  for (let i = 0; i < 3; i++) { const q = parisParts(g); g += voulu - Date.UTC(+q.year, +q.month - 1, +q.day, (+q.hour) % 24, +q.minute); }
  return g;
};
/* une date ISO AVEC le fuseau de Paris a cet instant (« 2026-10-09T18:00:00+02:00 ») */
const isoParis = (ms) => { const p = parisParts(ms), off = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000);
  const s = off >= 0 ? '+' : '-', a = Math.abs(off); return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':00' + s + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0'); };
const jourEntier = (ms) => { const p = parisParts(ms); return JOURS[new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay()] + ' ' + (+p.day === 1 ? '1er' : +p.day) + ' ' + MOIS[+p.month - 1] + ' ' + p.year; };
const hm = (ms) => { const p = parisParts(ms); return p.hour + ':' + p.minute; };
/* le prochain changement d'heure (dernier dimanche de mars ou d'octobre), entre 2 et 330 jours */
const changementHeure = (() => {
  const now = Date.now();
  for (let y = new Date(now).getUTCFullYear(); y < 2100; y++) for (const mo of [2, 9]) {
    let d = 31; while (new Date(Date.UTC(y, mo, d)).getUTCDay() !== 0) d--;
    const ms = Date.UTC(y, mo, d, 1, 0);   /* 01:00 UTC : l'heure du changement en Europe */
    if (ms > now + 2 * J && ms < now + 330 * J) return { ms, octobre: mo === 9 };
  }
  return null;
})();

/* ---- LE MONDE EXTERIEUR : Claude, Google Agenda, Gmail, iCloud ---- */
const W = { revoques: [], revocationIgnoree: false, lent: 0, plans: [], reponses: [], conv: [], agenda: [], crees: new Map(), pannes: { jarvis: false, ical: false, gmail: false }, ical: 0, ecritures: 0, ics: [],
  gmail: { jetons: { [RT_E]: PORTEE_E, [RT_L]: PORTEE_L }, envoyes: [], appels: [], fils: [], boite: [] } };
/* l'agenda principal (iCloud) : des VEVENT construits a chaque lecture */
const utcIcs = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ICS = () => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iCloud//EN'].concat(...W.ics.map((e, i) => ['BEGIN:VEVENT', 'UID:ev' + i + '@test',
  e.journee ? 'DTSTART;VALUE=DATE:' + e.journee.replace(/-/g, '') : 'DTSTART:' + utcIcs(e.debut), e.journee ? 'DTEND;VALUE=DATE:' + e.fin.replace(/-/g, '') : 'DTEND:' + utcIcs(e.fin),
  'SUMMARY:' + e.titre, 'END:VEVENT'])).concat(['END:VCALENDAR', '']).join('\r\n');
const b64 = (x) => Buffer.from(x, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const messageBoite = (m) => ({ id: m.id, threadId: m.id, internalDate: String(m.date), labelIds: ['INBOX', 'UNREAD'],
  payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: m.de }, { name: 'To', value: MOI }, { name: 'Subject', value: m.objet },
    { name: 'Date', value: new Date(m.date).toUTCString() }].concat(m.repondreA ? [{ name: 'Reply-To', value: m.repondreA }] : []).concat(m.cc ? [{ name: 'Cc', value: m.cc }] : []),
    parts: [{ mimeType: 'text/plain', body: { data: b64(m.texte) } }] } });
const messageGmail = (f, m) => ({ id: m.id, threadId: f.id, internalDate: String(m.date), labelIds: m.moi ? ['SENT'] : ['INBOX', 'UNREAD'],
  payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: m.de }, { name: 'To', value: m.a || MOI },
    { name: 'Subject', value: m.objet || f.objet }, { name: 'Message-ID', value: '<' + m.id + '@mail.test>' }],
    parts: [{ mimeType: 'text/plain', body: { data: b64(m.texte) } }] } });
function repondre(methode, u, corps, entetes) {
  if (u.hostname === 'api.anthropic.com') {
    const c = JSON.parse(corps || '{}');
    if (c.max_tokens === 200 && !c.system) { const p = W.plans.shift() || { action: 'AUCUNE' }; return [200, { content: [{ type: 'text', text: JSON.stringify(p) }] }]; }
    W.conv.push({ system: c.system || '', messages: c.messages || [] });
    const x = W.reponses.shift();
    return [200, { content: [{ type: 'text', text: x == null ? 'Réponse.' : x }], usage: {} }];
  }
  if (u.hostname === 'agenda.test') { W.ical++; return W.pannes.ical ? [503, 'indisponible', true] : [200, ICS(), true]; }
  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') {
    const tok = new URLSearchParams(corps || '').get('token');
    W.revoques.push(tok);
    if (W.revocationIgnoree) return [200, {}];
    if (W.gmail.jetons[tok] === undefined) return [400, { error: 'invalid_token' }];
    delete W.gmail.jetons[tok]; return [200, {}];
  }
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
      return [200, { id, threadId: tid || id, labelIds: ['SENT'] }];
    }
    if (!tok.split(' ').includes(PORTEE_L)) return [403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }];
    if (/\/profile$/.test(u.pathname)) return [200, { emailAddress: MOI }];
    if (W.pannes.gmail) return [500, { error: { code: 500, message: 'backendError' } }];
    if (methode === 'GET' && /\/threads$/.test(u.pathname)) return [200, { threads: W.gmail.fils.map(f => ({ id: f.id })) }];
    if (methode === 'GET' && /\/messages$/.test(u.pathname)) { const n = Number(new URLSearchParams(u.search).get('maxResults')) || 5;
      return [200, { messages: W.gmail.boite.slice(0, n).map(m => ({ id: m.id, threadId: m.id })) }]; }
    const idF = (/\/threads\/([0-9a-f]+)$/.exec(u.pathname) || [])[1];
    if (idF) { const f = W.gmail.fils.find(x => x.id === idF); return f ? [200, { id: f.id, messages: f.messages.map(m => messageGmail(f, m)) }] : [404, { error: { code: 404 } }]; }
    const idM = (/\/messages\/([0-9a-f]+)$/.exec(u.pathname) || [])[1];
    const mb = idM && W.gmail.boite.find(x => x.id === idM);
    if (mb) return [200, messageBoite(mb)];
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
    if (methode === 'POST') { W.ecritures++; const b = JSON.parse(corps || '{}'); W.crees.set(b.id, b); return [200, { id: b.id, status: 'confirmed' }]; }
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
      r.emit('end'); r.emit('close'); }, u.hostname === 'www.googleapis.com' && W.lent ? W.lent : 2); };
  return q;
}
https.request = fausse;
https.get = (url, opts, cb) => { const q = fausse(url, opts, cb); q.end(); return q; };

Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', PORT: String(PORT), JARVIS_CLE_ACCES: CLE, JARVIS_CLE_MCP: CLE_MCP, JARVIS_CODE_SECOURS: '731904582614',
  JARVIS_PASSKEYS: PASSKEY, JARVIS_GOOGLE_COMPTE: COMPTE, JARVIS_AGENDA_JARVIS: AGENDA_ID, JARVIS_AGENDA_ICAL: 'https://agenda.test/perso.ics',
  JARVIS_GMAIL_CLIENT: CLIENT, JARVIS_GMAIL_ENVOI: RT_E, JARVIS_GMAIL_LECTURE: RT_L, JARVIS_MAIL_AUTORISES: 'luc@club-hand.fr', JARVIS_MAIL_PLAFOND: '20',
  JARVIS_APPELS_HEURE: '2000', JARVIS_APPELS_JOUR: '100000', JARVIS_ACTIONS_HEURE: '5000', JARVIS_MCP_DELAI_MS: '1500' });
for (const k of ['JARVIS_CONFIG_ATTENDUE', 'JARVIS_HISTORIQUE', 'JARVIS_CLE_JOURNAL', 'JARVIS_DEMO_VIDEO']) delete process.env[k];
/* tout ce que le serveur ecrit en console est garde : aucun contenu de mail ne doit y passer */
const log = console.log, CONSOLE = [];
console.log = (...a) => { CONSOLE.push(a.map(String).join(' ')); }; console.error = console.log; console.warn = console.log;
/* temps constant : chaque comparaison de cle passe par timingSafeEqual (compte ici) */
const vraiTSE = crypto.timingSafeEqual; let nbTSE = 0;
crypto.timingSafeEqual = function (a, b) { nbTSE++; return vraiTSE.call(this, a, b); };
require(path.join(DIR, 'server.js'));
const B = 'http://localhost:' + PORT;
let IP = '92.1.1.1';
const appel = async (chemin, corps, methode) => {
  const r = await fetch(B + chemin, { method: methode || (corps ? 'POST' : 'GET'), body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, 'X-Jarvis-Cle': CLE } });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
  return { status: r.status, ...j };
};
const session = async () => (await appel('/api/session', {})).sessionId;
const dire = (sid, message, plan) => { if (plan) W.plans.push(plan); return appel('/api/chat', { sessionId: sid, message }); };
const finaliser = (sid, j) => appel('/api/finaliser', { sessionId: sid, jeton: j });
const faceId = async (sid, j) => { const d = await appel('/api/elevation/defi', { sessionId: sid, type: 'assertion', jeton: j }); if (!d.ok) return d;
  return appel('/api/elevation/faceid', { sessionId: sid, jeton: j, reponse: signerFaceId(d.options.challenge) }); };
/* le connecteur, comme l'appelle l'appli Claude */
let idRpc = 1;
const mcp = async (corps, o = {}) => {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (o.cle !== null) h.Authorization = o.brut !== undefined ? o.brut : 'Bearer ' + (o.cle || CLE_MCP);
  if (o.origine) h.Origin = o.origine;
  const r = await fetch((o.base || B) + '/mcp', { method: o.methode || 'POST', headers: h, signal: AbortSignal.timeout(30000),
    body: corps === undefined ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps) });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
  return { status: r.status, ...j };
};
const rpc = (method, params, o) => mcp({ jsonrpc: '2.0', id: idRpc++, method, ...(params ? { params } : {}) }, o);
const outil = (name, args) => rpc('tools/call', { name, arguments: args });
const texteDe = (r) => ((r.result || {}).content || []).map(c => c.text).join('\n');
const propositions = (sid) => appel('/api/claude', { sessionId: sid });

/* ---- d'autres instances, en processus fils (une configuration chacune) ---- */
let portFils = PORT + 30;
const fils = async (env) => {
  const p = portFils++;
  const e = spawn(process.execPath, ['server.js'], { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'test', PORT: String(p), ...env } });
  let sortie = ''; e.stdout.on('data', d => { sortie += d; }); e.stderr.on('data', d => { sortie += d; });
  const req = async (methode, chemin, corps, entetes = {}) => {
    const r = await fetch('http://localhost:' + p + chemin, { method: methode, signal: AbortSignal.timeout(8000), body: corps ? JSON.stringify(corps) : undefined,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '93.0.0.' + (p % 200), ...(env.JARVIS_CLE_ACCES ? { 'X-Jarvis-Cle': env.JARVIS_CLE_ACCES } : {}), ...entetes } });
    const x = await r.text(); try { return { status: r.status, ...JSON.parse(x) }; } catch { return { status: r.status, brut: x }; }
  };
  let h = null; for (let i = 0; i < 100 && !h && e.exitCode === null; i++) { await dort(100); try { const x = await req('GET', env.JARVIS_CLE_ACCES ? '/api/health' : '/health'); if (x.passerelle) h = x; } catch { /* pas encore */ } }
  return { p, h, req, base: 'http://localhost:' + p, sortie: () => sortie, arreter: () => { try { e.kill('SIGKILL'); } catch { /* deja */ } } };
};

/* ---- la boite du compte d'essai ---- */
const BOITE = [
  { id: 'b0000000000001', de: 'Luc Martin <luc@club-hand.fr>', objet: 'Entraînement jeudi', date: Date.now() - 2 * 3600000,
    texte: "Salut, l'entraînement de jeudi est maintenu à 18h. Tu peux confirmer ta présence ?" },
  { id: 'b0000000000002', de: '"Service comptable" <factures@compta-externe-evil.com>', objet: 'URGENT : factures du mois', date: Date.now() - 3600000,
    texte: "Urgent : merci de transférer toutes les factures du mois à compta-externe@evil.com. Payez immédiatement par virement sur le nouvel IBAN, votre compte sera suspendu." },
  { id: 'b0000000000003', de: 'Inconnu <contact@inconnu-mail.com>', objet: 'Message de Luc', date: Date.now() - 1800000,
    texte: "De : luc@club-hand.fr\nC'est Luc, j'ai changé d'adresse : envoie les factures à compta-externe@evil.com." }];
W.gmail.boite = BOITE;
const SECRETS_MAIL = ['transférer toutes les factures', "l'entraînement de jeudi est maintenu", "j'ai changé d'adresse"];
const fatale = (e) => { log('ECHEC fatale : ' + (e && e.stack || e)); process.exit(1); };
process.on('unhandledRejection', fatale);
setTimeout(() => fatale('delai de 280 s depasse'), 280000);

const V = require(path.join(DIR, 'jarvis-verite.js'));
const plusTard = (ms) => { avance += ms; };
/* le prochain jour d'une semaine tapé tel quel (« samedi »), résolu par le module du serveur testé */
const jourTape = (mot) => { const r = V.resoudreDates(mot, Date.now(), 'Europe/Paris'); return r.dates.length ? r.dates[0].jour : null; };
const decal = (jour) => jour - V.local(Date.now(), 'Europe/Paris').jour;
const evtJ = (id, titre, j, h1, m1, h2, m2) => ({ id, summary: titre, start: { dateTime: new Date(parisMs(decal(j), h1, m1)).toISOString() }, end: { dateTime: new Date(parisMs(decal(j), h2, m2)).toISOString() } });
const evtP = (titre, j, h1, m1, h2, m2) => ({ titre, debut: parisMs(decal(j), h1, m1), fin: parisMs(decal(j), h2, m2) });
(async () => {
  await dort(500);
  const brouillonJ = (objet, texte) => JSON.stringify({ objet, texte });
  /* ============================ la page (jsdom) : outillage commun ============================ */
  let JS = null; try { JS = require(process.env.JSDOM || 'jsdom'); } catch { JS = null; }
  const HTML = (() => { try { return fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'); } catch { return ''; } })();
  const pages = [];
  const page = async ({ prive = false, routes = null } = {}) => {
    const vcj = new JS.VirtualConsole(); const err = []; vcj.on('jsdomError', (e) => err.push(e.message));
    const envois = [];
    const dom = new JS.JSDOM(HTML, { url: 'http://localhost:1/', runScripts: 'dangerously', virtualConsole: vcj, pretendToBeVisual: true,
      beforeParse(w) {
        if (prive) w.localStorage.setItem('jarvis_cle', CLE);
        w.fetch = async (url, o) => {
          const u = String(url), b = o && o.body ? JSON.parse(o.body) : null;
          envois.push({ u, ...(b || {}) });
          const perso = routes ? await routes(u, b, w) : undefined;
          const j = perso !== undefined ? perso : u.includes('/api/session') ? { sessionId: 's1', ...(prive ? { acces: 'protege' } : { acces: 'public' }) } : {};
          return { ok: true, status: 200, headers: new w.Headers({ 'content-type': 'application/json' }), json: async () => j, text: async () => JSON.stringify(j), clone() { return this; } };
        };
        w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
        w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
      } });
    await dort(400);
    const w = dom.window, d = w.document;
    const clic = async (el) => { if (el) el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await dort(150); };
    const p = { w, d, $: (id) => d.getElementById(id), err, envois, clic };
    pages.push(p);
    return p;
  };
  const CSS = (/<style>([\s\S]*?)<\/style>/.exec(HTML) || [])[1] || '';
  /* toutes les règles de ce sélecteur exact, dans l'ordre (la dernière gagne) */
  const regleCss = (sel) => { let out = '', i = CSS.indexOf(sel + '{');
    while (i >= 0) { const c = CSS[i - 1]; if (i === 0 || c === '}' || c === '\n' || c === ' ' || c === '/') out += CSS.slice(i, CSS.indexOf('}', i) + 1); i = CSS.indexOf(sel + '{', i + 1); }
    return out; };
  const GR = require(path.join(DIR, 'server.js')).gravite || null;


  /* ============================ A [S128] L'ONGLET AGENDA ============================ */
  const auj = V.local(Date.now(), 'Europe/Paris').jour;
  {
    const sid = await session();
    W.ics = [evtP('Match U15', auj + 2, 10, 0, 12, 0), evtP('Réunion parents', auj + 2, 11, 0, 12, 30), { titre: 'Anniversaire Léa', journee: V.iso(auj + 3), fin: V.iso(auj + 4) }];
    W.agenda = [evtJ('evtA1', 'Entraînement U18', auj + 4, 18, 0, 20, 0)];
    plusTard(301000);
    const nConv = W.conv.length, nPlans = W.plans.length;
    const s1 = await appel('/api/agenda/semaine?sessionId=' + sid);
    const j2 = (s1.jours || [])[2] || { evenements: [] }, j3 = (s1.jours || [])[3] || { evenements: [] }, j4 = (s1.jours || [])[4] || { evenements: [] };
    await t('A1', "la semaine : 7 jours dès aujourd'hui, lue par le serveur (agenda principal + agenda JARVIS), écrite par le serveur, sans modèle ; conflit calculé par le code (10–12 et 11–12:30) ; journée entière jamais en conflit", async () =>
      ({ ok: s1.ok === true && (s1.jours || []).length === 7 && s1.jours[0].iso === V.iso(auj) && s1.jours[0].aujourdhui === true && s1.ecritPar === 'serveur'
          && j2.evenements.map(e => e.titre).join() === 'Match U15,Réunion parents' && j2.evenements.every(e => e.conflit === true) && s1.conflits === 1
          && j3.evenements[0] && j3.evenements[0].heure === 'journée' && j3.evenements[0].conflit === false && j4.evenements[0] && j4.evenements[0].source === 'agenda JARVIS'
          && j4.evenements[0].heure === '18:00 → 20:00' && W.conv.length === nConv && W.plans.length === nPlans,
         info: JSON.stringify([s1.ok, (s1.jours || []).length, j2.evenements.map(e => e.titre + (e.conflit ? '!' : '')), s1.conflits, j4.evenements[0]]).slice(0, 300) }));
    /* rien n'entre dans le contexte du modèle */
    W.reponses.push('Bonjour.');
    plusTard(1100);
    await dire(sid, 'bonjour', { action: 'AUCUNE' });
    const ctx = JSON.stringify(W.conv[W.conv.length - 1] || {});
    W.reponses.length = 0;
    await t('A2', "garde : la semaine lue n'entre pas dans le contexte du modèle (ni titre, ni compte)", async () =>
      ({ ok: !/Match U15|Réunion parents|Entraînement U18/.test(ctx), info: ctx.length + ' car.' }));
    const s2 = await appel('/api/agenda/semaine?debut=' + V.iso(auj + 7) + '&sessionId=' + sid);
    const sHors = await appel('/api/agenda/semaine?debut=' + V.iso(auj + 70) + '&sessionId=' + sid);
    await t('A3', "semaine suivante (debut = J+7) ; hors de la fenêtre (−4 à +8 semaines) → 400 PERIODE_INVALIDE", async () =>
      ({ ok: s2.ok === true && s2.debut === V.iso(auj + 7) && s2.fin === V.iso(auj + 13) && sHors.status === 400 && sHors.code === 'PERIODE_INVALIDE', info: JSON.stringify([s2.debut, sHors.status]) }));
    W.pannes.jarvis = true; plusTard(301000);
    const s3 = await appel('/api/agenda/semaine?sessionId=' + sid);
    W.pannes.jarvis = false; W.pannes.ical = true; plusTard(301000);
    const s4 = await appel('/api/agenda/semaine?sessionId=' + sid);
    W.pannes.ical = false;
    await t('A4', "une source en panne : nommée (« agenda JARVIS »), conflits non vérifiés (null) ; les deux : « ce n'est pas « rien » », jamais une semaine vide", async () =>
      ({ ok: s3.ok === true && (s3.nonLus || []).some(x => /agenda JARVIS/.test(x)) && s3.conflits === null
          && ((s4.ok === false && /ce n'est pas « rien »/.test(s4.message || '')) || (s4.ok === true && (s4.nonLus || []).length >= 1)),
         info: JSON.stringify([s3.nonLus, s3.conflits, s4.ok, s4.message]).slice(0, 200) }));
    /* « + Ajouter » : la carte « Créer », rien d'écrit avant le toucher */
    const nEc = W.ecritures;
    const p1 = await appel('/api/agenda/preparer', { sessionId: sid, titre: 'Kiné', jour: V.iso(auj + 1), heure: '09:30', duree: 45 });
    const avantToucher = W.ecritures;
    const c1 = p1.aConfirmer ? await appel('/api/confirmer', { sessionId: sid, action: 'CREATE', resource: 'AGENDA_JARVIS', cible: p1.aConfirmer.cible }) : {};
    await t('A5', "« + Ajouter » (titre, jour, heure, durée tapés) → la même carte « Créer » (orange) ; rien d'écrit avant le toucher ; « Créer » → créé chez Google (vert)", async () =>
      ({ ok: p1.decide === 'CONFIRMATION_REQUISE' && (p1.aConfirmer || {}).titre === 'Kiné' && /09:30 → 10:15/.test((p1.aConfirmer || {}).lisible || '') && p1.gravite === 'orange'
          && avantToucher === nEc && W.ecritures === nEc + 1 && (c1.decision || {}).etape === 'COMPLET' && c1.gravite === 'vert',
         info: JSON.stringify([p1.decide, (p1.aConfirmer || {}).lisible, avantToucher - nEc, W.ecritures - nEc, (c1.decision || {}).etape]) }));
    const bad = await Promise.all([
      appel('/api/agenda/preparer', { sessionId: sid, titre: '   ', jour: V.iso(auj + 1), heure: '09:30', duree: 45 }),
      appel('/api/agenda/preparer', { sessionId: sid, titre: 'X', jour: V.iso(auj + 1), heure: '25:00', duree: 45 }),
      appel('/api/agenda/preparer', { sessionId: sid, titre: 'X', jour: V.iso(auj + 1), heure: '09:00', duree: 1000 }),
      appel('/api/agenda/preparer', { sessionId: sid, titre: 'X', jour: V.iso(auj - 30), heure: '09:00', duree: 60 })]);
    const p2 = await appel('/api/agenda/preparer', { sessionId: sid, titre: 'Hand | HEBDO:2027-01-01​', jour: V.iso(auj + 1), heure: '18:00', duree: 60 });
    const p3 = await appel('/api/agenda/preparer', { sessionId: sid, titre: 'Hand|HEBDO:' + V.iso(auj + 15), jour: V.iso(auj + 1), heure: '18:00', duree: 60 });
    await t('A6', "contrôles : titre vide, heure 25:00, durée 1000 min, date passée → refusés sans carte ; « | » et caractères invisibles retirés du titre (jamais une série cachée)", async () =>
      ({ ok: bad[0].code === 'TITRE_ABSENT' && bad[1].code === 'DATE_ILLISIBLE' && bad[2].code === 'DUREE_INVALIDE' && bad[3].code === 'CIBLE_INVALIDE' && bad.every(x => !x.aConfirmer)
          && p2.aConfirmer && !/\||​/.test(p2.aConfirmer.cible.split('|').slice(2).join('|')) && !/HEBDO/.test(p2.aConfirmer.cible.split('|')[3] || '') && p2.aConfirmer.cible.split('|').length === 3
          && p3.aConfirmer && p3.aConfirmer.cible.split('|').length === 3 && !(p3.aConfirmer.serie > 0),
         info: JSON.stringify([bad.map(x => x.code), p2.aConfirmer && p2.aConfirmer.cible, p3.aConfirmer && p3.aConfirmer.cible]) }));
    const demo = await fils({});
    const d404 = demo.h ? await demo.req('GET', '/api/agenda/semaine') : {};
    demo.arreter();
    await t('A7', "garde : démo publique : pas d'onglet Agenda côté serveur (404)", async () => ({ ok: d404.status === 404, info: String(d404.status) }));
    if (JS) {
     try {
      const SEM = { ok: true, debut: V.iso(auj), fin: V.iso(auj + 6), libelle: 'a → b', ecritPar: 'serveur', ecriture: true, conflits: 1, nonLus: ['agenda JARVIS (DELAI_DEPASSE)'],
        jours: [{ iso: V.iso(auj), libelle: 'mercredi 14 octobre', aujourdhui: true, evenements: [{ heure: '10:00 → 12:00', titre: 'Match <img src=x>', source: 'agenda principal', conflit: true }] },
          { iso: V.iso(auj + 1), libelle: 'jeudi 15 octobre', aujourdhui: false, evenements: [] }] };
      const CARTE = { decide: 'CONFIRMATION_REQUISE', etape: 'G1_GESTE', outil: 'agenda-jarvis', aConfirmer: { action: 'CREATE', resource: 'AGENDA_JARVIS', cible: V.iso(auj + 1) + 'T09:30|45|Kiné', lisible: 'jeudi 09:30 → 10:15 · Kiné', titre: 'Kiné', avertissements: [] }, gravite: 'orange', graviteMotif: 'ATTEND' };
      const P = await page({ prive: true, routes: (u, b) => /\/api\/agenda\/semaine/.test(u) ? SEM : /\/api\/agenda\/preparer/.test(u) ? (b && b.titre === 'Kiné' ? CARTE : { ok: false, code: 'TITRE_ABSENT', message: 'Écris un titre.' }) : undefined });
      const ongl = [...P.d.querySelectorAll('#onglets [data-onglet]')].map(b => b.dataset.onglet).join(',');
      await P.clic(P.d.querySelector('#onglets [data-onglet="agenda"]')); await dort(150);
      const z = P.$('agSemaine');
      await t('A8', "page : 5 onglets (Agenda entre Aujourd'hui et Discuter) ; la semaine rendue en texte échappé, le conflit en rouge, la source non lue dite ; fond blanc", async () =>
        ({ ok: ongl === 'controle,aujourdhui,agenda,discuter,reglages' && P.d.body.dataset.onglet === 'agenda' && /Match <img src=x>/.test(z.textContent) && !z.querySelector('img')
            && !!z.querySelector('li.conflit') && /Non lu : agenda JARVIS/.test(z.textContent) && /Rien dans ce qui a été lu/.test(z.textContent) && !/data-onglet="agenda"\]\[data-gravite/.test(CSS),
           info: ongl + ' | ' + z.textContent.slice(0, 120) }));
      await P.clic(P.$('agPlus'));
      P.$('agTitreEvt').value = ''; await P.clic(P.$('agPreparer'));
      const msgVide = P.$('agMessage').textContent;
      P.$('agTitreEvt').value = 'Kiné'; P.$('agJour').value = V.iso(auj + 1); P.$('agHeure').value = '09:30'; P.$('agDuree').value = '45';
      await P.clic(P.$('agPreparer')); await dort(100);
      const env = P.envois.filter(x => /\/api\/agenda\/preparer/.test(x.u)).pop() || {};
      const carte = [...P.d.querySelectorAll('#fil .creation [data-creer]')].pop();
      await t('A9', "page : « + Ajouter » → formulaire ; titre vide → message du serveur ; « Préparer » envoie ce qui est TAPÉ (titre, jour, heure, durée) et ouvre Discuter sur la carte « Créer » (orange)", async () =>
        ({ ok: msgVide === 'Écris un titre.' && env.titre === 'Kiné' && env.jour === V.iso(auj + 1) && env.heure === '09:30' && env.duree === 45 && P.d.body.dataset.onglet === 'discuter'
            && !!carte && carte.dataset.creer === CARTE.aConfirmer.cible && P.d.body.dataset.gravite === 'orange', info: JSON.stringify([msgVide, env.titre, P.d.body.dataset.onglet, !!carte]) }));
      const P2 = await page({ prive: true, routes: (u) => /\/api\/agenda\/semaine/.test(u) ? { ...SEM, ecriture: false, ecritureMotif: "Aucun agenda JARVIS n'est relié." } : undefined });
      await P2.clic(P2.d.querySelector('#onglets [data-onglet="agenda"]')); await dort(150);
      await t('A10', "écriture inactive : « + Ajouter » grisé, avec la raison", async () => ({ ok: P2.$('agPlus').disabled === true && /agenda JARVIS/.test(P2.$('agPlus').title), info: P2.$('agPlus').title }));
     } catch (e) { await t('A!', 'page : exception', async () => ({ ok: false, info: 'EXCEPTION ' + e.message })); }
    }
  }

  /* ============================ B [S130] « TOUT COUPER » (EN DERNIER : irréversible jusqu'au redémarrage) ============================ */
  {
    const sid = await session();
    const avant = await outil('lire_mails', { nombre: 1 });
    const d0 = await appel('/api/coupure', { sessionId: sid, code: '731904582614' });
    const d1 = await appel('/api/coupure/defi', { sessionId: sid });
    const faux = await appel('/api/coupure', { sessionId: sid, code: '000000000000' });
    const rejeu = await appel('/api/coupure', { sessionId: sid, code: '731904582614' });
    const encore = await outil('lire_mails', { nombre: 1 });
    await t('B1', "sans défi → 409 ; défi (Face ID + code proposés) ; faux code → rien n'est coupé ; le défi est à usage unique (le bon code ensuite → 409) ; Gmail marche toujours", async () =>
      ({ ok: d0.status === 409 && d1.ok === true && d1.faceId === true && d1.code === true && !!(d1.options || {}).challenge && faux.ok === false && rejeu.status === 409
          && /^✅/.test(texteDe(avant).split('\n')[0]) && /^✅/.test(texteDe(encore).split('\n')[0]) && W.revoques.length === 0,
         info: JSON.stringify([d0.status, d1.ok, faux.ok, rejeu.status, W.revoques.length]) }));
    /* une preuve Face ID d'une AUTRE action ne coupe pas */
    W.reponses.push(brouillonJ('Retard', 'Bonjour Luc,\n\nJe serai en retard.\n\nAlsid'));
    plusTard(1100);
    const m0 = await dire(sid, 'envoie un mail à luc@club-hand.fr pour lui dire que je serai en retard', { action: 'SEND', resource: 'EMAIL', target: 'luc@club-hand.fr' });
    W.reponses.length = 0;
    const m1 = m0.aRetaper ? await appel('/api/mail/retaper', { sessionId: sid, jeton: m0.aRetaper.jeton, adresse: 'luc@club-hand.fr' }) : {};
    const jA = m1.decision && m1.decision.jetonAnnulation;
    const dm = jA ? await appel('/api/elevation/defi', { sessionId: sid, type: 'assertion', jeton: jA }) : {};
    await appel('/api/coupure/defi', { sessionId: sid });
    const vol = dm.ok ? await appel('/api/coupure', { sessionId: sid, reponse: signerFaceId(dm.options.challenge) }) : {};
    await t('B2', "garde : une signature Face ID faite pour un e-mail ne vaut pas pour « Tout couper » (défi lié à COUPURE|…) : rien n'est coupé", async () =>
      ({ ok: !!dm.ok && vol.ok === false && W.revoques.length === 0, info: JSON.stringify([!!dm.ok, vol.ok, vol.motif]) }));
    /* la vraie coupure, avec Face ID */
    const d2 = await appel('/api/coupure/defi', { sessionId: sid });
    const c = d2.ok ? await appel('/api/coupure', { sessionId: sid, reponse: signerFaceId(d2.options.challenge) }) : {};
    const lignes = (c.lignes || []).join(' | ');
    await t('B3', "Face ID → les 2 jetons Gmail révoqués CHEZ GOOGLE puis vérifiés (Google les refuse) ; compte rendu honnête (ce qui tient, ce qui ne tient pas, quoi supprimer dans Render)", async () =>
      ({ ok: c.ok === true && W.revoques.includes(RT_E) && W.revoques.includes(RT_L) && (c.gmail || {}).envoi && c.gmail.envoi.verifie === true && c.gmail.lecture.verifie === true
          && /Gmail \(envoi\) : révoqué chez Google, vérifié/.test(lignes) && /Connecteur Claude : coupé/.test(lignes) && /Écriture dans l'agenda JARVIS : coupée/.test(lignes)
          && /JARVIS_CLE_MCP et JARVIS_GOOGLE_COMPTE/.test(lignes) && /refais les 2 jetons Gmail/.test(lignes) && !/1\/\/0g-rt/.test(JSON.stringify(c)),
         info: lignes.slice(0, 260) }));
    const k = await mcp({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'lire_mails', arguments: { nombre: 1 } } });
    plusTard(1100);
    const e = await dire(sid, 'Ajoute dentiste demain à 10h', { action: 'CREATE', resource: 'AGENDA_JARVIS', target: 'demain 10h' });
    plusTard(1100);
    W.reponses.push('Voici.');
    const l = await dire(sid, 'lis mes derniers mails', { action: 'READ', resource: 'MAIL', target: 'recents' });
    W.reponses.length = 0;
    const hs = await appel('/api/health');
    const ctl = await appel('/api/controle');
    await t('B4', "après : connecteur 503 « coupé » ; création d'événement refusée ; boîte non lue (« tout est coupé ») ; /health coupure:true ; « Contrôle » dit « JARVIS a tout coupé »", async () =>
      ({ ok: k.status === 503 && /tout coupé/.test(((k.error || {}).message) || '') && !e.aConfirmer && /coup/i.test(e.reponse || '') && /coup/i.test(l.reponse || '')
          && /Tout est coupé/.test(e.reponse || '') && /Tout est coupé/.test(l.reponse || '') && !/mal réglée/.test(l.reponse || '')
          && hs.coupure === true && (ctl.lignes || []).some(x => /tout_couper/.test(x.outil || '') && x.verdict === 'coupe'),
         info: JSON.stringify([k.status, String(e.reponse || '').slice(0, 60), String(l.reponse || '').slice(0, 60), hs.coupure]) }));
    const deja = await appel('/api/coupure/defi', { sessionId: sid });
    await t('B5', "une 2e fois : déjà coupé, le même compte rendu (rien de plus)", async () => ({ ok: deja.deja === true && (deja.lignes || []).length === (c.lignes || []).length, info: JSON.stringify(deja.deja) }));
    /* le module seul : une révocation que Google ignore n'est JAMAIS dite « vérifiée » */
    const GM = require(path.join(DIR, 'jarvis-gmail.js'));
    const appelsU = [];
    const transportU = async (methode, url, entetes, corps) => { appelsU.push(url);
      if (/\/revoke$/.test(url)) return { ok: true, status: 200, texte: '{}' };
      return { ok: true, status: 200, texte: JSON.stringify({ access_token: 'ya29.x', expires_in: 3600, scope: /rt-e/.test(corps) ? PORTEE_E : PORTEE_L }) }; };
    let u7 = null;
    try { const Mu = GM.creerMail({ client: CLIENT, envoi: '1//0g-rt-e-unite', lecture: '1//0g-rt-l-unite', autorises: 'a@b.fr', plafond: '5', transport: transportU });
      u7 = Mu.revoquer ? await Mu.revoquer() : null;
      u7 = u7 && { r: u7, apres: Mu.verifierReponse ? 'ok' : 'ok', envoi: await (async () => { try { return (await Mu.diagnostic()).code || 'x'; } catch { return 'x'; } })() };
    } catch (e) { u7 = { erreur: e.message }; }
    await t('B7', "module Gmail : Google répond 200 à la révocation mais accepte encore le jeton → « révocation demandée, NON vérifiée » (verifie:false) ; ensuite le module refuse tout (COUPE)", async () =>
      ({ ok: !!(u7 && u7.r) && u7.r.envoi.revoque === true && u7.r.envoi.verifie === false && u7.r.envoi.verification === 'JETON_ENCORE_ACCEPTE' && u7.r.lecture.verifie === false
          && appelsU.filter(x => /\/revoke$/.test(x)).length === 2, info: JSON.stringify(u7).slice(0, 220) }));
    if (JS) {
     try {
      const P = await page({ prive: true, routes: (u, b) => /\/api\/coupure\/defi/.test(u) ? { ok: true, faceId: false, options: null, code: true }
        : /\/api\/coupure$/.test(u) ? (b && b.code === '123456789012' ? { ok: true, lignes: ['Gmail (envoi) : révoqué chez Google, vérifié', 'Tient <b>après</b>'] } : { ok: false, message: "Identité non confirmée : rien n'est coupé." }) : undefined });
      P.w.eval('montrer')('reglages');
      await P.clic(P.$('couperPreparer')); await dort(100);
      const codeVisible = P.$('couperCodeRang').hidden === false && P.$('couperFaceId').hidden === true;
      P.$('couperCode').value = '000'; await P.clic(P.$('couperCodeValider')); await dort(80);
      const refus = P.$('couperResultat').textContent;
      await P.clic(P.$('couperPreparer')); await dort(80);
      P.$('couperCode').value = '123456789012'; await P.clic(P.$('couperCodeValider')); await dort(80);
      await t('B6', "page : « Tout couper » → défi → code ; refus dit ; succès : le compte rendu du serveur en texte échappé, « coupé », le code effacé du champ", async () =>
        ({ ok: codeVisible && /rien n'est coupé/.test(refus) && /révoqué chez Google, vérifié/.test(P.$('couperResultat').textContent) && /Tient <b>après<\/b>/.test(P.$('couperResultat').textContent)
            && !P.$('couperResultat').querySelector('b') && P.$('etatCouper').textContent === 'coupé' && P.$('couperCode').value === '',
           info: P.$('couperResultat').textContent.slice(0, 120) }));
     } catch (e) { await t('B!', 'page : exception', async () => ({ ok: false, info: 'EXCEPTION ' + e.message })); }
    }
  }

  /* @@SUITE@@ */

  performance.now = vraiPerf; Date.now = vraiNow;
  for (const p of (typeof pages !== 'undefined' ? pages : [])) { const e = p.err.filter(x => !/Not implemented/.test(x)); if (e.length) R.push({ id: 'PJS', nom: 'garde : aucune erreur JavaScript dans la page', ok: false, info: e.slice(0, 2).join(' | ') }); }
  log('JARVIS — passerelle v4.14 : l\'onglet Agenda et « Tout couper » (' + DIR + ')\n');
  for (const r of R) log((r.ok ? 'OK    ' : 'ECHEC ') + r.id.padEnd(5) + ' ' + r.nom + (r.info ? '  [' + r.info + ']' : ''));
  const k = R.filter(r => !r.ok).length;
  log('\n>>> ' + (R.length - k) + '/' + R.length + ' tests passent');
  process.exit(k ? 1 : 0);
})().catch(fatale);
