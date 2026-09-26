'use strict';
/* ============================================================================
 * JARVIS — tests de la passerelle v4.4.1 [S17, S18]   (node tests-v44.js)
 * ----------------------------------------------------------------------------
 * S17a  une session active, ou avec une action retenue, n'est plus expulsee
 *       par un afflux de nouvelles sessions : c'est le nouveau venu qui attend.
 * S17b  /health montre l'adresse que le serveur attribue au visiteur (tonIp),
 *       et JARVIS_IP_DEPUIS permet de changer de source si l'en-tete
 *       Cloudflare s'averait falsifiable en ligne.
 * S18   cle d'acces de l'instance privee : un inconnu ne peut plus bloquer le
 *       proprietaire en tapant de mauvaises cles.
 * Sur la v4.3 : JARVIS_DIR=../v4.3 node tests-v44.js
 * ========================================================================== */
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');

/* Claude simule : le planificateur choisit un envoi, la reponse dit « ok ». */
https.request = (o, cb) => {
  const q = new EventEmitter(); let b = '';
  q.write = c => { b += c; };
  q.end = () => { const c = JSON.parse(b); const r = new EventEmitter(); r.statusCode = 200; cb(r);
    r.emit('data', JSON.stringify({ content: [{ type: 'text', text: c.max_tokens === 200
      ? '{"action":"SEND","resource":"EMAIL","target":"marc@exemple.fr"}' : 'ok' }] })); r.emit('end'); };
  q.setTimeout = () => q; q.destroy = () => {}; return q;
};
Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', PORT: '3971', JARVIS_SANTE_PUBLIQUE: 'detail' /* [v4.8] */ });
const log = console.log; console.log = () => {};
require(path.join(DIR, 'server.js'));
const B = 'http://localhost:3971';
const post = (p, b, ip) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '10.9.9.9' }, body: JSON.stringify(b || {}) })
  .then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const dort = ms => new Promise(r => setTimeout(r, ms));

const R = [];
const t = async (id, nom, f) => {
  let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; }
  R.push({ id, nom, ok: !!r.ok, info: r.info });
};
const existe = async (sid, ip) => (await post('/api/annuler', { sessionId: sid, jeton: 'tx_inexistant' }, ip)).etat === 'INTROUVABLE';

/* Un serveur a part, lance comme sur Render avec une variable d'environnement. */
function serveurAvec(env, port) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['-e', `process.env.PORT='${port}';console.log=()=>{};require(${JSON.stringify(path.join(DIR, 'server.js'))})`],
      { env: { ...process.env, ANTHROPIC_API_KEY: 'test', JARVIS_SANTE_PUBLIQUE: 'detail' /* [v4.8] */, ...env }, stdio: 'ignore' });
    setTimeout(() => ok(p), 900);
  });
}
const health = (port, headers) => fetch('http://localhost:' + port + '/health', { headers }).then(r => r.json());

