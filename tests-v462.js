'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.6.2                                 node tests-v462.js
 * ----------------------------------------------------------------------------
 * [S35] Vu en vrai le 25 sept : un code de secours avec des lettres etait
 *   accepte par le serveur mais impossible a taper (clavier a chiffres), et
 *   chaque toucher sur « Confirmer l'envoi » empilait une nouvelle carte.
 *  - le code : 12 a 64 chiffres, rien d'autre ;
 *  - FERME PAR DEFAUT : une variable d'elevation presente mais illisible
 *    laisse l'irreversible BLOQUE (avant : protection eteinte en silence) ;
 *  - la page : une seule carte par action, pas de double requete, carte
 *    eteinte une fois l'identite prouvee ; l'etat d'une action s'ecrit dans
 *    SA boite (plus de « Pas encore : INTROUVABLE » empile a chaque toucher,
 *    plus de « annulee » apres un envoi, un decompte par boite).
 * Vrais serveurs (processus a cote) + la page dans jsdom (vrai serveur).
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const EL = require(path.join(DIR, 'jarvis-elevation.js'));
const CLE = 'cle-de-test-longue-et-aleatoire-v462';
const CODE = '509183746201';
const BASE = Number(process.env.JARVIS_PORT_TEST) || 3991;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = EL.b64u;

/* ---- faux Claude, pour ce processus et pour les serveurs lances a cote ---- */
const FAUX = `const https=require('https'),{EventEmitter}=require('events');
const plans=JSON.parse(process.env.FAUX_PLANS||'[]');
https.request=(o,cb)=>{const q=new EventEmitter();let s='';q.write=x=>{s+=x};q.setTimeout=()=>q;q.destroy=()=>q;
 q.end=()=>{const c=JSON.parse(s),r=new EventEmitter();r.statusCode=200;r.complete=true;cb(r);
  const t=c.max_tokens===200?JSON.stringify(plans.shift()||{action:'AUCUNE'}):'Réponse.';
  r.emit('data',JSON.stringify({content:[{type:'text',text:t}]}));r.emit('end');r.emit('close');};return q;};`;
const PRECHARGE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-v462-')), 'faux-claude.js');
fs.writeFileSync(PRECHARGE, FAUX);

const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };

let port = BASE + 10;
const lancer = async (env = {}, plans = []) => {
  const p = port++;
  const enfant = spawn(process.execPath, ['-r', PRECHARGE, 'server.js'], { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'test', PORT: String(p), FAUX_PLANS: JSON.stringify(plans), ...env } });
  let sortie = ''; enfant.stdout.on('data', (d) => { sortie += d; }); enfant.stderr.on('data', (d) => { sortie += d; });
  let sante = null;
  for (let i = 0; i < 150 && !sante && enfant.exitCode === null; i++) {
    await dort(100);
    /* [S37] v4.6.3 : sur une instance protegee, le detail de /health demande la cle */
    try { sante = await (await fetch('http://localhost:' + p + '/health', { signal: AbortSignal.timeout(1000),
      headers: env.JARVIS_CLE_ACCES ? { 'X-Jarvis-Cle': env.JARVIS_CLE_ACCES } : {} })).json(); } catch { /* pas encore */ }
  }
  const appel = async (chemin, corps) => {
    const r = await fetch('http://localhost:' + p + chemin, { method: corps ? 'POST' : 'GET', body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(6000), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '93.1.1.1', 'X-Jarvis-Cle': env.JARVIS_CLE_ACCES || '' } });
    const x = await r.text(); try { return JSON.parse(x); } catch { return { brut: x }; }
  };
  return { sante, appel, sortie: () => sortie, arreter: () => { try { enfant.kill('SIGKILL'); } catch { /* deja arrete */ } } };
};
const santeDe = async (env) => { const s = await lancer(env); s.arreter(); return s; };
const cleFaceId = () => {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const j = publicKey.export({ format: 'jwk' });
  return b64u(JSON.stringify({ id: b64u(crypto.randomBytes(32)), x: j.x, y: j.y }));
};

