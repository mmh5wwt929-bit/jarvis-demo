'use strict';
/* ============================================================================
 * JARVIS — passerelle v4.6.5                                 node tests-v465.js
 * ----------------------------------------------------------------------------
 * Audit de la v4.6.4 (risques reproduits hors ligne) et retours d'Alsid du
 * 25 sept apres-midi. Chaque test ECHOUE sur la v4.6.4, sauf ceux marques
 * « garde » (ils passent sur les deux : on n'a rien casse). Une
 * « contre-epreuve » verifie que la nouvelle regle laisse passer le bon cas :
 *   JARVIS_DIR=../v464 node tests-v465.js   -> doit echouer
 *  A1 [S43] courses entre deux messages : message depasse = ni carte ni action
 *  A2 [S44] preuve « cible retapee » limitee a son tour (couche 5.30.2)
 *  A3 [S45] ressource fixee par le serveur selon l'action
 *  A4 [S46] regle stricte, les 4 regles d'Alsid :
 *     Face ID obtenu pour A != Face ID valable pour B ; code pour A != code
 *     pour B ; meme action repetee = nouveau defi ; nouveau destinataire ou
 *     nouvelle ressource = nouveau defi
 *  B  [S47] retours d'Alsid (carte, voix, « Tu demandes », reveil, trace,
 *     simulation), puis la page (jsdom)
 * ========================================================================== */
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const CLE = 'cle-de-test-longue-et-aleatoire-v465';
const CODE = '509183746201';
const PORT = Number(process.env.JARVIS_PORT_TEST) || 4082;
const dort = (ms) => new Promise((r) => setTimeout(r, ms));

/* horloges du serveur (ce processus) : avance pour les deux ; gel pour Date.now seul */
let avance = 0, gel = null;
const vraiPerf = performance.now.bind(performance), vraiNow = Date.now;
performance.now = () => vraiPerf() + avance;
Date.now = () => (gel !== null ? gel : vraiNow() + avance);

const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };

/* ---- faux iPhone (Face ID), comme tests-v46 ---- */
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

/* ---- faux Claude : plans a la demande (avec delai possible), delais de reponse ---- */
const plans = [], delaisReponse = [];
let dernierSysteme = '', dernierPlan = '';
https.request = (o, cb) => {
  const q = new EventEmitter(); let s = '';
  q.write = (x) => { s += x; }; q.setTimeout = () => q; q.destroy = () => q;
  q.end = () => {
    const c = JSON.parse(s), estPlan = c.max_tokens === 200;
    let texte, delai = 0;
    if (estPlan) {
      const p = plans.shift() || { action: 'AUCUNE' };
      delai = p.__delai || 0;
      const { __delai, ...plan } = p; texte = JSON.stringify(plan);
      dernierPlan = JSON.stringify(c.messages || c);
    } else { delai = delaisReponse.shift() || 0; texte = 'Réponse.'; if (c.system) dernierSysteme = String(c.system); }
    setTimeout(() => { const r = new EventEmitter(); r.statusCode = 200; r.complete = true; cb(r);
      r.emit('data', JSON.stringify({ content: [{ type: 'text', text: texte }] })); r.emit('end'); r.emit('close'); }, delai);
  };
  return q;
};
Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', PORT: String(PORT), JARVIS_CLE_ACCES: CLE, JARVIS_CODE_SECOURS: CODE,
  JARVIS_PASSKEYS: PASSKEY, JARVIS_APPELS_HEURE: '2000', JARVIS_APPELS_JOUR: '100000', JARVIS_ACTIONS_HEURE: '5000' });
for (const k of ['JARVIS_AGENDA_ICAL', 'JARVIS_GOOGLE_COMPTE', 'JARVIS_AGENDA_JARVIS', 'JARVIS_CONFIG_ATTENDUE']) delete process.env[k];
const log = console.log; console.log = () => {}; console.error = () => {};
require(path.join(DIR, 'server.js'));
const P = require(path.join(DIR, 'jarvis-plus-5.29.js'));
const B = 'http://localhost:' + PORT;
let IP = '83.1.1.1';
const appel = async (chemin, corps) => {
  const r = await fetch(B + chemin, { method: corps ? 'POST' : 'GET', body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, 'X-Jarvis-Cle': CLE } });
  const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = { brut: x }; }
  return { status: r.status, ...j };
};
const session = async () => (await appel('/api/session', {})).sessionId;
const dire = (sid, message, plan, o = {}) => { if (plan) plans.push(plan); return appel('/api/chat', { sessionId: sid, message, ...o }); };
const envoi = (cible, resource = 'EMAIL') => ({ action: 'SEND', resource, target: cible });
const paiement = (cible, resource = 'BANQUE') => ({ action: 'PAY', resource, target: cible });
const retenue = (r) => !!(r && r.decision && r.decision.decide === 'EN_ATTENTE' && r.decision.jetonAnnulation);
const finaliser = (sid, j) => appel('/api/finaliser', { sessionId: sid, jeton: j });
const code = (sid, j, c = CODE) => appel('/api/elevation/code', { sessionId: sid, jeton: j, code: c });   /* la v4.6.4 ignore le jeton */
/* une action tapee, retenue, fenetre passee */
const retenir = async (sid, texte, plan) => { const r = await dire(sid, texte, plan); avance += 11000; return r; };
/* confirmee avec le code : ELEVATION_REQUISE -> code -> EXECUTE */
const confirmerAvecCode = async (sid, j) => { const f = await finaliser(sid, j); if (f.etat !== 'ELEVATION_REQUISE') return f; await code(sid, j); return finaliser(sid, j); };

