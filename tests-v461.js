'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.6.1                                 node tests-v461.js
 * ----------------------------------------------------------------------------
 * [S32] delai TOTAL sur chaque appel a l'IA (JARVIS_DELAI_IA, 40 s par defaut)
 *   Le VRAI serveur, avec un faux Claude qui se tait, s'arrete en route,
 *   repond trop tard ou coupe la connexion. Sur v4.6.0 la requete restait
 *   pendue sans fin (le test abandonne au bout de 6 s).
 * [S34] manifeste : /health et `node jarvis-manifeste.js --verifier` disent si
 *   les fichiers qui tournent sont ceux livres. Copies modifiees, vrais
 *   serveurs lances a cote.
 * Plus la page (jsdom) : le delai depasse est dit en francais.
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v461';
const DELAI = 1.5;   /* secondes, pour des tests rapides */
const BASE = Number(process.env.JARVIS_PORT_TEST) || 3971;   /* plusieurs suites en parallele */

/* ---- faux Claude : un comportement par appel, dans l'ordre ---- */
const comportements = [], plans = [], appels = [];
function fauxClaude(o, cb) {
  const q = new EventEmitter(); let b = '';
  const a = { corps: null, detruit: 0, comportement: comportements.shift() || 'normal' };
  appels.push(a);
  q.write = (c) => { b += c; };
  q.setTimeout = () => q;
  /* comme Node : detruire une requete sans reponse emet « socket hang up » */
  q.destroy = () => { a.detruit++; setImmediate(() => q.emit('error', new Error('socket hang up'))); return q; };
  const repondre = () => {
    const c = a.corps, r = new EventEmitter(); r.statusCode = 200; r.complete = true; cb(r);
    const plan = c.max_tokens === 200, suivant = plans.shift() || { action: 'AUCUNE' };
    const texte = plan ? JSON.stringify(suivant) : (a.texte || 'Réponse : ' + String((c.messages[c.messages.length - 1] || {}).content).slice(0, 120));
    r.emit('data', JSON.stringify({ content: [{ type: 'text', text: texte }] })); r.emit('end'); r.emit('close');
  };
  q.end = () => {
    a.corps = JSON.parse(b);
    const k = a.comportement;
    if (k === 'muet') return;                                   /* rien, jamais */
    if (k === 'entetes') {                                      /* en-tetes puis silence */
      const r = new EventEmitter(); r.statusCode = 200; r.complete = false; cb(r); r.emit('data', '{"content":[{"type":"te'); return;
    }
    if (k === 'coupe') {                                        /* coupee en route */
      const r = new EventEmitter(); r.statusCode = 200; r.complete = false; cb(r); r.emit('data', '{"content":');
      setTimeout(() => r.emit('close'), 50); return;
    }
    if (k === 'lent') { a.texte = 'TARDIF-7Q4M'; return setTimeout(repondre, 2600); }
    repondre();
  };
  return q;
}
https.request = (opts, cb) => fauxClaude(opts, cb);

Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', PORT: String(BASE), JARVIS_CLE_ACCES: CLE, JARVIS_DELAI_IA: String(DELAI) });
delete process.env.JARVIS_AGENDA_ICAL; delete process.env.JARVIS_GOOGLE_COMPTE;
const journal = []; const log = console.log;
console.log = (...a) => journal.push(a.join(' ')); console.error = (...a) => journal.push(a.join(' '));
let serveurCharge = true;
try { require(path.join(DIR, 'server.js')); } catch (e) { serveurCharge = false; journal.push('CHARGEMENT ' + e.message); }

const B = 'http://localhost:' + BASE;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));
const appel = async (p, corps, ip) => {
  const r = await fetch(B + p, { method: corps ? 'POST' : 'GET', body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(6000),   /* v4.6.0 : pendue sans fin, on abandonne a 6 s */
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '92.1.1.1', 'X-Jarvis-Cle': CLE } });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { /* pas du JSON */ }
  return { status: r.status, ...j };
};
const session = async (ip) => (await appel('/api/session', {}, ip)).sessionId;
const chronoDire = async (sid, message, ip) => {
  const t0 = Date.now(); let r;
  try { r = await appel('/api/chat', { sessionId: sid, message }, ip); } catch (e) { r = { pendue: true, erreur: e.name }; }
  return { r, ms: Date.now() - t0 };
};

const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };

/* ---- serveurs lances a cote, pour le manifeste et la configuration ---- */
let port = BASE + 10;
const lancer = async (dir, env = {}) => {
  const p = port++;
  const enfant = spawn(process.execPath, ['server.js'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'test', PORT: String(p), JARVIS_SANTE_PUBLIQUE: 'detail' /* [v4.8] */, ...env } });
  let sortie = ''; enfant.stdout.on('data', (d) => { sortie += d; }); enfant.stderr.on('data', (d) => { sortie += d; });
  let sante = null;
  for (let i = 0; i < 150 && !sante && enfant.exitCode === null; i++) {
    await dort(100);
    try { sante = await (await fetch('http://localhost:' + p + '/health', { signal: AbortSignal.timeout(1000) })).json(); } catch { /* pas encore */ }
  }
  return { sante, enfant, sortie: () => sortie, arreter: () => { try { enfant.kill('SIGKILL'); } catch { /* deja arrete */ } } };
};
const santeDe = async (dir, env) => { const s = await lancer(dir, env); s.arreter(); return s.sante; };
const ESSENTIELS = ['server.js', 'index.html', 'package.json', 'MANIFESTE.json', 'jarvis-5.28.3.js', 'jarvis-plus-5.29.js',
  'jarvis-vigilance.js', 'jarvis-memoire.js', 'jarvis-agenda.js', 'jarvis-ecriture.js', 'jarvis-elevation.js', 'jarvis-manifeste.js',
  'jarvis-verite.js', 'jarvis-appli.js'];   /* v4.6.7 : le module verite ; v4.7 : l'appli */
const copie = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-v461-'));
  for (const f of ESSENTIELS) if (fs.existsSync(path.join(DIR, f))) fs.copyFileSync(path.join(DIR, f), path.join(d, f));
  return d;
};
const verifierCli = (dir) => {
  const r = spawnSync(process.execPath, [path.join(dir, 'jarvis-manifeste.js'), '--verifier', dir], { encoding: 'utf8' });
  return { rc: r.status, texte: (r.stdout || '') + (r.stderr || '') };
};

