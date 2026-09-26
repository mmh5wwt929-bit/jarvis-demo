'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.6.4                                 node tests-v464.js
 * ----------------------------------------------------------------------------
 * Vu en ligne le 25 sept (11h04 -> 11h14) par Alsid, sur Dianinou :
 *  [S40] une VIEILLE carte « retape la cible », restee active plus haut dans le
 *        fil, a relance un envoi alors que la conversation avait continue.
 *        Prouve sur la v4.6.3 : l'action venait de la page (PAY accepte sans
 *        aucun refus prealable), sans jeton, sans duree ; une action retenue
 *        restait confirmable apres d'autres messages.
 *  [S41] « 🎤 Paye la facture » -> « « micro » n'est pas une adresse » : cible
 *        inventee par le modele, citee comme si elle venait de la personne.
 *  [S42] « Claude veut envoyer » pour une action relancee par SA cible
 *        retapee ; textes sans accents (« irreversible », « arriere »).
 * Chaque test ECHOUE sur la v4.6.3 (sauf ceux marques « garde » ou
 * « contre-epreuve », qui prouvent qu'on n'a rien casse).
 *   JARVIS_DIR=../v463 node tests-v464.js   -> doit echouer
 * ========================================================================== */
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v464';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4081;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));

/* horloge du serveur (ce processus) avancable ; la page (jsdom) garde la sienne */
let avance = 0;
const vraiPerf = performance.now.bind(performance), vraiNow = Date.now;
performance.now = () => vraiPerf() + avance;
Date.now = () => vraiNow() + avance;

const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };

/* ---- faux Claude : plans a la demande, et on garde le dernier prompt systeme ---- */
const plans = [];
let dernierSysteme = '';
https.request = (o, cb) => {
  const q = new EventEmitter(); let s = '';
  q.write = (x) => { s += x; }; q.setTimeout = () => q; q.destroy = () => q;
  q.end = () => { const c = JSON.parse(s), r = new EventEmitter(); r.statusCode = 200; r.complete = true; cb(r);
    if (c.system) dernierSysteme = String(c.system);
    const texte = c.max_tokens === 200 ? JSON.stringify(plans.shift() || { action: 'AUCUNE' }) : 'Réponse.';
    r.emit('data', JSON.stringify({ content: [{ type: 'text', text: texte }] })); r.emit('end'); r.emit('close'); };
  return q;
};
Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', PORT: String(PORT), JARVIS_CLE_ACCES: CLE });
for (const k of ['JARVIS_AGENDA_ICAL', 'JARVIS_GOOGLE_COMPTE', 'JARVIS_AGENDA_JARVIS', 'JARVIS_PASSKEYS', 'JARVIS_CODE_SECOURS',
  'JARVIS_CONFIG_ATTENDUE', 'JARVIS_APPELS_HEURE']) delete process.env[k];
const log = console.log; console.log = () => {}; console.error = () => {};
require(path.join(DIR, 'server.js'));
const P = require(path.join(DIR, 'jarvis-plus-5.29.js'));
const B = 'http://localhost:' + PORT;
let IP = '82.1.1.1';
const appel = async (chemin, corps) => {
  const r = await fetch(B + chemin, { method: corps ? 'POST' : 'GET', body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, 'X-Jarvis-Cle': CLE } });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
  return { status: r.status, ...j };
};
const session = async () => (await appel('/api/session', {})).sessionId;
const dire = (sid, message, plan, o = {}) => { if (plan) plans.push(plan); return appel('/api/chat', { sessionId: sid, message, ...o }); };
const envoi = (cible) => ({ action: 'SEND', resource: 'EMAIL', target: cible });
/* une carte « retape la cible » : le modele propose un envoi que la personne n'a pas tape */
const carte = async (sid, cible = 'compta@exemple.fr') => dire(sid, "d'accord", envoi(cible));
/* le corps qu'envoyait la page v4.6.3 (avec l'action) : la v4.6.4 doit l'ignorer */
const commeAvant = (sid, c, cible, action = 'SEND', resource = 'EMAIL') =>
  appel('/api/reformuler', { sessionId: sid, jeton: c && c.aReformuler ? c.aReformuler.jeton : undefined, action, resource, cible });