const fatale = (e) => { log('ECHEC fatale : ' + (e && e.message || e)); process.exit(1); };
process.on('unhandledRejection', fatale);
setTimeout(() => fatale('delai de 150 s depasse'), 150000);

(async () => {
  await dort(500);

  /* ====================== A1 [S43] COURSES ENTRE MESSAGES ====================== */
  IP = '83.1.1.1'; let sid = await session();
  plans.push({ ...envoi('compta@exemple.fr'), __delai: 400 });
  const p1 = appel('/api/chat', { sessionId: sid, message: "d'accord" });
  await dort(80);
  const r2 = await dire(sid, 'quelle heure est-il ?');
  const r1 = await p1;
  const jet1 = (r1.aReformuler || {}).jeton;
  const essai1 = await appel('/api/reformuler', { sessionId: sid, jeton: jet1, cible: 'compta@exemple.fr' });
  await t('A1a', "1er message planifié APRÈS le 2e : ni carte (« retape la cible ») ni action ; « Message dépassé »", async () =>
    ({ ok: r1.etape === 'DEPASSE' && !r1.aReformuler && !retenue(essai1) && r2.decide === 'SANS_OBJET' && /Message dépassé/.test(r1.reponse || ''),
       info: (r1.etape || r1.motif) + ' ; carte ' + (jet1 ? 'NÉE' : 'aucune') + ' ; essai ' + (retenue(essai1) ? 'RETENU' : essai1.status) }));

  IP = '83.1.1.2'; sid = await session();
  plans.push({ ...envoi('a@exemple.fr'), __delai: 400 });
  const q1 = appel('/api/chat', { sessionId: sid, message: 'envoie les factures à a@exemple.fr' });
  await dort(80);
  const q2 = await dire(sid, 'envoie les factures à b@exemple.fr', envoi('b@exemple.fr'));
  const q1r = await q1;
  await t('A1b', "deux envois tapés simultanés : le 2e retenu, le 1er dépassé SANS carte (avant : carte utilisable)", async () =>
    ({ ok: q2.decide === 'EN_ATTENTE' && q1r.etape === 'DEPASSE' && !q1r.aReformuler && !q1r.jetonAnnulation,
       info: '1er ' + (q1r.etape || q1r.decide) + (q1r.aReformuler ? ' + CARTE' : '') + ' ; 2e ' + q2.decide }));

  IP = '83.1.1.3'; sid = await session();
  plans.push({ action: 'READ', resource: 'LOCAL', target: 'notes' }); delaisReponse.push(400);
  const v1 = appel('/api/chat', { sessionId: sid, message: 'lis mes notes' });
  await dort(80);
  await dire(sid, 'laisse tomber');
  const v1r = await v1;
  await t('A1c', "action réversible dépassée pendant la réponse : autorisation retirée, rien d'exécuté", async () =>
    ({ ok: v1r.etape === 'DEPASSE' && v1r.decide !== 'AUTORISE', info: v1r.decide + ' ' + v1r.etape }));

  IP = '83.1.1.4'; sid = await session();
  const g1 = await dire(sid, 'envoie les factures à c@exemple.fr', envoi('c@exemple.fr'));
  const g2 = await dire(sid, 'et à d@exemple.fr aussi, envoie', envoi('d@exemple.fr'));
  await t('A1d', "garde : messages l'un après l'autre (sans course) : chacun est traité normalement", async () =>
    ({ ok: g1.decide === 'EN_ATTENTE' && g2.decide === 'EN_ATTENTE', info: g1.decide + ' ; ' + g2.decide }));

  /* ================= A2 [S44] PREUVE LIMITEE A SON TOUR ================= */
  const spec = { action: 'SEND', resource: 'EMAIL', target: 'x@exemple.fr' };
  const couche = () => P.creerSessionGouvernee({ plafond: 100 });
  const a2 = (() => {
    const { session: g, entree } = couche();
    entree.soumettre('ok');
    entree.reformuler('SEND', 'x@exemple.fr'); g.dryRun(spec);        /* preuve nee… autorisation jamais obtenue */
    entree.soumettre("d'accord, vas-y");                                /* tour suivant */
    const p = g.promptDePlanification("d'accord, vas-y", ['SEND']);
    return g.demander(spec, { sceauContexte: p.sceauContexte });
  })();
  const a2t = (() => {
    const { session: g, entree } = couche();
    entree.soumettre('ok');
    entree.reformuler('SEND', 'x@exemple.fr'); g.dryRun(spec);
    return g.demander(spec, { manuel: true });                          /* meme tour : la preuve sert */
  })();
  await t('A2a', "couche : une cible retapée ne vaut plus au tour suivant (avant : « d'accord, vas-y » → autorisé sans frappe)", async () =>
    ({ ok: a2.decide === 'REFUSE' && a2.motif === 'REFORMULATION_REQUISE' && a2t.decide === 'AUTORISE',
       info: 'tour suivant ' + a2.decide + ' ' + (a2.motif || '') + ' ; même tour ' + a2t.decide }));
  const geste = (entre) => {
    const { session: g, entree } = couche();
    entree.soumettre('ajoute un truc demain');
    g.ingerer({ origine: 'CONTENT_DERIVED', resume: 'invitation', source: 'agenda:invitation' });
    entree.confirmer('CREATE', '2026-09-26T18:30|60|X');
    if (entre) entree.soumettre('autre chose');
    return g.demander({ action: 'CREATE', resource: 'AGENDA_JARVIS', target: '2026-09-26T18:30|60|X' }, { manuel: true, compensation: 'supprimer' });
  };
  const gApres = geste(true), gMeme = geste(false);
  await t('A2b', "couche : le geste « Créer » ne vaut plus après un autre message (session rouge)", async () =>
    ({ ok: gApres.decide !== 'AUTORISE' && gMeme.decide === 'AUTORISE', info: 'après ' + gApres.decide + ' ' + (gApres.motif || '') + ' ; même tour ' + gMeme.decide }));

  /* le scénario serveur de l'audit : cible retapée refusée plus loin par le noyau
   * (rafale : limites de débit du noyau), puis « d'accord, vas-y » 10 min plus tard */
  IP = '83.2.2.1'; sid = await session();
  gel = vraiNow() + avance;
  for (let i = 0; i < 22; i++) { IP = '83.2.3.' + i; await dire(sid, 'lis la note ' + i, { action: 'READ', resource: 'LOCAL', target: 'note' + i }); }
  IP = '83.2.2.1';
  const c3 = await dire(sid, "d'accord", envoi('compta@exemple.fr'));
  const rf3 = await appel('/api/reformuler', { sessionId: sid, jeton: (c3.aReformuler || {}).jeton, cible: 'compta@exemple.fr' });
  gel = null; avance += 10 * 60 * 1000;
  const vasy = await dire(sid, "d'accord, vas-y", envoi('compta@exemple.fr'));
  await t('A2c', "vu à l'audit : retapée puis refusée par le noyau ; 10 min plus tard « d'accord, vas-y » → la vigilance redemande (plus de retenue sans frappe)", async () =>
    ({ ok: rf3.decision && rf3.decision.decide === 'REFUSE' && vasy.decide === 'REFUSE' && vasy.etape === 'VIGILANCE_INTENTION' && !vasy.jetonAnnulation,
       info: 'retapée → ' + (rf3.decision ? rf3.decision.decide + ' ' + rf3.decision.motif : rf3.erreur) + ' ; vas-y → ' + vasy.decide + ' ' + (vasy.etape || '') }));

  /* ================= A3 [S45] RESSOURCE FIXEE PAR LE SERVEUR ================= */
  IP = '83.3.3.1'; sid = await session();
  const b1 = await dire(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr', 'BANQUE'));
  const tb1 = b1.jetonAnnulation ? await appel('/api/trace?sessionId=' + sid + '&jeton=' + b1.jetonAnnulation) : {};
  const b2 = await dire(sid, 'paie la facture à pierre@exemple.fr', paiement('pierre@exemple.fr', 'EMAIL'));
  await t('A3a', "« envoie … » + BANQUE choisi par le modèle → retenu SEND/EMAIL ; « paie … » + EMAIL → PAY/BANQUE", async () =>
    ({ ok: b1.decide === 'EN_ATTENTE' && b1.plan.resource === 'EMAIL' && tb1.trace && tb1.trace.plan.ressource === 'EMAIL'
         && b2.decide === 'EN_ATTENTE' && b2.plan.resource === 'BANQUE',
       info: b1.plan.resource + ' (trace ' + (tb1.trace ? tb1.trace.plan.ressource : '?') + ') ; ' + b2.plan.resource }));
  const cb = await dire(sid, "d'accord", envoi('compta@exemple.fr', 'BANQUE'));
  const rb = await appel('/api/reformuler', { sessionId: sid, jeton: (cb.aReformuler || {}).jeton, cible: 'compta@exemple.fr' });
  await t('A3b', "carte « retape la cible » d'un envoi proposé avec BANQUE : relancée en SEND/EMAIL", async () =>
    ({ ok: retenue(rb) && rb.decision.plan.resource === 'EMAIL', info: rb.decision ? rb.decision.plan.action + '/' + rb.decision.plan.resource : rb.erreur }));
  const b3 = await dire(sid, 'démo', undefined, { action: 'SEND', cible: 'x@exemple.fr' });
  await t('A3c', "action imposée à la main : même règle (SEND → EMAIL, plus « LOCAL »)", async () =>
    ({ ok: b3.plan && b3.plan.resource === 'EMAIL', info: b3.plan && b3.plan.resource }));

  /* ============== A4 [S46] REGLE STRICTE : LES 4 REGLES D'ALSID ============== */
  /* 1. Face ID obtenu pour A ≠ Face ID valable pour B */
  IP = '83.4.4.1'; sid = await session();
  const A = await retenir(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const fA = await finaliser(sid, A.jetonAnnulation);
  const dA = await appel('/api/elevation/defi', { sessionId: sid, type: 'assertion', jeton: A.jetonAnnulation });
  const Bx = await retenir(sid, 'envoie les factures à paul@exemple.fr', envoi('paul@exemple.fr'));
  const faceAB = await appel('/api/elevation/faceid', { sessionId: sid, jeton: Bx.jetonAnnulation, reponse: signerFaceId(dA.options && dA.options.challenge) });
  const fB = await finaliser(sid, Bx.jetonAnnulation);
  await t('R1', "Face ID obtenu pour A ≠ Face ID valable pour B : le défi de A signé, présenté pour B → refusé ; B redemande", async () =>
    ({ ok: fA.etat === 'ELEVATION_REQUISE' && !!dA.options && !faceAB.ok && fB.etat === 'ELEVATION_REQUISE',
       info: 'A ' + fA.etat + ' ; Face ID(A) pour B : ' + (faceAB.ok ? 'ACCEPTÉ' : faceAB.motif) + ' ; B ' + fB.etat }));
  const dB = await appel('/api/elevation/defi', { sessionId: sid, type: 'assertion', jeton: Bx.jetonAnnulation });
  const faceB = await appel('/api/elevation/faceid', { sessionId: sid, jeton: Bx.jetonAnnulation, reponse: signerFaceId(dB.options && dB.options.challenge) });
  const fB2 = await finaliser(sid, Bx.jetonAnnulation);
  await t('R1g', "contre-épreuve : le défi de B, signé, confirme B ; la trace dit « Face ID »", async () =>
    ({ ok: faceB.ok && fB2.etat === 'EXECUTE' && fB2.trace.confirmation.elevation === 'FACE_ID', info: (faceB.ok || faceB.motif) + ' ; ' + fB2.etat }));

  /* 2. Code obtenu pour A ≠ Code valable pour B */
  IP = '83.4.4.2'; sid = await session();
  const A2 = await retenir(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  await finaliser(sid, A2.jetonAnnulation);
  const cA = await code(sid, A2.jetonAnnulation);
  const B2 = await retenir(sid, 'paie la facture à pierre@exemple.fr', paiement('pierre@exemple.fr'));
  const fB3 = await finaliser(sid, B2.jetonAnnulation);
  const cAsurB = await code(sid, A2.jetonAnnulation);
  const fB4 = await finaliser(sid, B2.jetonAnnulation);
  await t('R2', "code obtenu pour A ≠ code valable pour B (vu en ligne vers 13h48-49) : le paiement redemande ; le code rejoué avec le jeton de A ne sert à rien", async () =>
    ({ ok: cA.ok && fB3.etat === 'ELEVATION_REQUISE' && !cAsurB.ok && fB4.etat === 'ELEVATION_REQUISE',
       info: 'code A ' + cA.ok + ' ; B ' + fB3.etat + ' ; rejeu ' + (cAsurB.ok ? 'ACCEPTÉ' : cAsurB.motif) + ' ; B ' + fB4.etat }));

  /* 3. Même action répétée = nouveau défi */
  IP = '83.4.4.3'; sid = await session();
  const M1 = await retenir(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const m1 = await confirmerAvecCode(sid, M1.jetonAnnulation);
  const M2 = await retenir(sid, 'envoie encore les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const m2 = await finaliser(sid, M2.jetonAnnulation);
  await t('R3', "même action répétée (même destinataire) = nouveau défi : la 2e redemande Face ID ou le code", async () =>
    ({ ok: m1.etat === 'EXECUTE' && m2.etat === 'ELEVATION_REQUISE', info: m1.etat + ' puis ' + m2.etat }));
  await code(sid, M2.jetonAnnulation);
  const m3 = await finaliser(sid, M2.jetonAnnulation);
  const m4 = await finaliser(sid, M2.jetonAnnulation);
  await t('R3g', "contre-épreuve : code donné pour la 2e → envoyée, UNE fois (l'élévation est consommée à l'envoi)", async () =>
    ({ ok: m3.etat === 'EXECUTE' && m4.etat !== 'EXECUTE', info: m3.etat + ' ; puis ' + m4.etat }));

  /* 4. Nouveau destinataire / nouvelle ressource = nouveau défi */
  IP = '83.4.4.4'; sid = await session();
  const N1 = await retenir(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const n1 = await confirmerAvecCode(sid, N1.jetonAnnulation);
  const N2 = await retenir(sid, 'envoie les factures à paul@exemple.fr', envoi('paul@exemple.fr'));
  const n2 = await finaliser(sid, N2.jetonAnnulation);
  await code(sid, N2.jetonAnnulation); await finaliser(sid, N2.jetonAnnulation);
  const N3 = await retenir(sid, 'paie la facture à paul@exemple.fr', paiement('paul@exemple.fr'));
  const n3 = await finaliser(sid, N3.jetonAnnulation);
  await t('R4', "nouveau destinataire (paul) puis nouvelle ressource (paiement) = nouveau défi à chaque fois", async () =>
    ({ ok: n1.etat === 'EXECUTE' && n2.etat === 'ELEVATION_REQUISE' && n3.etat === 'ELEVATION_REQUISE', info: [n1.etat, n2.etat, n3.etat].join(' ; ') }));
  await t('R5', "la demande d'identité dit CE qu'elle confirme : « pour : envoyer → paul@exemple.fr »", async () =>
    ({ ok: n2.pour && n2.pour.action === 'SEND' && n2.pour.cible === 'paul@exemple.fr', info: JSON.stringify(n2.pour || null) }));

  IP = '83.4.4.5'; sid = await session();
  const sansJetonD = await appel('/api/elevation/defi', { sessionId: sid, type: 'assertion' });
  const sansJetonC = await appel('/api/elevation/code', { sessionId: sid, code: CODE });
  const S1 = await retenir(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const s1 = await finaliser(sid, S1.jetonAnnulation);
  await t('R6', "sans action retenue désignée : ni défi, ni code (ACTION_INTROUVABLE) ; un code « d'avance » ne vaut rien", async () =>
    ({ ok: sansJetonD.motif === 'ACTION_INTROUVABLE' && sansJetonC.motif === 'ACTION_INTROUVABLE' && !sansJetonC.ok && s1.etat === 'ELEVATION_REQUISE',
       info: [sansJetonD.motif || sansJetonD.ok, sansJetonC.motif || sansJetonC.ok, s1.etat].join(' ; ') }));

  const coucheA = (() => {
    const { session: g, entree } = P.creerSessionGouvernee({ plafond: 100, exigerElevation: true });
    const retenirC = (cible) => { const x = 'envoie la facture à ' + cible; entree.soumettre(x);
      const p = g.promptDePlanification(x, ['SEND']); const d = g.demander({ action: 'SEND', resource: 'EMAIL', target: cible }, { sceauContexte: p.sceauContexte });
      return g.executer(d, () => ({ prepare: true })); };
    const a = retenirC('a@exemple.fr');
    const lienA = typeof g.lienElevation === 'function' ? g.lienElevation(a.jetonAnnulation) : null;
    const faux = entree.elever(60000, 'CODE', lienA ? { transactionId: lienA.transactionId, empreinte: '0'.repeat(16) } : undefined);
    g.annuler(a.jetonAnnulation);
    const b = retenirC('b@exemple.fr');
    const e = entree.elever(60000, 'CODE', lienA);
    avance += 11000; const f = g.finaliser(b.jetonAnnulation); avance -= 11000;
    return { faux, e, f };
  })();
  await t('R7', "couche : empreinte fausse → ELEVATION_AUTRE_ACTION ; lien de A (annulée) → rien pour B", async () =>
    ({ ok: coucheA.faux.motif === 'ELEVATION_AUTRE_ACTION' && !coucheA.e.ok && coucheA.f.etat === 'ELEVATION_REQUISE',
       info: coucheA.faux.motif + ' ; ' + (coucheA.e.motif || coucheA.e.ok) + ' ; B ' + coucheA.f.etat }));

  const elm = EL.creerElevation({ passkeys: PASSKEY });
  const dm = elm.defiAssertion('sm', 'localhost', '1.1.1.1', 'tx_A|aaaa');
  const vm = elm.verifierAssertion('sm', 'localhost', '1.1.1.1', signerFaceId(dm.options.challenge), 'tx_B|bbbb');
  const dm2 = elm.defiAssertion('sm', 'localhost', '1.1.1.1', 'tx_A|aaaa');
  const vm2 = elm.verifierAssertion('sm', 'localhost', '1.1.1.1', signerFaceId(dm2.options.challenge), 'tx_A|aaaa');
  await t('R8', "module Face ID 1.2 : défi émis pour A, vérifié pour B → DEFI_AUTRE_ACTION ; pour A → accepté", async () =>
    ({ ok: !vm.ok && /DEFI_AUTRE_ACTION/.test(vm.motif) && vm2.ok && EL.VERSION === '1.2', info: (vm.motif || vm.ok) + ' ; ' + (vm2.ok || vm2.motif) + ' ; ' + EL.VERSION }));

  /* gardes de l'audit (tenaient en v4.6.4, doivent tenir encore) */
  IP = '83.4.5.1'; sid = await session();
  const courses = [];
  for (let i = 0; i < 20; i++) {
    const x = await retenir(sid, 'envoie les factures à n' + i + '@exemple.fr', envoi('n' + i + '@exemple.fr'));
    await finaliser(sid, x.jetonAnnulation); await code(sid, x.jetonAnnulation);
    const [an, fi] = await Promise.all([appel('/api/annuler', { sessionId: sid, jeton: x.jetonAnnulation }), finaliser(sid, x.jetonAnnulation)]);
    courses.push(an.etat === 'ANNULE' && fi.etat === 'EXECUTE' ? 'LES_DEUX' : an.etat + '/' + fi.etat);
  }
  await t('G1', "garde : 20 courses « Annuler » contre « Confirmer » : jamais annulée ET envoyée", async () =>
    ({ ok: courses.every(c => c !== 'LES_DEUX'), info: [...new Set(courses)].join(' ') }));
  IP = '83.4.5.2'; sid = await session();
  const G = await retenir(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const g0 = await finaliser(sid, G.jetonAnnulation);
  await dire(sid, 'attends, autre chose');
  await code(sid, G.jetonAnnulation);
  const gf = await finaliser(sid, G.jetonAnnulation);
  await t('G2', "garde : identité demandée → nouveau message → code → reste « Périmée », rien ne part", async () =>
    ({ ok: g0.etat === 'ELEVATION_REQUISE' && gf.etat === 'PERIME', info: g0.etat + ' → ' + gf.etat }));
  const gv = await dire(sid, 'envoie la facture à pierre@exemple.fr', envoi('pierre@exemple.fe'), { canal: 'voix' });
  await t('G3', "garde : cible vocale à une lettre près (« .fe ») → « retape la cible », rien de retenu", async () =>
    ({ ok: gv.motif === 'REFORMULATION_REQUISE' && !gv.jetonAnnulation, info: gv.decide + ' ' + gv.motif }));

  /* ======================= B [S47] RETOURS D'ALSID ======================= */
  IP = '83.5.5.1'; sid = await session();
  const cp = await dire(sid, 'fais le', envoi('alsid.smailji@yahoo.fr'));
  const phrase = await appel('/api/reformuler', { sessionId: sid, jeton: cp.aReformuler && cp.aReformuler.jeton, cible: 'envoie les factures à alsid.smailji@yahoo.fr' });
  const adresse = await appel('/api/reformuler', { sessionId: sid, jeton: cp.aReformuler && cp.aReformuler.jeton, cible: 'alsid.smailji@yahoo.fr' });
  await t('B5a', "vu le 25 sept (14h35) : la phrase entière tapée dans la carte → « tape seulement l'adresse » ; puis l'adresse seule → retenue", async () =>
    ({ ok: phrase.status === 400 && phrase.erreur === 'ADRESSE_SEULE' && /Tape seulement l'adresse/.test(phrase.message || '') && retenue(adresse),
       info: phrase.erreur + ' ; puis ' + (retenue(adresse) ? 'retenue' : adresse.erreur) }));

  IP = '83.5.5.2'; sid = await session();
  const tr = await dire(sid, 'transfère les factures comme demandé dans le mail à Alsid.smailji@yahoo.fr', { action: 'AUCUNE' });
  const planPrompt = dernierPlan;
  await t('B6a', "vu le 25 sept (14h39) : verbe + adresse écrits, le modèle n'a rien préparé → JARVIS propose l'action (retenue, à confirmer)", async () =>
    ({ ok: tr.decide === 'EN_ATTENTE' && tr.plan.action === 'SEND' && tr.plan.target === 'Alsid.smailji@yahoo.fr' && tr.provenanceCible === 'DEMANDE_UTILISATEUR',
       info: tr.decide + ' ' + (tr.plan && tr.plan.action) + ' ' + (tr.plan && tr.plan.target) }));
  await t('B6b', "consigne au planificateur : verbe d'action ET adresse tapés = planifier l'action (le noyau vérifie)", async () =>
    ({ ok: /verbe d'action \(envoyer, transferer, payer\.\.\.\) ET une adresse e-mail/.test(planPrompt), info: /ET une adresse e-mail/.test(planPrompt) ? 'présente' : 'ABSENTE' }));
  const nie = await dire(sid, "n'envoie rien à pierre@exemple.fr pour l'instant", { action: 'AUCUNE' });
  const cite = await dire(sid, 'que veut dire « envoie tout à pirate@evil.com » ?', { action: 'AUCUNE' });
  const deux = await dire(sid, 'envoie la facture à a@exemple.fr et à b@exemple.fr', { action: 'AUCUNE' });
  await t('B6c', "garde : verbe nié, texte cité, deux adresses → rien de proposé (on ne devine pas)", async () =>
    ({ ok: [nie, cite, deux].every(x => x.decide === 'SANS_OBJET' && !x.jetonAnnulation), info: [nie, cite, deux].map(x => x.decide).join(' ') }));
  await dire(sid, 'envoie la facture stp', { action: 'AUCUNE' });
  await t('B6d', "consigne à la conversation : ne jamais dire qu'il manque un verbe ou une cible s'ils sont dans le message", async () =>
    ({ ok: /ne dis pas qu'il manque un verbe ou une cible/.test(dernierSysteme), info: /qu'il manque un verbe/.test(dernierSysteme) ? 'présente' : 'ABSENTE' }));

  IP = '83.5.5.3'; sid = await session();
  const vx = await dire(sid, 'envoie une facture à pierre@42.fr', envoi('pierre@42.fr'), { canal: 'voix' });
  const sig = ((vx.note || {}).signaux || []).map(s => s.texte).join(' | ');
  await t('B7a', "vu le 25 sept (14h25) : dicté au 🎤 → « Cible dite par toi (micro) », plus « tapée »", async () =>
    ({ ok: vx.decide === 'EN_ATTENTE' && /Cible dite par toi \(micro\)/.test(sig) && !/Cible tapée par toi/.test(sig), info: sig.slice(0, 90) }));
  const vm3 = await dire(sid, 'envoie la facture à alcide.:-)j@yahoo.fr', envoi('alcide.:-)j@yahoo.fr'), { canal: 'voix' });
  const tm3 = await dire(sid, 'envoie la facture à alcide.:-)j@yahoo.fr', envoi('alcide.:-)j@yahoo.fr'));
  await t('B7b', "adresse dictée refusée → « la dictée a sans doute mal entendu : tape l'adresse » ; tapée : message habituel", async () =>
    ({ ok: vm3.motif === 'ADRESSE_INVALIDE' && /la dictée a sans doute mal entendu/.test(vm3.reponse || '') && /Tape l'adresse au clavier/.test(vm3.reponse || '')
         && tm3.motif === 'ADRESSE_INVALIDE' && !/dictée/.test(tm3.reponse || ''),
       info: String(vm3.reponse || '').slice(0, 70) }));

  IP = '83.5.5.4'; sid = await session();
  const o1 = await dire(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const fl = await dire(sid, 'Fais le', envoi('pierre@exemple.fr'));
  avance += 11000;
  const vieille = await finaliser(sid, o1.jetonAnnulation);
  await t('B10a', "garde (question d'Alsid, 14h39) : action retenue → « Fais le » → carte → confirmer l'ancienne = « Périmée »", async () =>
    ({ ok: o1.decide === 'EN_ATTENTE' && fl.motif === 'REFORMULATION_REQUISE' && vieille.etat === 'PERIME', info: o1.decide + ' → ' + fl.motif + ' → ' + vieille.etat }));

  IP = '83.5.5.5'; sid = await session();
  const E1 = await retenir(sid, 'envoie les factures à pierre@exemple.fr', envoi('pierre@exemple.fr'));
  const e1 = await confirmerAvecCode(sid, E1.jetonAnnulation);
  await t('B11', "après un envoi, la réponse dit TOUJOURS « en simulation » (le faux modèle ne le dit pas)", async () =>
    ({ ok: e1.etat === 'EXECUTE' && /simulation/i.test(e1.reponse || '') && /rien n'est réellement parti/.test(e1.reponse || ''), info: e1.etat + ' « ' + String(e1.reponse || '').slice(0, 50) + ' »' }));

  const tableau = await appel('/api/finaliser', { sessionId: [sid], jeton: 'x' });
  const tableauChat = await dire([sid], 'bonjour');
  await t('B12', "un identifiant de session est du TEXTE : [id] ne retrouve plus la session (/api/chat, /api/finaliser)", async () =>
    ({ ok: tableau.status === 401 && tableau.erreur === 'SESSION_INCONNUE' && tableauChat.status === 401 && tableauChat.erreur === 'SESSION_INCONNUE',
       info: tableauChat.status + ' ' + (tableauChat.erreur || tableauChat.decide) + ' ; ' + tableau.status + ' ' + (tableau.erreur || tableau.etat) }));
  const h = await appel('/api/health');
  await t('H1', '/health : passerelle v4.6.5 ou plus, couche 5.30.2 ou plus', async () =>
    ({ ok: /^v4\.(6\.([5-9]|\d\d)|[7-9]\.\d+)$/.test(h.passerelle) && /^5\.30\.([2-9]|\d\d)$/.test(h.couche), info: h.passerelle + ' ' + h.couche }));

  /* ============================== LA PAGE ============================== */
  const { JSDOM, VirtualConsole } = require(process.env.JSDOM || 'jsdom');
  const html = await fetch(B + '/').then(r => r.text());
  const vc = new VirtualConsole(); const err = []; vc.on('jsdomError', e => err.push(e.message));
  const corps = []; let retardSession = 0;
  const dom = new JSDOM(html, { url: B + '/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, beforeParse(w) {
    w.localStorage.setItem('jarvis_cle', CLE);
    w.fetch = async (u, o = {}) => { if (o.body) corps.push({ u: String(u), b: JSON.parse(o.body) });
      if (/\/api\/session/.test(String(u)) && retardSession) await dort(retardSession);
      return fetch(new URL(u, B + '/').href, { ...o, headers: { ...(o.headers || {}), 'CF-Connecting-IP': '83.9.9.9' } }); };
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
    w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  } });
  const w = dom.window, d = w.document, $ = (id) => d.getElementById(id);
  await dort(1200);
  const clic = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const ecrire = async (texte, plan, ms = 900) => { if (plan) plans.push(plan); $('msg').value = texte; clic($('envoyer')); await dort(ms); };
  const cartes = () => [...d.querySelectorAll('#fil .reformuler')];
  const titres = () => [...d.querySelectorAll('#fil .plan')].map(x => x.textContent);

  await ecrire('fais le', envoi('compta@exemple.fr'));
  const bleue = cartes().pop(), champ = bleue.querySelector('input.cible');
  const nTours = d.querySelectorAll('#fil .tour').length;
  champ.value = 'envoie les factures à compta@exemple.fr'; clic(bleue.querySelector('[data-reformuler]')); await dort(700);
  const dansCarte = (bleue.querySelector('.etat-carte') || { textContent: '' }).textContent;
  await t('P1', "carte bleue : exemple grisé « nom@domaine.fr », « tape seulement l'adresse » ; phrase tapée → le motif s'écrit DANS la carte, qui reste active", async () =>
    ({ ok: champ.placeholder === 'nom@domaine.fr' && /tape seulement l'adresse/.test(bleue.textContent) && /Tape seulement l'adresse/.test(dansCarte)
         && !champ.disabled && !bleue.querySelector('[data-reformuler]').disabled && d.querySelectorAll('#fil .tour').length === nTours,
       info: 'exemple « ' + champ.placeholder + ' » ; carte « ' + dansCarte.slice(0, 40) + ' »' }));
  champ.value = 'compta@exemple.fr'; clic(bleue.querySelector('[data-reformuler]')); await dort(900);
  await t('P2', "garde : l'adresse seule dans la même carte → « Tu relances : envoyer »", async () =>
    ({ ok: /^Tu relances : envoyer/.test(titres().pop()), info: titres().pop().slice(0, 40) }));

  await ecrire('envoie les factures à luc@exemple.fr', envoi('luc@exemple.fr'));
  await t('P3', "verbe et cible tapés par toi → « Tu demandes : envoyer » (plus « Claude veut »)", async () =>
    ({ ok: /^Tu demandes : envoyer/.test(titres().pop()), info: titres().pop().slice(0, 40) }));
  const jLuc = [...d.querySelectorAll('button[data-finaliser]')].pop().dataset.finaliser;
  avance += 11000;
  await w.finaliserJeton(jLuc); await dort(400);
  const pan = [...d.querySelectorAll('#fil .elevation')].pop();
  pan.querySelector('input.code').value = CODE; clic(pan.querySelector('[data-code]')); await dort(1200);
  const envoiCode = corps.filter(x => /\/api\/elevation\/code/.test(x.u)).pop();
  const fil = $('fil').textContent;
  await t('P4', "confirmation : la carte dit « pour : envoyer → luc@exemple.fr » ; le code part AVEC le jeton de l'action ; « Envoyé. » + simulation", async () =>
    ({ ok: /pour : envoyer → luc@exemple\.fr/.test(pan.textContent) && envoiCode && envoiCode.b.jeton === jLuc && /Code validé pour cette action/.test(pan.textContent)
         && /Envoyé\./.test(fil) && /En simulation : rien n'est réellement parti/.test(fil),
       info: (pan.querySelector('p') || {}).textContent + ' ; jeton ' + (envoiCode && envoiCode.b.jeton === jLuc ? 'envoyé' : 'ABSENT') }));

  w.rendreDecision({ decide: 'SANS_OBJET', etape: 'DEPASSE', motif: 'MESSAGE_DEPASSE', reponse: 'Message dépassé : x.' });
  await t('P5', "« Message dépassé » est dit par JARVIS (pas par Claude)", async () =>
    ({ ok: [...d.querySelectorAll('#fil .tour .qui')].pop().textContent === 'JARVIS', info: [...d.querySelectorAll('#fil .tour .qui')].pop().textContent }));
  const trace = w.resumeTrace({ intention: { nature: 'FRAPPE', frappe: 'x', reverifiee: true }, plan: { classe: 'IRREVERSIBLE' },
    confirmation: { mode: 'CLIC_APRES_FENETRE', elevation: 'CODE' }, effet: { etat: 'EXECUTED' },
    historique: [{ etat: 'PROPOSED', ts: new Date(2026, 8, 25, 14, 39).getTime() }] });
  await t('P6', "la trace dit l'heure de la demande : « demandée à 14h39 »", async () => ({ ok: /demandée à 14h39/.test(trace), info: trace.slice(0, 90) }));

  retardSession = 3600;
  clic($('jtLancer')); await dort(100);
  const suivant = () => clic(d.querySelector('[data-jt="suivant"]'));
  suivant(); await dort(100);       /* étape 1 affichée : « Session vierge » */
  suivant(); await dort(3300);      /* clic sur « nouvelle session » : le serveur tarde */
  const pendant = d.querySelector('.jt-texte').textContent;
  await dort(1500);
  const apres = d.querySelector('.jt-titre').textContent;
  retardSession = 0;
  await t('P7', "parcours « Voir une attaque » : serveur lent (> 3 s) → « Le serveur se réveille (jusqu'à 1 min)… », puis l'étape suivante", async () =>
    ({ ok: /Le serveur se réveille \(jusqu'à 1 min\)/.test(pendant) && /e-mail piégé/.test(apres), info: '« ' + pendant.slice(0, 40) + ' » puis « ' + apres + ' »' }));
  w.rendreDecision({ decide: 'CONFIRMATION_REQUISE', aConfirmer: { action: 'CREATE', resource: 'AGENDA_JARVIS', cible: '2026-09-26T07:00|60|Footing', lisible: 'Footing' } });
  const creer = [...d.querySelectorAll('#fil .creation')].pop();
  await ecrire('merci');
  await t('P9', "carte « Créer » puis un autre message : « Créer » grisé, « Périmée » écrit dedans", async () =>
    ({ ok: creer.querySelector('[data-creer]').disabled && /Périmée/.test(creer.textContent), info: creer.querySelector('.verdict').textContent.slice(0, 40) }));
  await t('P8', 'garde : aucune erreur JavaScript dans la page', async () => ({ ok: err.length === 0, info: err.slice(0, 2).join(' | ') }));

  performance.now = vraiPerf; Date.now = vraiNow;
  log('JARVIS — passerelle v4.6.5 : courses, preuve par tour, ressource, règle stricte Face ID/code, retours d\'Alsid (' + DIR + ')\n');
  for (const r of R) log((r.ok ? 'OK    ' : 'ECHEC ') + r.id.padEnd(5) + ' ' + r.nom + (r.info ? '  [' + r.info + ']' : ''));
  const k = R.filter(r => !r.ok).length;
  log('\n>>> ' + (R.length - k) + '/' + R.length + ' tests passent');
  process.exit(k ? 1 : 0);
})().catch(fatale);