(async () => {
  await dort(500);

  /* =========================== [S32] DELAI DE L'IA =========================== */
  await t('D1', "le planificateur se tait : réponse en ~1,5 s, rien soumis au noyau, UN seul appel, connexion coupée", async () => {
    if (!serveurCharge) return { ok: false, info: 'serveur non charge' };
    const sid = await session('92.1.1.1'); const n0 = appels.length;
    comportements.push('muet');
    const { r, ms } = await chronoDire(sid, 'bonjour', '92.1.1.1');
    const faits = appels.slice(n0);
    return { ok: !r.pendue && ms >= DELAI * 1000 - 100 && ms < DELAI * 1000 + 1500 && r.decide === 'SANS_OBJET' && r.motif === 'DELAI_IA_DEPASSE'
      && r.reponse === null && faits.length === 1 && faits[0].detruit === 1,
      info: (r.pendue ? 'PENDUE ' : '') + ms + ' ms, ' + r.decide + '/' + r.motif + ', appels ' + faits.length + ', coupee ' + (faits[0] || {}).detruit };
  });

  await t('D2', "la réponse se tait après un plan normal : délai, motif clair, rien de mémorisé", async () => {
    const sid = await session('92.1.1.2'); const n0 = appels.length;
    comportements.push('normal', 'muet');
    /* v4.6.7 [S54] : « quelle heure est-il » est repondu par le serveur sans modele ; autre question */
    const { r, ms } = await chronoDire(sid, 'quelle est la capitale du Portugal', '92.1.1.2');
    const faits = appels.slice(n0);
    return { ok: !r.pendue && ms < DELAI * 1000 + 1500 && r.decide === 'SANS_OBJET' && r.motif === 'DELAI_IA_DEPASSE' && r.reponse === null
      && faits.length === 2 && faits[1].detruit === 1,
      info: (r.pendue ? 'PENDUE ' : '') + ms + ' ms, motif ' + r.motif + ', appels ' + faits.length };
  });

  await t('D3', "en-têtes reçus puis silence (délai d'inactivité insuffisant) : coupé au délai total", async () => {
    const sid = await session('92.1.1.3'); const n0 = appels.length;
    comportements.push('entetes');
    const { r, ms } = await chronoDire(sid, 'bonjour', '92.1.1.3');
    const faits = appels.slice(n0);
    return { ok: !r.pendue && ms < DELAI * 1000 + 1500 && r.motif === 'DELAI_IA_DEPASSE' && faits[0] && faits[0].detruit === 1,
      info: (r.pendue ? 'PENDUE ' : '') + ms + ' ms, motif ' + r.motif };
  });

  await t('D4', "réponse arrivée APRÈS le délai : ignorée, jamais mémorisée, le serveur continue", async () => {
    const sid = await session('92.1.1.4');
    comportements.push('normal', 'lent');
    const a = await chronoDire(sid, 'raconte-moi', '92.1.1.4');
    await dort(1800);   /* la reponse tardive (2,6 s) arrive pendant ce temps */
    const n0 = appels.length;
    comportements.push('normal', 'normal');
    const b = await chronoDire(sid, 'et ensuite', '92.1.1.4');
    const vu = JSON.stringify((appels[n0 + 1] || {}).corps || {});
    const incident = journal.filter((l) => /Rejet non gere|EXCEPTION|TypeError/.test(l));
    return { ok: a.r.motif === 'DELAI_IA_DEPASSE' && b.r.reponse && !/TARDIF-7Q4M/.test(vu) && !/TARDIF-7Q4M/.test(b.r.reponse) && incident.length === 0,
      info: 'tardif ' + (/TARDIF/.test(vu) ? 'MEMORISE' : 'ignore') + ', suivant ' + (b.r.reponse ? 'ok' : 'KO') + ', incidents ' + incident.length };
  });

  await t('D5', "connexion coupée en route : dit tout de suite (sans attendre le délai), la conversation continue", async () => {
    const sid = await session('92.1.1.5');
    comportements.push('coupe', 'normal');
    const { r, ms } = await chronoDire(sid, 'bonjour', '92.1.1.5');
    return { ok: !r.pendue && ms < 1000 && /^RESEAU/.test(String((r.plan || {}).erreur)) && !!r.reponse,
      info: ms + ' ms, plan ' + (r.plan || {}).erreur + ', reponse ' + (r.reponse ? 'oui' : 'non') };
  });

  await t('D6', "appel normal : jamais coupé, aucun minuteur qui se réveille après", async () => {
    const sid = await session('92.1.1.6'); const n0 = appels.length;
    comportements.push('normal', 'normal');
    const { r } = await chronoDire(sid, 'bonjour', '92.1.1.6');
    await dort(DELAI * 1000 + 400);
    const faits = appels.slice(n0);
    return { ok: !!r.reponse && faits.length === 2 && faits.every((a) => a.detruit === 0),
      info: 'coupes ' + faits.map((a) => a.detruit).join(',') };
  });

  await t('D7', "JARVIS_DELAI_IA : secondes, borné à 1..120, valeur illisible = 40 (vu dans /health)", async () => {
    const cas = [[undefined, '40 s'], ['1.5', '1.5 s'], ['0', '1 s'], ['999', '120 s'], ['abc', '40 s'], [' 12 ', '12 s'], ['Infinity', '40 s']];
    const vus = [];   /* un serveur a la fois : un seul processeur suffit */
    for (const [v] of cas) { const s = await santeDe(DIR, v === undefined ? {} : { JARVIS_DELAI_IA: v }); vus.push(s && s.delaiIa); }
    const faux = cas.filter(([, att], i) => vus[i] !== att).map(([v], i) => String(v) + '→' + vus[i]);
    return { ok: faux.length === 0, info: faux.length ? 'faux : ' + faux.join(' ; ') : cas.length + '/' + cas.length };
  });

  /* ============================= [S34] MANIFESTE ============================= */
  let MF = null; try { MF = require(path.join(DIR, 'jarvis-manifeste.js')); } catch { /* v4.6.0 : absent */ }
  const attendu = (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'MANIFESTE.json'), 'utf8')); } catch { return {}; } })();

  await t('M1', "tel que livré : /health « conforme », empreinte = celle du manifeste, --verifier réussit, aucune empreinte complète exposée", async () => {
    const h = await (await fetch(B + '/health')).json(); const c = verifierCli(DIR);
    return { ok: h.manifeste === 'conforme' && h.empreinte === attendu.empreinte && /^[0-9a-f]{12}$/.test(h.empreinte) && c.rc === 0
      && !/[0-9a-f]{64}/.test(JSON.stringify(h)) && h.passerelle === attendu.passerelle,
      info: h.manifeste + ' ' + h.empreinte + ' / attendu ' + attendu.empreinte + ', cli ' + c.rc };
  });

  await t('M2', "un seul octet changé dans jarvis-agenda.js : /health le nomme, --verifier échoue", async () => {
    const d = copie(); fs.appendFileSync(path.join(d, 'jarvis-agenda.js'), ' ');
    const h = await santeDe(d, { JARVIS_CLE_ACCES: CLE }); const c = verifierCli(d);
    return { ok: !!h && h.manifeste === 'non conforme : jarvis-agenda.js (différent)' && c.rc === 1 && /jarvis-agenda\.js/.test(c.texte),
      info: (h && h.manifeste) + ', cli ' + c.rc };
  });

  await t('M3', "server.js lui-même différent (ancien dépôt) : vu aussi", async () => {
    const d = copie(); fs.appendFileSync(path.join(d, 'server.js'), '\n/* ancien */\n');
    const h = await santeDe(d); const c = verifierCli(d);
    return { ok: !!h && h.manifeste === 'non conforme : server.js (différent)' && c.rc === 1, info: (h && h.manifeste) + ', cli ' + c.rc };
  });

  await t('M4', "fichier manquant (package.json) : nommé, --verifier échoue", async () => {
    const d = copie(); fs.unlinkSync(path.join(d, 'package.json'));
    const h = await santeDe(d); const c = verifierCli(d);
    return { ok: !!h && h.manifeste === 'non conforme : package.json (manquant)' && c.rc === 1, info: (h && h.manifeste) + ', cli ' + c.rc };
  });

  await t('M5', "MANIFESTE.json absent : le serveur démarre quand même, /health « absent », --verifier échoue", async () => {
    const d = copie(); fs.unlinkSync(path.join(d, 'MANIFESTE.json'));
    const h = await santeDe(d); const c = verifierCli(d);
    return { ok: !!h && h.status === 'ok' && h.manifeste === 'absent' && c.rc === 1, info: (h ? h.manifeste : 'NE DEMARRE PAS') + ', cli ' + c.rc };
  });

  await t('M6', "manifeste abîmé (6 formes) : jamais « conforme », le serveur démarre", async () => {
    if (!MF) return { ok: false, info: 'jarvis-manifeste.js absent' };
    const formes = ['{', '[]', 'null', '{"fichiers":null}', '{"fichiers":[1,2]}', '{"fichiers":{"__proto__":{"server.js":"x"}}}'];
    const d = copie(); const etats = formes.map((f) => { fs.writeFileSync(path.join(d, 'MANIFESTE.json'), f); return MF.verifier(d).etat; });
    fs.writeFileSync(path.join(d, 'MANIFESTE.json'), '{'); const h = await santeDe(d);
    return { ok: etats.every((e) => e === 'illisible' || e === 'non conforme') && !!h && h.manifeste === 'illisible',
      info: etats.join(', ') + ' ; serveur ' + (h ? h.manifeste : 'NE DEMARRE PAS') };
  });

  await t('M7', "le manifeste est une DONNÉE : un chemin qu'il indique n'est jamais lu", async () => {
    if (!MF) return { ok: false, info: 'jarvis-manifeste.js absent' };
    const d = copie(); const m = JSON.parse(fs.readFileSync(path.join(d, 'MANIFESTE.json'), 'utf8'));
    Object.assign(m.fichiers, { '../../../etc/passwd': 'x', '/etc/shadow': 'y', '..\\secret': 'z' });
    fs.writeFileSync(path.join(d, 'MANIFESTE.json'), JSON.stringify(m));
    const lus = [], orig = fs.readFileSync;
    fs.readFileSync = function (p, ...a) { lus.push(path.resolve(String(p))); return orig.call(this, p, ...a); };
    let r; try { r = MF.verifier(d); } finally { fs.readFileSync = orig; }
    const permis = new Set(MF.FICHIERS.concat('MANIFESTE.json').map((f) => path.join(d, f)));
    const hors = lus.filter((p) => !permis.has(p));
    return { ok: hors.length === 0 && r.etat === 'conforme', info: 'lus hors liste : ' + (hors.join(', ') || 'aucun') + ', etat ' + r.etat };
  });

  await t('M8', "un module local chargé mais absent de la liste : « hors manifeste »", async () => {
    const d = copie(); fs.writeFileSync(path.join(d, 'jarvis-extra.js'), 'module.exports = {};\n');
    fs.appendFileSync(path.join(d, 'jarvis-memoire.js'), "\nrequire('./jarvis-extra.js');\n");
    const h = await santeDe(d); const c = verifierCli(d);
    return { ok: !!h && /jarvis-extra\.js \(hors manifeste\)/.test(h.manifeste) && /jarvis-memoire\.js \(différent\)/.test(h.manifeste) && c.rc === 1,
      info: (h && h.manifeste) + ', cli ' + c.rc };
  });

  await t('M9', "calculé une fois au démarrage : décrit le code CHARGÉ, pas le disque d'après", async () => {
    const d = copie(); const s = await lancer(d);
    fs.appendFileSync(path.join(d, 'jarvis-agenda.js'), ' ');
    let h2 = null; try { h2 = await (await fetch('http://localhost:' + (port - 1) + '/health')).json(); } catch { /* arrete */ }
    s.arreter();
    return { ok: !!s.sante && s.sante.manifeste === 'conforme' && !!h2 && h2.manifeste === 'conforme', info: (s.sante && s.sante.manifeste) + ' puis ' + (h2 && h2.manifeste) };
  });

  await t('M10', "--ecrire : même fichier deux fois de suite (pas de date), version lue dans server.js, sans s'inclure", async () => {
    const d = copie(); const e = (x) => spawnSync(process.execPath, [path.join(d, 'jarvis-manifeste.js'), '--ecrire', d], { encoding: 'utf8' }).status;
    e(); const a = fs.readFileSync(path.join(d, 'MANIFESTE.json'), 'utf8'); e(); const b = fs.readFileSync(path.join(d, 'MANIFESTE.json'), 'utf8');
    const m = JSON.parse(a); const v = (/passerelle:\s*'(v[0-9.]+)'/.exec(fs.readFileSync(path.join(d, 'server.js'), 'utf8')) || [])[1];
    return { ok: a === b && m.passerelle === v && !('MANIFESTE.json' in m.fichiers) && a === fs.readFileSync(path.join(DIR, 'MANIFESTE.json'), 'utf8'),
      info: 'identiques ' + (a === b) + ', version ' + m.passerelle + ', = livre ' + (a === fs.readFileSync(path.join(DIR, 'MANIFESTE.json'), 'utf8')) };
  });

  /* ================================ LA PAGE ================================ */
  await t('P1', "page : délai dépassé dit en français, sans code ; les autres erreurs inchangées", async () => {
    const { JSDOM, VirtualConsole } = require(process.env.JSDOM || 'jsdom');
    const vc = new VirtualConsole(); const err = []; vc.on('jsdomError', (e) => err.push(e.message));
    const dom = new JSDOM(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), { url: B + '/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
      beforeParse(w) { w.fetch = () => new Promise(() => {}); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
    const w = dom.window; await dort(300);
    if (typeof w.rendreDecision !== 'function') return { ok: false, info: 'rendreDecision introuvable' };
    const dernier = () => [...w.document.querySelectorAll('#fil .tour')].pop().textContent;
    w.rendreDecision({ decide: 'SANS_OBJET', motif: 'DELAI_IA_DEPASSE', plan: { action: 'AUCUNE', erreur: 'DELAI_IA_DEPASSE' }, reponse: null }); const a = dernier();
    w.rendreDecision({ decide: 'SANS_OBJET', motif: 'DELAI_IA_DEPASSE', plan: { action: 'AUCUNE' }, reponse: null }); const b = dernier();
    w.rendreDecision({ decide: 'SANS_OBJET', motif: null, plan: { action: 'AUCUNE', erreur: 'API_529' }, reponse: null }); const c = dernier();
    const bon = (x) => /n'a pas répondu à temps/.test(x) && !/DELAI_IA_DEPASSE/.test(x);
    return { ok: bon(a) && bon(b) && /Pas de réponse : API_529/.test(c), info: [a, b, c].map((x) => x.slice(0, 48)).join(' | ') };
  });

  /* ================================= BILAN ================================= */
  console.log = log;
  for (const r of R) log((r.ok ? 'OK    ' : 'ECHEC ') + r.id.padEnd(4) + ' ' + r.nom + (r.info ? '\n           [' + r.info + ']' : ''));
  const n = R.filter((r) => r.ok).length;
  log('\n>>> ' + n + '/' + R.length + ' tests passent');
  process.exit(n === R.length ? 0 : 1);
})();
