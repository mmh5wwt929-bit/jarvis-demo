'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.6.3                                 node tests-v463.js
 * ----------------------------------------------------------------------------
 * Vu en ligne le 25 sept par Alsid :
 *  [S36] « Paiement vers alsid » execute (simule) avec clic + Face ID ;
 *        « oui paie la facture » accepte comme destinataire ; adresse dictee
 *        « alcide.:-)j@yahoo.fr » ; « Envoie une facture » sans destinataire
 *        -> cible inventee « CONVERSATION ».
 *  [S37] /health de l'instance privee, lisible sans cle, disait ce qui est
 *        branche (agenda, elevation par code seul).
 *  [S38] bandeau « Face ID actif » apres une validation par le CODE.
 *  [S39] proprietaire bloque 44 min (24 appels IA/h), message « de la demo »
 *        sur SON instance.
 * Chaque test ECHOUE sur la v4.6.2 (sauf ceux marques « garde » ou
 * « contre-epreuve », qui prouvent qu'on n'a rien casse).
 * Vrais serveurs (ce processus + processus a cote) et la page dans jsdom.
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v463';
const CODE = '509183746201';
const BASE = Number(process.env.JARVIS_PORT_TEST) || 4061;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));
const crypto = require('crypto');
const EL = require(path.join(DIR, 'jarvis-elevation.js'));
const cleFaceId = () => {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const j = publicKey.export({ format: 'jwk' });
  return EL.b64u(JSON.stringify({ id: EL.b64u(crypto.randomBytes(32)), x: j.x, y: j.y }));
};

const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };

/* ---- faux Claude, pour ce processus et pour les serveurs lances a cote ---- */
const FAUX = `const https=require('https'),{EventEmitter}=require('events');
const plans=JSON.parse(process.env.FAUX_PLANS||'[]');
https.request=(o,cb)=>{const q=new EventEmitter();let s='';q.write=x=>{s+=x};q.setTimeout=()=>q;q.destroy=()=>q;
 q.end=()=>{const c=JSON.parse(s),r=new EventEmitter();r.statusCode=200;r.complete=true;cb(r);
  const t=c.max_tokens===200?JSON.stringify(plans.shift()||{action:'AUCUNE'}):'Réponse.';
  r.emit('data',JSON.stringify({content:[{type:'text',text:t}]}));r.emit('end');r.emit('close');};return q;};`;
const PRECHARGE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-v463-')), 'faux-claude.js');
fs.writeFileSync(PRECHARGE, FAUX);

let port = BASE + 10;
const lancer = async (env = {}) => {
  const p = port++;
  const enfant = spawn(process.execPath, ['-r', PRECHARGE, 'server.js'], { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'test', PORT: String(p), ...env } });
  let sortie = ''; enfant.stdout.on('data', (d) => { sortie += d; }); enfant.stderr.on('data', (d) => { sortie += d; });
  let pret = false;
  for (let i = 0; i < 150 && !pret && enfant.exitCode === null; i++) {
    await dort(100);
    try { pret = (await fetch('http://localhost:' + p + '/health', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* pas encore */ }
  }
  const brut = (chemin, o = {}) => fetch('http://localhost:' + p + chemin, { signal: AbortSignal.timeout(6000), ...o });
  const appel = async (chemin, corps, entetes = {}) => {
    const r = await brut(chemin, { method: corps ? 'POST' : 'GET', body: corps ? JSON.stringify(corps) : undefined,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '93.4.4.4', ...entetes } });
    const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
    return { status: r.status, ...j };
  };
  return { brut, appel, sortie: () => sortie, arreter: () => { try { enfant.kill('SIGKILL'); } catch { /* deja arrete */ } } };
};

/* ---- ce processus porte un vrai serveur : instance protegee + code de secours ---- */
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
for (const k of ['JARVIS_AGENDA_ICAL', 'JARVIS_GOOGLE_COMPTE', 'JARVIS_AGENDA_JARVIS', 'JARVIS_PASSKEYS', 'JARVIS_CONFIG_ATTENDUE', 'JARVIS_APPELS_HEURE']) delete process.env[k];
const log = console.log; console.log = () => {}; console.error = () => {};
require(path.join(DIR, 'server.js'));
const B = 'http://localhost:' + BASE;
let IP = '81.1.1.1';
const appel = async (chemin, corps) => {
  const r = await fetch(B + chemin, { method: corps ? 'POST' : 'GET', body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(6000), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, 'X-Jarvis-Cle': CLE } });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
  return { status: r.status, ...j };
};
const session = async () => (await appel('/api/session', {})).sessionId;