/* ---- la page : ce processus porte un vrai serveur (code valide, sans Face ID) ---- */
const plans = [];
https.request = (o, cb) => {
  const q = new EventEmitter(); let s = '';
  q.write = (x) => { s += x; }; q.setTimeout = () => q; q.destroy = () => q;
  q.end = () => { const c = JSON.parse(s), r = new EventEmitter(); r.statusCode = 200; r.complete = true; cb(r);
    const texte = c.max_tokens === 200 ? JSON.stringify(plans.shift() || { action: 'AUCUNE' }) : 'Réponse.';
    r.emit('data', JSON.stringify({ content: [{ type: 'text', text: texte }] })); r.emit('end'); r.emit('close'); };
  return q;
};
Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', PORT: String(BASE), JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: CODE });
for (const k of ['JARVIS_AGENDA_ICAL', 'JARVIS_GOOGLE_COMPTE', 'JARVIS_AGENDA_JARVIS', 'JARVIS_PASSKEYS']) delete process.env[k];
const log = console.log; console.log = () => {}; console.error = () => {};
require(path.join(DIR, 'server.js'));
const B = 'http://localhost:' + BASE;

(async () => {
  await dort(500);

  /* ============================ LE CODE LUI-MEME ============================ */
  await t('C1', 'code de secours : 12 à 64 chiffres acceptés ; lettres, espaces, trop court, trop long refusés', async () => {
    const cas = { '509183746201': true, ['9'.repeat(64)]: true, '482913': false, '50918374620': false, 'abcdefghijkl': false,
      'Jarvis2026!!x': false, '5091 8374 6201': false, ['9'.repeat(65)]: false, '': false };
    const faux = Object.entries(cas).filter(([c, attendu]) => EL.creerElevation({ code: c }).codeSecours !== attendu || EL.codeValide(c) !== attendu);
    return { ok: faux.length === 0 && EL.VERSION === '1.1', info: faux.length ? 'faux sur ' + faux.map(x => JSON.stringify(x[0])).join(', ') : 'elevation ' + EL.VERSION };
  });

  /* ======================= FERME PAR DEFAUT (serveur) ======================= */
  const envoi = { action: 'SEND', resource: 'EMAIL', target: 'pierre@exemple.fr' };
  const mal = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: 'abcdefghijkl' }, [envoi]);
  await t('C2', "code avec des lettres : /health « erreur-config » (plus « inactif »), le journal le crie", async () =>
    ({ ok: mal.sante && /^v4\.6\.[2-9]$/.test(mal.sante.passerelle) && mal.sante.elevation === 'erreur-config' && /MAL CONFIGUREE/.test(mal.sortie()) && /12 a 64 chiffres/.test(mal.sortie()),
       info: mal.sante && (mal.sante.passerelle + ' ' + mal.sante.elevation) }));

  await t('C3', "code illisible : l'envoi irréversible reste BLOQUÉ (avant v4.6.2 il partait sans code ni Face ID)", async () => {
    const sid = (await mal.appel('/api/session', {})).sessionId;
    const d = await mal.appel('/api/chat', { sessionId: sid, message: 'envoie les factures à pierre@exemple.fr' });
    await dort(10400);
    const f1 = await mal.appel('/api/finaliser', { sessionId: sid, jeton: d.jetonAnnulation });
    const c = await mal.appel('/api/elevation/code', { sessionId: sid, code: 'abcdefghijkl' });
    const f2 = await mal.appel('/api/finaliser', { sessionId: sid, jeton: d.jetonAnnulation });
    return { ok: d.decide === 'EN_ATTENTE' && f1.etat === 'ELEVATION_REQUISE' && f1.moyens.erreurConfig === true && f1.moyens.code === false
      && !c.ok && f2.etat === 'ELEVATION_REQUISE',
      info: d.decide + ' ; ' + f1.etat + ' erreurConfig=' + (f1.moyens || {}).erreurConfig + ' ; code ' + (c.motif || c.ok) + ' ; ' + f2.etat };
  });
  mal.arreter();

  await t('C4', "12 chiffres : « code » ; l'ancien code à 6 chiffres : « erreur-config » (à changer dans Render)", async () => {
    const bon = await santeDe({ JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: CODE });
    const six = await santeDe({ JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: '482913' });
    return { ok: bon.sante.elevation === 'code' && six.sante.elevation === 'erreur-config', info: bon.sante.elevation + ' / ' + six.sante.elevation };
  });

  await t('C5', 'Face ID valide + code illisible : Face ID protège, /health dit « faceid+code-refuse »', async () => {
    const s = await santeDe({ JARVIS_CLE_ACCES: CLE, JARVIS_PASSKEYS: cleFaceId(), JARVIS_CODE_SECOURS: 'abcdefghijkl' });
    return { ok: s.sante.elevation === 'faceid+code-refuse', info: s.sante.elevation };
  });

  await t('C6', "démo publique : variables ignorées (« inactif ») ; variable vide : pas d'élévation", async () => {
    const pub = await santeDe({ JARVIS_CODE_SECOURS: 'abcdefghijkl' });
    const vide = await santeDe({ JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: '   ' });
    return { ok: pub.sante.acces === 'public' && pub.sante.elevation === 'inactif' && vide.sante.elevation === 'inactif',
      info: pub.sante.acces + ' ' + pub.sante.elevation + ' / vide ' + vide.sante.elevation };
  });

  /* =============================== LA PAGE =============================== */
  const { JSDOM, VirtualConsole } = require(process.env.JSDOM || 'jsdom');
  const html = await fetch(B + '/').then(r => r.text());
  const vc = new VirtualConsole(); const err = []; vc.on('jsdomError', e => err.push(e.message));
  const corps = [];
  const dom = new JSDOM(html, { url: B + '/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, beforeParse(w) {
    w.localStorage.setItem('jarvis_cle', CLE);
    w.fetch = (u, o) => { if (o && o.body) corps.push({ u: String(u), b: JSON.parse(o.body) }); return fetch(new URL(u, B + '/').href, o); };
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () { w.__vu = this; };
  } });
  const w = dom.window, d = w.document, $ = id => d.getElementById(id);
  await dort(1200);
  const clic = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const finalisations = () => corps.filter(x => /\/api\/finaliser/.test(x.u)).length;
  const cartes = () => d.querySelectorAll('#fil .elevation').length;

  /* [S40 - v4.6.4] une seule action en attente a la fois : un nouveau message
   * annule celle qui attend. Chaque action est donc traitee avant la suivante
   * (avant : deux boites ouvertes en meme temps). P1 et P2 portent sur la 1re. */
  plans.push({ ...envoi }); $('msg').value = 'envoie les factures à pierre@exemple.fr'; clic($('envoyer')); await dort(700);
  const confirmer1 = [...d.querySelectorAll('button[data-finaliser]')].pop();
  await dort(10400);

  clic(confirmer1); clic(confirmer1); await dort(800);
  const n1 = finalisations(), carte1 = [...d.querySelectorAll('#fil .elevation')].pop();
  await t('P2', 'deux touchers rapides (avant la réponse du serveur) : une seule requête, une seule carte', async () =>
    ({ ok: n1 === 1 && cartes() === 1, info: 'requetes ' + n1 + ', cartes ' + cartes() }));
  clic(confirmer1); await dort(400); clic(confirmer1); await dort(400);
  await t('P1', "« Confirmer l'envoi » re-touché : toujours UNE carte, UNE requête ; les suivants ramènent à la carte (champ du code actif)", async () =>
    ({ ok: !!carte1 && finalisations() === 1 && cartes() === 1 && w.__vu === carte1 && d.activeElement === carte1.querySelector('input.code'),
       info: 'requetes ' + finalisations() + ', cartes ' + cartes() + ', focus ' + (d.activeElement && d.activeElement.className) }));

  const champ = carte1.querySelector('input.code');
  await t('P3', 'le champ du code : clavier à chiffres, masqué', async () =>
    ({ ok: champ.getAttribute('inputmode') === 'numeric' && champ.type === 'password', info: champ.getAttribute('inputmode') + ' ' + champ.type }));

  champ.value = CODE; clic(carte1.querySelector('[data-code]')); await dort(1000);
  const nApres = finalisations();
  clic(confirmer1); await dort(400);
  const boite1 = confirmer1.closest('.retenue');
  await t('P4', "bon code : envoyé, carte éteinte, la boîte dit « Envoyé. », ses boutons s'éteignent, rien ne se relance", async () =>
    ({ ok: /Code validé/.test(carte1.textContent) && /Envoyé\./.test($('fil').textContent) && carte1.dataset.fini === '1'
         && [...carte1.querySelectorAll('button, input')].every(x => x.disabled) && boite1.querySelector('.compte').textContent === 'Envoyé.'
         && [...boite1.querySelectorAll('button')].every(x => x.disabled) && finalisations() === nApres && cartes() === 1,
       info: 'fini=' + carte1.dataset.fini + ', boite « ' + boite1.querySelector('.compte').textContent + ' », requetes ' + finalisations() }));

  const bulles = () => d.querySelectorAll('#fil .tour').length;
  const b0 = bulles(), f0 = finalisations(), a0 = corps.filter(x => /\/api\/annuler/.test(x.u)).length;
  for (let i = 0; i < 3; i++) { clic(confirmer1); clic(boite1.querySelector('[data-annuler]')); await dort(250); }
  await t('P7', "après l'envoi : « Confirmer » et « Annuler » touchés 3 fois chacun → aucune bulle, aucune requête, pas de faux « annulée »", async () =>
    ({ ok: bulles() === b0 && finalisations() === f0 && corps.filter(x => /\/api\/annuler/.test(x.u)).length === a0 && !/jamais eu lieu/.test($('fil').textContent),
       info: 'bulles +' + (bulles() - b0) + ', requetes +' + (finalisations() - f0) }));

  /* action 2 : envoyée PAR AILLEURS (autre onglet), la page ne le sait pas */
  plans.push({ action: 'SEND', resource: 'EMAIL', target: 'luc@exemple.fr' }); $('msg').value = 'envoie les factures à luc@exemple.fr'; clic($('envoyer')); await dort(700);
  const confirmer2 = [...d.querySelectorAll('button[data-finaliser]')].pop();
  await dort(10400);
  const sidPage = corps.filter(x => x.b && x.b.sessionId).pop().b.sessionId;
  const ailleurs = await fetch(B + '/api/finaliser', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Cle': CLE },
    body: JSON.stringify({ sessionId: sidPage, jeton: confirmer2.dataset.finaliser }) }).then(r => r.json());
  const b1 = bulles();
  clic(confirmer2); await dort(600);
  const boite2 = confirmer2.closest('.retenue'), b2 = bulles();
  clic(confirmer2); clic(confirmer2); clic(boite2.querySelector('[data-annuler]')); await dort(500);
  await t('P8', "action déjà partie ailleurs : la boîte dit « Déjà traitée », UNE fois ; plus jamais « Pas encore : INTROUVABLE »", async () =>
    ({ ok: ailleurs.etat === 'EXECUTE' && /Déjà traitée/.test(boite2.querySelector('.compte').textContent) && !/INTROUVABLE/.test($('fil').textContent)
         && bulles() === b2 && b2 === b1 && [...boite2.querySelectorAll('button')].every(x => x.disabled) && !/jamais eu lieu/.test($('fil').textContent),
       info: 'ailleurs ' + ailleurs.etat + ' ; boite « ' + boite2.querySelector('.compte').textContent.slice(0, 40) + ' » ; bulles +' + (bulles() - b1) }));

  /* action 3 : annulée pendant la fenêtre ; décompte dans SA boîte */
  plans.push({ action: 'SEND', resource: 'EMAIL', target: 'zoe@exemple.fr' }); $('msg').value = 'envoie les factures à zoe@exemple.fr'; clic($('envoyer')); await dort(1800);
  const confirmer3 = [...d.querySelectorAll('button[data-finaliser]')].pop(), boite3 = confirmer3.closest('.retenue');
  const decompte = boite3.querySelector('.compte').textContent, avant1 = boite1.querySelector('.compte').textContent;
  const b3 = bulles();
  clic(boite3.querySelector('[data-annuler]')); await dort(500); clic(boite3.querySelector('[data-annuler]')); clic(confirmer3); await dort(400);
  await t('P9', "3e action : décompte dans SA boîte (pas dans la 1re) ; « Annuler » → « Annulée », une bulle, re-toucher ne fait rien", async () =>
    ({ ok: /s avant que la confirmation/.test(decompte) && avant1 === 'Envoyé.' && /Annulée/.test(boite3.querySelector('.compte').textContent)
         && bulles() === b3 + 1 && [...boite3.querySelectorAll('button')].every(x => x.disabled),
       info: '« ' + decompte.slice(0, 45) + ' » ; boite1 « ' + avant1 + ' » ; bulles +' + (bulles() - b3) }));

  w.demanderElevation('jeton-test', { faceId: false, code: false, erreurConfig: true });
  await t('P5', 'code mal réglé côté serveur : la carte le dit en clair (au lieu de « aucun moyen »)', async () => {
    const c = [...d.querySelectorAll('#fil .elevation')].pop().textContent;
    return { ok: /mal réglé dans Render/.test(c) && /12 à 64 chiffres/.test(c) && !/Aucun moyen/.test(c), info: c.slice(0, 90) };
  });
  await t('P6', 'aucune erreur JavaScript dans la page', async () => ({ ok: err.length === 0, info: err.slice(0, 2).join(' | ') }));

  log('JARVIS — passerelle v4.6.2 : code de secours, fermé par défaut, carte unique\n');
  for (const r of R) log((r.ok ? 'OK    ' : 'ECHEC ') + r.id.padEnd(4) + ' ' + r.nom + (r.info ? '  [' + r.info + ']' : ''));
  const k = R.filter(r => !r.ok).length;
  log('\n>>> ' + (R.length - k) + '/' + R.length + ' tests passent');
  process.exit(k ? 1 : 0);
})();