const retenue = (r) => !!(r && r.decision && r.decision.decide === 'EN_ATTENTE' && r.decision.jetonAnnulation);

/* une exception hors d'un test ne doit jamais bloquer la suite (le serveur de
 * ce processus la garderait en vie) : elle la fait echouer, en clair */
const fatale = (e) => { log('ECHEC fatale : ' + (e && e.message || e)); process.exit(1); };
process.on('unhandledRejection', fatale);
setTimeout(() => fatale('delai de 110 s depasse'), 110000);

(async () => {
  await dort(500);

  /* =================== [S40] LA CARTE « RETAPE LA CIBLE » =================== */
  let sid = await session();
  const c1 = await carte(sid);
  await t('R1', 'la carte « retape la cible » porte un jeton du serveur (plus l\'action choisie par la page)', async () =>
    ({ ok: c1.motif === 'REFORMULATION_REQUISE' && /^rf_[0-9a-f-]{36}$/.test(String((c1.aReformuler || {}).jeton)),
       info: c1.motif + ' ; jeton ' + String((c1.aReformuler || {}).jeton).slice(0, 12) }));

  await dire(sid, 'merci, autre chose : quelle heure est-il ?');
  const r2 = await commeAvant(sid, c1, 'compta@exemple.fr');
  await t('R2', 'vue en ligne : la carte utilisée APRÈS un autre message → « carte périmée », rien de retenu', async () =>
    ({ ok: r2.status === 409 && r2.erreur === 'CARTE_PERIMEE' && !retenue(r2) && /Carte périmée/.test(r2.message || ''),
       info: r2.status + ' ' + (r2.erreur || (r2.decision && r2.decision.decide)) }));

  IP = '82.1.1.2'; sid = await session();
  const sansCarte = await appel('/api/reformuler', { sessionId: sid, action: 'PAY', resource: 'BANQUE', cible: 'alsid.smailji@yahoo.fr' });
  const c3 = await carte(sid);
  const detourne = await commeAvant(sid, c3, 'alsid.smailji@yahoo.fr', 'PAY', 'BANQUE');
  await t('R3', "la page ne choisit plus l'action : PAY sans carte → refusé ; carte d'ENVOI + « PAY » dans la requête → c'est un envoi", async () =>
    ({ ok: sansCarte.status === 400 && !retenue(sansCarte) && retenue(detourne) && detourne.decision.plan.action === 'SEND'
         && detourne.decision.plan.resource === 'EMAIL',
       info: 'sans carte ' + sansCarte.status + (retenue(sansCarte) ? ' RETENU' : '') + ' ; detourne -> ' + (detourne.decision ? detourne.decision.plan.action : detourne.erreur) }));
  if (retenue(detourne)) await appel('/api/annuler', { sessionId: sid, jeton: detourne.decision.jetonAnnulation });

  const rejeu = await commeAvant(sid, c3, 'alsid.smailji@yahoo.fr');
  await t('R4', 'une carte sert UNE fois : même jeton réutilisé (action annulée entre-temps) → refusé', async () =>
    ({ ok: rejeu.status === 409 && rejeu.erreur === 'CARTE_PERIMEE' && !retenue(rejeu), info: rejeu.status + ' ' + (rejeu.erreur || '') }));

  IP = '82.1.1.3'; sid = await session();
  const c5 = await carte(sid);
  avance += 2 * 60 * 1000 + 1000;
  const vieille = await commeAvant(sid, c5, 'compta@exemple.fr');
  avance = 0;
  await t('R5', 'carte de plus de 2 min, sans aucun autre message → périmée, rien de retenu', async () =>
    ({ ok: vieille.status === 409 && vieille.erreur === 'CARTE_PERIMEE' && !retenue(vieille), info: vieille.status + ' ' + (vieille.erreur || '') }));

  IP = '82.1.1.4'; sid = await session();
  const c6 = await carte(sid);
  const deux = await Promise.all([commeAvant(sid, c6, 'compta@exemple.fr'), commeAvant(sid, c6, 'compta@exemple.fr')]);
  await t('R6', 'la même carte touchée deux fois EN MÊME TEMPS : une seule action retenue, l\'autre « carte périmée »', async () =>
    ({ ok: deux.filter(retenue).length === 1 && deux.filter(x => x.status === 409 && x.erreur === 'CARTE_PERIMEE').length === 1,
       info: deux.map(x => x.status + '/' + (x.erreur || (x.decision && x.decision.decide))).join(' + ') }));
  for (const x of deux) if (retenue(x)) await appel('/api/annuler', { sessionId: sid, jeton: x.decision.jetonAnnulation });

  IP = '82.1.1.5'; sid = await session();
  const c7 = await carte(sid);
  IP = '82.1.1.6'; const autre = await session();
  const vol = await appel('/api/reformuler', { sessionId: autre, jeton: c7.aReformuler && c7.aReformuler.jeton, action: 'SEND', resource: 'EMAIL', cible: 'compta@exemple.fr' });
  await t('R7', "le jeton d'une carte ne vaut que dans SA session", async () =>
    ({ ok: vol.status === 409 && !retenue(vol), info: vol.status + ' ' + (vol.erreur || (vol.decision && vol.decision.decide)) }));
  IP = '82.1.1.5';
  const faute = await commeAvant(sid, c7, 'compta@exemple');
  const juste = await commeAvant(sid, c7, 'compta@exemple.fr');
  await t('R8', "contre-épreuve : une faute de frappe dans la carte ne la gâche pas ; la bonne adresse passe ensuite", async () =>
    ({ ok: faute.status === 400 && faute.erreur === 'ADRESSE_INVALIDE' && retenue(juste),
       info: faute.erreur + ' puis ' + (juste.decision ? juste.decision.decide : juste.erreur) }));
  if (retenue(juste)) await appel('/api/annuler', { sessionId: sid, jeton: juste.decision.jetonAnnulation });

  /* ================= [S40] L'ACTION RETENUE (BOITE ORANGE) ================= */
  IP = '82.2.2.1'; sid = await session();
  const o1 = await dire(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  await dire(sid, 'et quel temps fera-t-il demain ?');
  const systemeApres = dernierSysteme;
  avance += 11000;
  const f1 = await appel('/api/finaliser', { sessionId: sid, jeton: o1.jetonAnnulation });
  const f1b = await appel('/api/finaliser', { sessionId: sid, jeton: o1.jetonAnnulation });
  avance = 0;
  await t('O1', "action retenue, puis un AUTRE message : « Confirmer l'envoi » → « périmée », rien ne part", async () =>
    ({ ok: o1.decide === 'EN_ATTENTE' && f1.etat === 'PERIME' && /Rien n'est parti/.test(f1.message || '') && f1b.etat !== 'EXECUTE',
       info: o1.decide + ' -> ' + f1.etat + ' -> ' + f1b.etat }));
  await t('O2', 'le modèle le sait : « ANNULE SEND … (PERIMEE_NOUVEAU_MESSAGE) » dans ses derniers verdicts', async () =>
    ({ ok: /ANNULE SEND pierre@exemple\.fr \(PERIMEE_NOUVEAU_MESSAGE\)/.test(systemeApres), info: (systemeApres.match(/Derniers verdicts : [^\n]*/) || [''])[0].slice(0, 110) }));

  IP = '82.2.2.2'; sid = await session();
  const o3 = await dire(sid, 'envoie les factures à paul@exemple.fr', envoi('paul@exemple.fr'));
  avance += 11000;
  const f3 = await appel('/api/finaliser', { sessionId: sid, jeton: o3.jetonAnnulation });
  avance = 0;
  await t('O3', "contre-épreuve : sans autre message, la confirmation après 10 s part (simulée)", async () =>
    ({ ok: o3.decide === 'EN_ATTENTE' && f3.etat === 'EXECUTE', info: o3.decide + ' -> ' + f3.etat }));

  const o4 = await dire(sid, 'envoie les factures à jean@exemple.fr', envoi('jean@exemple.fr'));
  avance += 6 * 60 * 1000;
  const f4 = await appel('/api/finaliser', { sessionId: sid, jeton: o4.jetonAnnulation });
  avance = 0;
  await t('O4', 'garde : 6 min plus tard, rien ne part (l\'autorisation vit 5 min)', async () =>
    ({ ok: f4.etat !== 'EXECUTE' && f4.motif === 'AUTORISATION_EXPIREE', info: f4.etat + ' ' + (f4.motif || '') }));

  const journal = (m) => {
    const { session: g, entree } = P.creerSessionGouvernee({ plafond: 100 });
    const texte = 'envoie les factures à z@exemple.fr';
    entree.soumettre(texte, { canal: 'clavier' });
    const { sceauContexte } = g.promptDePlanification(texte, ['SEND']);
    const x = g.demander({ action: 'SEND', resource: 'EMAIL', target: 'z@exemple.fr' }, { sceauContexte });
    const e = x.decide === 'AUTORISE' ? g.executer(x, () => ({ prepare: true })) : null;
    if (!e || !e.jetonAnnulation) return 'non retenu (' + x.decide + ' ' + (x.motif || '') + ')';
    g.annuler(e.jetonAnnulation, m);
    return (Array.isArray(g.journal) ? g.journal : []).filter(j => /ANNULE|PERIME/.test(String(j.evenement))).map(j => j.evenement).pop() || 'aucune ligne';
  };
  const jPerime = journal('PERIMEE_NOUVEAU_MESSAGE'), jPirate = journal('<script>');
  await t('C1', 'couche 5.30.1 : le journal dit « PERIMEE_NOUVEAU_MESSAGE » ; motif sur liste fermée (« <script> » → « ANNULE_PAR_UTILISATEUR »)', async () =>
    ({ ok: jPerime === 'PERIMEE_NOUVEAU_MESSAGE' && jPirate === 'ANNULE_PAR_UTILISATEUR' && /^5\.30\.[1-9]$/.test(P.VERSION) /* [v4.6.5] 5.30.2 */,
       info: jPerime + ' ; ' + jPirate + ' ; ' + P.VERSION }));

  /* ===================== [S41] LA CIBLE INVENTEE ===================== */
  IP = '82.3.3.1'; sid = await session();
  const m1 = await dire(sid, 'Paye la facture', { action: 'PAY', resource: 'BANQUE', target: 'micro' }, { canal: 'voix' });
  await t('M1', "vu en ligne : « 🎤 Paye la facture », le modèle invente « micro » → « À qui ? », rien soumis au noyau", async () =>
    ({ ok: m1.decide === 'SANS_OBJET' && m1.motif === 'DESTINATAIRE_MANQUANT' && /^À qui \?/.test(m1.reponse || '') && !/micro/.test(m1.reponse || ''),
       info: m1.motif + ' « ' + String(m1.reponse || '').slice(0, 40) + ' »' }));
  const m2 = await dire(sid, 'paie la facture', { action: 'PAY', resource: 'BANQUE', target: 'Pierre' });
  await t('M2', 'tapé « paie la facture », le modèle ajoute « Pierre » (jamais dit) → « À qui ? »', async () =>
    ({ ok: m2.motif === 'DESTINATAIRE_MANQUANT' && /^À qui \?/.test(m2.reponse || ''), info: m2.motif }));
  const m3 = await dire(sid, 'paie la facture à Pierre', { action: 'PAY', resource: 'BANQUE', target: 'Pierre' });
  const m4 = await dire(sid, 'envoie la facture à Hélène', { action: 'SEND', resource: 'EMAIL', target: 'Helene' });
  const m5 = await dire(sid, 'démo', undefined, { action: 'SEND', cible: 'x' });
  await t('M3', "garde : un nom que TU as dit reste cité (« Pierre », « Helene » pour « Hélène ») ; imposé à la main vers « x » : même règle qu'avant", async () =>
    ({ ok: m3.motif === 'ADRESSE_INVALIDE' && /« Pierre »/.test(m3.reponse || '') && m4.motif === 'ADRESSE_INVALIDE' && m5.motif === 'ADRESSE_INVALIDE',
       info: [m3.motif, m4.motif, m5.motif].join(' ') }));

  /* ============================ /HEALTH ============================ */
  const h = await appel('/api/health');
  await t('H1', '/health : passerelle v4.6.4, couche 5.30.1', async () =>
    ({ ok: /^v4\.(6\.[4-9]|[7-9]\.\d+)$/.test(h.passerelle) && /^5\.30\.[1-9]$/.test(h.couche) /* [v4.6.5] */, info: h.passerelle + ' ' + h.couche }));

  /* ============================== LA PAGE ============================== */
  const { JSDOM, VirtualConsole } = require(process.env.JSDOM || 'jsdom');
  const html = await fetch(B + '/').then(r => r.text());
  const vc = new VirtualConsole(); const err = []; vc.on('jsdomError', e => err.push(e.message));
  const corps = [];
  const dom = new JSDOM(html, { url: B + '/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, beforeParse(w) {
    w.localStorage.setItem('jarvis_cle', CLE);
    w.fetch = (u, o = {}) => { if (o.body) corps.push({ u: String(u), b: JSON.parse(o.body) });
      return fetch(new URL(u, B + '/').href, { ...o, headers: { ...(o.headers || {}), 'CF-Connecting-IP': '82.9.9.9' } }); };
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
  } });
  const w = dom.window, d = w.document, $ = (id) => d.getElementById(id);
  await dort(1200);
  const clic = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const ecrire = async (texte, plan, ms = 900) => { if (plan) plans.push(plan); $('msg').value = texte; clic($('envoyer')); await dort(ms); };
  const cartes = () => [...d.querySelectorAll('#fil .reformuler')];
  const boites = () => [...d.querySelectorAll('#fil .retenue')];

  await ecrire("d'accord", envoi('compta@exemple.fr'));
  const bleue1 = cartes().pop();
  await ecrire('quelle heure est-il ?');
  await t('P1', 'un nouveau message éteint la vieille carte bleue : champ et bouton grisés, « Carte périmée » écrit dedans', async () =>
    ({ ok: !!bleue1 && bleue1.querySelector('input.cible').disabled && bleue1.querySelector('[data-reformuler]').disabled
         && /Carte périmée/.test(bleue1.textContent),
       info: bleue1 ? (bleue1.querySelector('[data-reformuler]').disabled ? 'grisée' : 'ACTIVE') : 'pas de carte' }));

  await ecrire('envoie les factures à luc@exemple.fr', envoi('luc@exemple.fr'));
  const orange1 = boites().pop();
  await ecrire('merci');
  await t('P2', "un nouveau message éteint la boîte orange : « Périmée … Rien n'est parti », Annuler et Confirmer grisés", async () =>
    ({ ok: !!orange1 && /Périmée/.test(orange1.textContent) && /Rien n'est parti/.test(orange1.textContent)
         && [...orange1.querySelectorAll('button')].every(b => b.disabled),
       info: orange1 ? orange1.querySelector('.compte').textContent.slice(0, 50) : 'pas de boite' }));

  await ecrire("d'accord", envoi('marc@exemple.fr'));
  const bleue2 = cartes().pop();
  const titreRefus = [...d.querySelectorAll('#fil .plan')].pop().textContent;
  bleue2.querySelector('input.cible').value = 'marc@exemple.fr'; clic(bleue2.querySelector('[data-reformuler]')); await dort(1000);
  const envoye = corps.filter(x => /\/api\/reformuler/.test(x.u)).pop();
  await t('P3', "la page envoie le jeton de SA carte, jamais l'action", async () =>
    ({ ok: !!envoye && /^rf_/.test(String(envoye.b.jeton)) && !('action' in envoye.b) && !('resource' in envoye.b),
       info: envoye ? Object.keys(envoye.b).join(',') : 'rien envoyé' }));
  const plansAffiches = [...d.querySelectorAll('#fil .plan')].map(x => x.textContent);
  const titreRelance = plansAffiches.pop();
  await t('P4', "la carte dit QUI lance : « Tu relances : envoyer » après ta cible retapée (« Claude veut » pour sa proposition)", async () =>
    ({ ok: /^Tu relances : envoyer/.test(titreRelance) && /^Claude veut envoyer/.test(titreRefus) && bleue2.querySelector('input.cible').disabled,
       info: '« ' + titreRefus.slice(0, 25) + ' » puis « ' + titreRelance.slice(0, 30) + ' »' }));
  const derniereDecision = [...d.querySelectorAll('#fil .decision')].pop().textContent;
  await t('P5', 'accents rétablis : « irréversible », « arrière », « toi-même », « même résultat »', async () =>
    ({ ok: /Action irréversible : aucun retour arrière possible/.test(derniereDecision) && /toi-même : même résultat/.test(derniereDecision)
         && !/irreversible|arriere|toi-meme/.test(derniereDecision),
       info: (derniereDecision.match(/Action i[^.]*\./) || ['?'])[0] }));
  const jetonMarc = boites().pop().querySelector('[data-finaliser]').dataset.finaliser;
  await ecrire('annule tout, je réfléchis', null, 700);

  await ecrire("d'accord", envoi('zoe@exemple.fr'));
  const bleue3 = cartes().pop();
  avance += 2 * 60 * 1000 + 1000;
  bleue3.querySelector('input.cible').value = 'zoe@exemple.fr'; clic(bleue3.querySelector('[data-reformuler]')); await dort(900);
  avance = 0;
  await t('P6', "carte refusée par le serveur (plus de 2 min) : elle le dit et s'éteint, rien de retenu", async () =>
    ({ ok: /Carte périmée/.test(bleue3.textContent) && bleue3.querySelector('[data-reformuler]').disabled
         && !/Cible confirmée au clavier : zoe/.test($('fil').textContent),
       info: bleue3.querySelector('p').textContent.slice(0, 50) }));

  await ecrire('envoie les factures à eve@exemple.fr', envoi('eve@exemple.fr'));
  const orange2 = boites().pop(), jEve = orange2.querySelector('[data-finaliser]').dataset.finaliser;
  avance += 6 * 60 * 1000;
  await w.finaliserJeton(jEve); await dort(300);
  avance = 0;
  await t('P7', "après 5 min : la boîte dit « Périmée : plus de 5 min … » au lieu du code AUTORISATION_EXPIREE", async () =>
    ({ ok: /Périmée : plus de 5 min/.test(orange2.textContent) && !/AUTORISATION_EXPIREE/.test($('fil').textContent),
       info: orange2.querySelector('.compte').textContent.slice(0, 60) }));

  const trace = w.resumeTrace({ intention: { nature: 'FRAPPE', frappe: 'x', reverifiee: true }, plan: { classe: 'IRREVERSIBLE' },
    confirmation: { mode: 'CLIC_APRES_FENETRE' }, effet: { etat: 'EXECUTED' } });
  await t('P8', 'la trace dit « autorisé (irréversible) »', async () => ({ ok: /autorisé \(irréversible\)/.test(trace), info: trace.slice(0, 80) }));
  await t('P9', 'garde : aucune erreur JavaScript dans la page', async () => ({ ok: err.length === 0 && !!jetonMarc, info: err.slice(0, 2).join(' | ') }));

  performance.now = vraiPerf; Date.now = vraiNow;
  log('JARVIS — passerelle v4.6.4 : cartes périmées, cible inventée, qui lance l\'action, accents (' + DIR + ')\n');
  for (const r of R) log((r.ok ? 'OK    ' : 'ECHEC ') + r.id.padEnd(4) + ' ' + r.nom + (r.info ? '  [' + r.info + ']' : ''));
  const k = R.filter(r => !r.ok).length;
  log('\n>>> ' + (R.length - k) + '/' + R.length + ' tests passent');
  process.exit(k ? 1 : 0);
})().catch(fatale);