(async () => {
  await dort(400);
  const reelDate = Date.now; let decalage = 0; Date.now = () => reelDate() + decalage;

  /* ---- S17a : afflux de sessions ---- */
  const vA = (await post('/api/session', {}, '10.0.0.1')).sessionId;            /* envoi en attente */
  const e = await post('/api/chat', { sessionId: vA, message: 'envoie le rapport à marc@exemple.fr' }, '10.0.0.1');
  const vB = (await post('/api/session', {}, '10.0.0.2')).sessionId;            /* simplement active */
  const codes = {}; let premiere = null;
  for (let ip = 10; ip <= 14; ip++) for (let i = 0; i < 60; i++) {
    const x = await post('/api/session', {}, '10.0.1.' + ip); codes[x.status] = (codes[x.status] || 0) + 1;
    if (!premiere && x.sessionId) premiere = x.sessionId;
  }
  await t('S17.1', "afflux de 300 sessions : celle qui a un envoi en attente survit et peut annuler", async () => {
    const a = await post('/api/annuler', { sessionId: vA, jeton: e.jetonAnnulation }, '10.0.0.1');
    return { ok: e.decide === 'EN_ATTENTE' && a.etat === 'ANNULE', info: 'envoi ' + e.decide + ', annulation ' + (a.etat || a.erreur) };
  });
  await t('S17.2', "afflux : une session simplement active (moins de 10 min) survit aussi", async () =>
    ({ ok: await existe(vB, '10.0.0.2'), info: 'toujours la' }));
  await t('S17.3', "quand tout est protege, c'est le nouveau venu qui attend (503 lisible)", async () =>
    ({ ok: (codes[503] || 0) > 0 && (codes[200] || 0) === 198, info: JSON.stringify(codes) }));

  /* ---- 11 minutes plus tard : plus rien n'est protege ---- */
  decalage = 11 * 60 * 1000;
  await existe(vB, '10.0.0.2');                  /* B resert apres la pause : elle est a nouveau protegee */
  const n1 = await post('/api/session', {}, '10.0.2.1');
  await t('S17.4', "apres 11 min sans activite, une place se libere : c'est la moins recemment utilisee qui part", async () => {
    const p = await existe(premiere, '10.0.2.2'), a = await existe(vA, '10.0.0.1'), b = await existe(vB, '10.0.0.2');
    return { ok: n1.status === 200 && !p && a && b,
             info: 'nouveau=' + n1.status + ' 1re de l\'afflux=' + (p ? 'la' : 'retiree') + ' A=' + (a ? 'la' : 'retiree') + ' B=' + (b ? 'la' : 'retiree') };
  });
  Date.now = reelDate;

  /* ---- S17b : d'ou vient l'adresse ---- */
  await t('S17.5', "/health (defaut) : tonIp = l'adresse posee par Cloudflare", async () => {
    const h = await health(3971, { 'CF-Connecting-IP': '203.0.113.7' });
    return { ok: h.tonIp === '203.0.113.7' && h.ipDepuis === 'cf' && h.ip === 'cf-connecting-ip', info: JSON.stringify({ tonIp: h.tonIp, ipDepuis: h.ipDepuis }) };
  });
  const px = await serveurAvec({ JARVIS_IP_DEPUIS: 'xff' }, 3970);
  await t('S17.6', "JARVIS_IP_DEPUIS=xff : un faux CF-Connecting-IP est ignore", async () => {
    const h = await health(3970, { 'CF-Connecting-IP': '6.6.6.6', 'X-Forwarded-For': '6.6.6.6, 198.51.100.4' });
    return { ok: h.tonIp === '198.51.100.4' && h.ipDepuis === 'xff', info: JSON.stringify({ tonIp: h.tonIp, ip: h.ip }) };
  });
  await t('S17.7', "JARVIS_IP_DEPUIS=xff : changer de faux en-tete a chaque fois ne contourne plus la limite de sessions", async () => {
    let dernier;
    for (let i = 0; i < 61; i++) dernier = await fetch('http://localhost:3970/api/session', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '6.6.' + (i >> 8) + '.' + (i & 255), 'X-Forwarded-For': '198.51.100.9' }, body: '{}' });
    return { ok: dernier.status === 429, info: '61e creation : ' + dernier.status };
  });
  px.kill();
  const pc = await serveurAvec({ JARVIS_IP_DEPUIS: 'connexion' }, 3969);
  await t('S17.8', "JARVIS_IP_DEPUIS=connexion : aucun en-tete n'est cru", async () => {
    const h = await health(3969, { 'CF-Connecting-IP': '6.6.6.6', 'X-Forwarded-For': '6.6.6.6' });
    return { ok: /127\.0\.0\.1|::1/.test(String(h.tonIp)) && h.ip === 'connexion', info: JSON.stringify({ tonIp: h.tonIp, ip: h.ip }) };
  });
  pc.kill();

  /* ---- S18 : cle d'acces de l'instance privee ---- */
  const CLE = 'une-cle-de-test-longue-et-aleatoire-42';
  const pk = await serveurAvec({ JARVIS_CLE_ACCES: CLE }, 3968);
  const essai = (cle, ip) => fetch('http://localhost:3968/api/session', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, 'X-Jarvis-Cle': cle }, body: '{}' }).then(r => r.status);
  const codesInconnu = []; for (let i = 0; i < 11; i++) codesInconnu.push(await essai('mauvaise-' + i, '6.6.6.6'));
  const proprio = await essai(CLE, '87.88.176.241');
  await t('S18.1', "cle d'acces : 10 mauvaises cles d'un inconnu ne bloquent pas le proprietaire", async () =>
    ({ ok: proprio === 200, info: 'proprietaire, bonne cle -> ' + proprio }));
  await t('S18.2', "cle d'acces : l'inconnu, lui, est bloque apres 10 essais", async () =>
    ({ ok: codesInconnu[9] === 401 && codesInconnu[10] === 429, info: codesInconnu.join(' ') }));
  await t('S18.3', "cle d'acces : sans cle ou avec une mauvaise, rien ne s'ouvre", async () => {
    const sans = await fetch('http://localhost:3968/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' }, body: '{}' }).then(r => r.status);
    return { ok: sans === 401, info: 'sans cle -> ' + sans };
  });
  pk.kill();

  log('JARVIS — passerelle v4.4.1 [S17, S18] (' + DIR + ')\n');
  for (const x of R) log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(6) + x.nom + '  [' + x.info + ']');
  const ko = R.filter(x => !x.ok).length;
  log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
  process.exit(ko ? 1 : 0);
})();