(async () => {
  await dort(500);

  /* ====================== [S36] LE DESTINATAIRE ====================== */
  let sid = await session();
  plans.push({ action: 'PAY', resource: 'BANQUE', target: 'alsid' });
  const d2 = await appel('/api/chat', { sessionId: sid, message: 'paie la facture à alsid' });
  await t('D1', "« paie la facture à alsid » (verbe + cible tapés) : refusé AVANT le noyau, rien de retenu, le motif dit en clair", async () =>
    ({ ok: d2.decide === 'SANS_OBJET' && d2.etape === 'DESTINATAIRE' && d2.motif === 'ADRESSE_INVALIDE' && !d2.jetonAnnulation
         && /« alsid » n'est pas une adresse e-mail complète/.test(d2.reponse || ''),
       info: d2.decide + ' / ' + d2.etape + ' / ' + d2.motif }));

  plans.push({ action: 'SEND', resource: 'EMAIL' });   /* le modele ne donne AUCUNE cible */
  const d3 = await appel('/api/chat', { sessionId: sid, message: "envoie une facture s'il te plaît" });
  await t('D2', "« envoie une facture » sans destinataire : « À qui ? », plus de cible inventée « CONVERSATION », rien soumis au noyau", async () =>
    ({ ok: d3.decide === 'SANS_OBJET' && d3.motif === 'DESTINATAIRE_MANQUANT' && /^À qui \?/.test(d3.reponse || '')
         && !d3.jetonAnnulation && !d3.aReformuler && !(d3.audit || []).some(e => /SEND/.test(JSON.stringify(e))),
       info: d3.decide + ' / ' + d3.motif + ' / « ' + String(d3.reponse || '').slice(0, 30) + ' »' }));

  /* la cible retapee : controlee avant de consommer la preuve */
  const mauvaises = ['alsid', 'oui paie la facture', 'alcide.:-)j@yahoo.fr', 'a@b', 'nom@exemple', '.nom@exemple.fr', 'nom..x@exemple.fr',
    'nom@-exemple.fr', 'nom@exemple.f', 'аlsid@yahoo.fr' /* a cyrillique */, 'nom@exemple.fr\u200b', 'nom@exemple.fr\u202e', 'a b@exemple.fr'];
  const reps = [];
  for (const c of mauvaises) reps.push(await appel('/api/reformuler', { sessionId: sid, action: 'PAY', cible: c, resource: 'BANQUE' }));
  await t('D3', 'cible retapée : prénom, phrase, adresse dictée cassée, sans domaine, points, tiret, sosie cyrillique, caractère invisible : 13/13 refusés', async () => {
    const passees = mauvaises.filter((c, i) => !(reps[i].status === 400 && reps[i].erreur === 'ADRESSE_INVALIDE' && !reps[i].decision));
    return { ok: passees.length === 0, info: passees.length ? 'passées : ' + passees.map(x => JSON.stringify(x)).join(', ') : '13 refus ADRESSE_INVALIDE' };
  });

  const bonne = await appel('/api/reformuler', { sessionId: sid, action: 'PAY', cible: 'alsid.smailji@yahoo.fr', resource: 'BANQUE' });
  await t('D4', "après les refus, la bonne adresse passe dans la même session : la preuve clavier n'a pas été gâchée", async () =>
    ({ ok: bonne.status === 200 && bonne.decision && bonne.decision.decide === 'EN_ATTENTE' && !!bonne.decision.jetonAnnulation
         && mauvaises.every((c, i) => reps[i].status === 400),
       info: bonne.status + ' ' + (bonne.decision && bonne.decision.decide) }));
  if (bonne.decision && bonne.decision.jetonAnnulation) await appel('/api/annuler', { sessionId: sid, jeton: bonne.decision.jetonAnnulation });

  const imposee = await appel('/api/chat', { sessionId: sid, message: 'démo', action: 'SEND', cible: 'x' });
  await t('D5', "« Imposer l'action à la main » vers « x » : même règle", async () =>
    ({ ok: imposee.decide === 'SANS_OBJET' && imposee.motif === 'ADRESSE_INVALIDE' && !imposee.jetonAnnulation, info: imposee.decide + ' / ' + imposee.motif }));

  IP = '81.1.1.2';   /* autre visiteur : ces contre-epreuves ne dependent pas de la limite horaire */
  sid = await session();
  const bonnes = ['pierre@exemple.fr', 'Alsid.Smailji@Yahoo.fr', 'a.b-c+d@sous.exemple.co.uk', 'x@xn--bcher-kva.fr'];
  const oks = [];
  for (const c of bonnes) {
    plans.push({ action: 'SEND', resource: 'EMAIL', target: c });
    const r = await appel('/api/chat', { sessionId: sid, message: 'envoie les factures à ' + c });
    oks.push(r);
    if (r.jetonAnnulation) await appel('/api/annuler', { sessionId: sid, jeton: r.jetonAnnulation });
  }
  await t('D6', 'contre-épreuve : 4 vraies adresses (majuscules, sous-domaine, +, domaine xn--) tapées avec le verbe : retenues 10 s comme avant', async () =>
    ({ ok: oks.every(r => r.decide === 'EN_ATTENTE' && !!r.jetonAnnulation), info: oks.map(r => r.decide).join(' ') }));

  plans.push({ action: 'PAY', resource: 'BANQUE', target: 'facture 4471' });
  const inj = await appel('/api/chat', { sessionId: sid, message: "d'accord" });
  await t('D7', "garde : une action que tu n'as pas demandée garde son refus de vigilance (jamais « À qui ? » pour elle)", async () =>
    ({ ok: inj.decide === 'REFUSE' && inj.etape === 'VIGILANCE_INTENTION' && !/À qui/.test(String(inj.reponse || '')),
       info: inj.decide + ' / ' + inj.etape }));

  /* ====================== [S37] /HEALTH DISCRET ====================== */
  const nu = await (await fetch(B + '/health', { headers: { 'CF-Connecting-IP': '81.2.2.2' } })).json();
  await t('H1', 'instance protégée, /health SANS clé : ni agenda, ni écriture, ni élévation, ni IP ; versions, manifeste et verdict gardés', async () => {
    const tus = ['agenda', 'ecriture', 'elevation', 'tonIp', 'ip', 'ipDepuis', 'delaiIa'].filter(k => k in nu);
    return { ok: tus.length === 0 && nu.passerelle === 'v4.6.3' && nu.acces === 'protege' && nu.config === 'non-declaree'
               && typeof nu.empreinte === 'string' && typeof nu.manifeste === 'string',
             info: tus.length ? 'dit encore : ' + tus.join(', ') : Object.keys(nu).join(',') };
  });
  const avecCle = await (await fetch(B + '/health', { headers: { 'CF-Connecting-IP': '81.2.2.2', 'X-Jarvis-Cle': CLE } })).json();
  const apiSante = await appel('/api/health');
  const sansCleApi = await fetch(B + '/api/health', { headers: { 'CF-Connecting-IP': '81.2.2.3' } });
  await t('H2', 'le détail complet : /health avec la bonne clé, ou /api/health (derrière la clé ; sans clé : 401)', async () =>
    ({ ok: avecCle.elevation === 'code' && avecCle.agenda === 'inactif' && apiSante.elevation === 'code' && apiSante.tonIp === IP
         && sansCleApi.status === 401,
       info: 'avec cle ' + avecCle.elevation + ', api ' + apiSante.elevation + ', api sans cle ' + sansCleApi.status }));
  for (let i = 0; i < 15; i++) await fetch(B + '/health', { headers: { 'CF-Connecting-IP': '81.3.3.3' } });
  const faux = [];
  for (let i = 0; i < 3; i++) faux.push((await fetch(B + '/health', { headers: { 'CF-Connecting-IP': '81.4.4.4', 'X-Jarvis-Cle': 'mauvaise-cle-' + i } })).status);
  const apres = await fetch(B + '/api/session', { method: 'POST', headers: { 'CF-Connecting-IP': '81.3.3.3', 'X-Jarvis-Cle': CLE } });
  await t('H3', "garde : 15 visites de /health sans clé n'usent pas le compteur d'essais ; une MAUVAISE clé sur /health est refusée (401)", async () =>
    ({ ok: apres.status === 200 && faux.every(s => s === 401), info: 'session apres visites ' + apres.status + ', mauvaises cles ' + faux.join(',') }));

  const cas = [
    ['non-declaree', {}],
    ['ok', { JARVIS_CONFIG_ATTENDUE: 'code' }],
    ['ok', { JARVIS_CONFIG_ATTENDUE: ' Code , ' }],
    ['ecart', { JARVIS_CONFIG_ATTENDUE: 'code,faceid' }],        /* Face ID attendu, absent */
    ['ecart', { JARVIS_CONFIG_ATTENDUE: 'agenda' }],             /* code actif, non attendu */
    ['ecart', { JARVIS_CONFIG_ATTENDUE: 'code', JARVIS_PASSKEYS: cleFaceId() }],   /* Face ID EN TROP, seul ecart */
    ['ok', { JARVIS_CONFIG_ATTENDUE: 'faceid,code', JARVIS_PASSKEYS: cleFaceId() }],
    ['erreur-config', { JARVIS_CONFIG_ATTENDUE: 'code,facid' }],  /* faute de frappe */
    ['ecart', { JARVIS_CONFIG_ATTENDUE: 'code', JARVIS_CODE_SECOURS: '1234' }],  /* code illisible */
    ['ecart', { JARVIS_CONFIG_ATTENDUE: 'code', JARVIS_PASSKEYS: 'valeur-abimee' }]   /* Face ID colle de travers, meme non attendu */
  ];
  const verdicts = [];
  for (const [attendu, env] of cas) {
    const s = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: CODE, ...env });
    const h = await (await s.brut('/health')).json().catch(() => ({}));
    verdicts.push({ attendu, vu: h.config, fuite: 'elevation' in h || 'agenda' in h });
    s.arreter();
  }
  await t('H4', 'verdict « config » : non-declaree, ok (3), ecart si un module manque / est en trop / est illisible, erreur-config si faute de frappe', async () => {
    const faux = verdicts.filter(v => v.vu !== v.attendu || v.fuite);
    return { ok: faux.length === 0, info: verdicts.map(v => v.vu).join(' ') };
  });

  const demo = await lancer({ JARVIS_CODE_SECOURS: CODE });
  const hd = await (await demo.brut('/health')).json();
  await t('H5', 'contre-épreuve : la démo publique garde son /health détaillé (rien à cacher), sans champ « config »', async () =>
    ({ ok: hd.acces === 'public' && hd.elevation === 'inactif' && hd.agenda === 'inactif' && !('config' in hd) && hd.passerelle === 'v4.6.3',
       info: hd.acces + ' ' + hd.elevation + ' ' + ('config' in hd ? 'config!' : '') }));

  /* ====================== [S39] LIMITE HORAIRE ====================== */
  const compte = async (s, entetes) => {
    const sidL = (await s.appel('/api/session', {}, entetes)).sessionId;
    let n = 0;
    for (let i = 0; i < 80; i++) {
      const r = await s.appel('/api/reformuler', { sessionId: sidL, action: 'READ', cible: 'x' + i, resource: 'LOCAL' }, entetes);
      if (r.status === 429) break; n++;
    }
    return n;
  };
  const nDemo = await compte(demo, {}); demo.arreter();
  const perso = await lancer({ JARVIS_CLE_ACCES: CLE });
  const nPerso = await compte(perso, { 'X-Jarvis-Cle': CLE }); perso.arreter();
  const regle = await lancer({ JARVIS_CLE_ACCES: CLE, JARVIS_APPELS_HEURE: '10' });
  const nRegle = await compte(regle, { 'X-Jarvis-Cle': CLE }); regle.arreter();
  await t('L1', 'appels IA par heure : 60 sur ton instance (24 avant), 24 sur la démo, et JARVIS_APPELS_HEURE garde la main', async () =>
    ({ ok: nPerso === 60 && nDemo === 24 && nRegle === 10, info: 'perso ' + nPerso + ', demo ' + nDemo + ', regle 10 -> ' + nRegle }));

  /* =============================== LA PAGE =============================== */
  const { JSDOM, VirtualConsole } = require(process.env.JSDOM || 'jsdom');
  const html = await fetch(B + '/').then(r => r.text());
  const vc = new VirtualConsole(); const err = []; vc.on('jsdomError', e => err.push(e.message));
  IP = '81.9.9.9';
  const dom = new JSDOM(html, { url: B + '/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, beforeParse(w) {
    w.localStorage.setItem('jarvis_cle', CLE);
    w.fetch = (u, o = {}) => fetch(new URL(u, B + '/').href, { ...o, headers: { ...(o.headers || {}), 'CF-Connecting-IP': '81.9.9.9' } });
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
  } });
  const w = dom.window, d = w.document, $ = id => d.getElementById(id);
  await dort(1200);
  const clic = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const derniere = () => [...d.querySelectorAll('#fil .tour')].pop();

  const dans15 = Date.now() + 15 * 60 * 1000;
  w.majEtat({ elevation: { active: true, mode: 'CODE', jusqua: dans15, exigee: true } });
  const parCode = $('etatFaceId').textContent;
  w.majEtat({ elevation: { active: true, mode: 'FACE_ID', jusqua: dans15, exigee: true } });
  const parFace = $('etatFaceId').textContent;
  await t('P1', "le bandeau dit PAR QUOI l'identité a été confirmée : « code » après le code, « actif » après Face ID", async () =>
    ({ ok: /code/.test(parCode) && !/actif/.test(parCode) && /^actif · 15 min$/.test(parFace), info: '« ' + parCode + ' » / « ' + parFace + ' »' }));

  plans.push({ action: 'SEND', resource: 'EMAIL' });
  $('msg').value = "envoie une facture s'il te plaît"; clic($('envoyer')); await dort(900);
  const aQui = derniere();
  await t('P2', "« À qui ? » s'affiche comme un message de JARVIS (pas de Claude), sans carte d'action", async () =>
    ({ ok: aQui && aQui.querySelector('.qui').textContent === 'JARVIS' && /^À qui \?/.test(aQui.querySelector('.quoi').textContent)
         && !d.querySelector('#fil [data-finaliser]'),
       info: aQui && (aQui.querySelector('.qui').textContent + ' : ' + aQui.querySelector('.quoi').textContent.slice(0, 30)) }));

  plans.push({ action: 'SEND', resource: 'EMAIL', target: 'pirate@evil.com' });
  $('msg').value = "d'accord"; clic($('envoyer')); await dort(900);
  const carte = [...d.querySelectorAll('#fil .reformuler')].pop();
  const champ = carte && carte.querySelector('input.cible'), bouton = carte && carte.querySelector('[data-reformuler]');
  if (champ) { champ.value = 'alsid'; clic(bouton); await dort(900); }
  const texteFil = $('fil').textContent;
  await t('P3', "carte « retape la cible » avec « alsid » : refus dit en clair, jamais « Cible confirmée », bouton rendu pour corriger", async () =>
    ({ ok: !!champ && /« alsid » n'est pas une adresse e-mail complète/.test(texteFil) && !/Cible confirmée au clavier : alsid/.test(texteFil)
         && !bouton.disabled && !d.querySelector('#fil [data-finaliser]'),
       info: champ ? (bouton.disabled ? 'bouton gris' : 'bouton actif') + ', ' + (/Cible confirmée/.test(texteFil) ? 'dit confirmée' : 'refus affiché') : 'pas de carte' }));
  if (champ) { champ.value = 'vrai.destinataire@exemple.fr'; clic(bouton); await dort(1200); }
  await t('P4', 'contre-épreuve : dans la même carte, la bonne adresse passe (action retenue)', async () =>
    ({ ok: !!d.querySelector('#fil [data-finaliser]') && /Cible confirmée au clavier : vrai\.destinataire@exemple\.fr/.test($('fil').textContent),
       info: d.querySelector('#fil [data-finaliser]') ? 'retenue' : 'rien' }));

  const lienSante = d.querySelector('footer [data-sante]');
  if (lienSante) { clic(lienSante); await dort(700); }
  const sante = $('sante');
  await t('P5', "« état du serveur » (pied de page) : le détail complet, avec la clé de la page", async () => {
    let j = null; try { j = JSON.parse(sante.textContent); } catch { /* illisible */ }
    return { ok: !!lienSante && !sante.hidden && j && j.elevation === 'code' && j.passerelle === 'v4.6.3', info: lienSante ? String(sante.textContent).slice(0, 60) : 'pas de lien' };
  });

  const chezSoi = w.messageLimite({ motif: 'LIMITE_IP_HORAIRE', reessayerDans: 600 }), jourSoi = w.messageLimite({ motif: 'PLAFOND_GLOBAL_JOURNALIER' });
  w.eval('Cle.oublier()');
  const surDemo = w.messageLimite({ motif: 'LIMITE_IP_HORAIRE', reessayerDans: 600 }), jourDemo = w.messageLimite({ motif: 'PLAFOND_GLOBAL_JOURNALIER' });
  await t('P6', "message de limite : plus de « démo » sur ton instance ; la démo garde le sien", async () =>
    ({ ok: !/démo/.test(chezSoi) && !/démo/.test(jourSoi) && /^Limite horaire atteinte/.test(chezSoi)
         && /Limite horaire de la démo/.test(surDemo) && /de la démo est épuisé, pour tout le monde/.test(jourDemo),
       info: chezSoi.slice(0, 40) + ' | ' + surDemo.slice(0, 30) }));
  await t('P7', 'aucune erreur JavaScript dans la page', async () => ({ ok: err.length === 0, info: err.slice(0, 2).join(' | ') }));

  log('JARVIS — passerelle v4.6.3 : destinataire contrôlé, /health discret, bandeau juste, limites\n');
  for (const r of R) log((r.ok ? 'OK    ' : 'ECHEC ') + r.id.padEnd(4) + ' ' + r.nom + (r.info ? '  [' + r.info + ']' : ''));
  const k = R.filter(r => !r.ok).length;
  log('\n>>> ' + (R.length - k) + '/' + R.length + ' tests passent');
  process.exit(k ? 1 : 0);
})();
