'use strict';
/* ============================================================================
 * JARVIS — tests du chantier « transactions scellees » (couche 5.29.6)
 * ----------------------------------------------------------------------------
 * Les attaques et sequences du plan red team, ecrites contre l'interface
 * PUBLIQUE de la couche, du point de vue d'un code du meme processus (un
 * handler d'outil bogue ou hostile, un appelant negligent).
 *   node tests-transactions.js
 *   JARVIS_DIR=../ancienne node tests-transactions.js   (pour voir les echecs)
 * [non-regression] : doit passer sur les deux versions.
 * Invariant central : aucune donnee, aucun temps, aucune sequence ne cree de
 * pouvoir qui n'a pas ete accorde.
 * ========================================================================== */
const path = require('path');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const P = require(path.join(DIR, 'jarvis-plus-5.29.js'));
const K = P.noyau;

/* [5.29.7] Aides : l'entree de confiance passe par creerSessionGouvernee.
 * Sur une couche anterieure (sans fabrique), retour a l'ancienne declaration :
 * le meme fichier tourne sur les deux versions. */
const __entrees = new WeakMap();
const nouvelle = (o) => {
  if (typeof P.creerSessionGouvernee !== 'function') return nouvelle(o);
  const { session, entree } = P.creerSessionGouvernee(o); __entrees.set(session, entree); return session;
};
const direct = (s, o) => __entrees.has(s)
  ? __entrees.get(s).soumettre(String(o.texte != null ? o.texte : o.resume))
  : s.ingerer({ source: 'clavier', ...o, origine: 'USER_DIRECT' });
const reform = (s, a, c) => __entrees.has(s) ? __entrees.get(s).reformuler(a, c) : reform(s,a, c);

const R = [];
const t = (id, nom, f) => {
  let r; try { r = f(); } catch (e) { r = { ok: false, info: 'exception ' + e.constructor.name + ' : ' + String(e.message).slice(0, 70) }; }
  R.push({ id, nom, ok: !!r.ok, info: r.info });
};
const essai = (f) => { try { f(); } catch { /* objet gele : ecriture refusee */ } };

/* Temps controle : horloge monotone injectee (nouvelle couche) ET Date.now
 * (ancienne couche), avances ensemble. */
let mono = 1000, decalage = 0;
const dateReelle = Date.now;
Date.now = () => dateReelle() + decalage;
const avancer = (ms) => { mono += ms; decalage += ms; };
const horloge = { mono: () => mono };

/* Une session ou l'utilisateur a tape sa demande : la cible est confirmee. */
function session(texte = 'envoie le rapport à marc@exemple.fr', opts = {}) {
  const g = nouvelle({ horloge, ...opts });
  direct(g,{origine:'USER_DIRECT', resume: texte, source: 'clavier', texte });
  const { sceauContexte } = g.promptDePlanification(texte, ['SEND', 'READ', 'WRITE', 'DELETE']);
  return { g, sceau: sceauContexte };
}
const lire    = (g, sceau, cible = 'notes', o = {}) => g.demander({ action: 'READ', resource: 'LOCAL', target: cible }, { sceauContexte: sceau, ...o });
const envoyer = (g, sceau, cible = 'marc@exemple.fr') => g.demander({ action: 'SEND', resource: 'EMAIL', target: cible }, { sceauContexte: sceau });
const ecrire  = (g, sceau, cible = 'n.txt', comp = 'restaurer n.txt') => g.demander({ action: 'WRITE', resource: 'LOCAL', target: cible }, { sceauContexte: sceau, compensation: comp });
const derniere = (g, ev = 'EXECUTE') => g.journal.filter(x => x.evenement === ev).slice(-1)[0] || {};

/* ---------------- I1 AUTORITE : une donnee n'autorise rien ---------------- */
t('T1.1', "fenetreAnnulationMs mise a 0 par l'appelant : l'irreversible reste retenu 10 s", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau);
  essai(() => { a.fenetreAnnulationMs = 0; });
  const e = g.executer(a, () => ({ parti: true }));
  return { ok: a.decide === 'AUTORISE' && e.etat === 'EN_ATTENTE', info: e.etat };
});
t('T1.2', "{ decide:'AUTORISE' } fabrique : refus propre, sans exception", () => {
  const { g } = session(); const r = g.executer({ decide: 'AUTORISE' }, () => ({}));
  return { ok: r.etat === 'REFUSE', info: r.etat + ' ' + (r.motif || '') };
});
t('T1.3', "[non-regression] recu d'une AUTRE session presente ici : inconnu", () => {
  const A = session(), B = session(); const a = lire(A.g, A.sceau);
  const r = B.g.executer({ decide: 'AUTORISE', autorisationId: a.autorisationId, _interne: a._interne }, () => ({}));
  return { ok: r.etat === 'REFUSE', info: r.etat + ' ' + (r.motif || '') };
});
t('T1.4', "copie du recu avec une autre cible : l'effet recoit la cible AUTORISEE", () => {
  const { g, sceau } = session(); const a = lire(g, sceau, 'notes'); let recu;
  const r = g.executer({ ...a, target: 'pirate@evil.com', spec: { target: 'pirate@evil.com' } }, (x) => { recu = x; return {}; });
  return { ok: r.etat === 'EXECUTE' && recu && recu.target === 'notes' && derniere(g).cible === 'notes',
           info: 'handler=' + JSON.stringify(recu && recu.target) + ' journal=' + derniere(g).cible };
});
t('T1.5', "proposal(A) -> authorization(B) -> commit(A) : l'identifiant de B n'execute que B", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau); const b = lire(g, sceau, 'secret'); let recu;
  const r = g.executer({ ...a, autorisationId: b.autorisationId }, (x) => { recu = x; return {}; });
  const j = derniere(g);
  return { ok: r.etat === 'EXECUTE' && j.action === 'READ' && j.cible === 'secret' && recu && recu.action === 'READ',
           info: r.etat + ' journal=' + j.action + ' ' + j.cible };
});
t('T1.6', "classe du recu mise a REVERSIBLE : le journal garde IRREVERSIBLE", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau);
  essai(() => { a.classe = 'REVERSIBLE'; });
  const e = g.executer(a, () => ({})); avancer(10001); const r = g.finaliser(e.jetonAnnulation);
  return { ok: r.etat === 'EXECUTE' && derniere(g).classe === 'IRREVERSIBLE', info: r.etat + ' classe journal=' + derniere(g).classe };
});
t('T1.7', "une methode remplacee a chaud n'a aucun effet (instance et prototype)", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau);
  const origine = P.SessionGouvernee.prototype.finaliser;
  essai(() => { g.executer = () => ({ etat: 'EXECUTE' }); });
  essai(() => { P.SessionGouvernee.prototype.finaliser = () => ({ etat: 'EXECUTE' }); });
  const e = g.executer(a, () => ({})); const f = g.finaliser(e.jetonAnnulation);
  /* isolement : sur une classe non gelee, remettre l'original pour les tests suivants */
  if (P.SessionGouvernee.prototype.finaliser !== origine) essai(() => { P.SessionGouvernee.prototype.finaliser = origine; });
  return { ok: e.etat === 'EN_ATTENTE' && f.etat === 'TROP_TOT', info: e.etat + ' / ' + f.etat };
});

/* ---------------- I2 INTEGRITE : liee de bout en bout ---------------- */
t('T2.1', "chaine requete -> proposition -> autorisation -> transaction, identifiants distincts", () => {
  const { g, sceau } = session(); const a = lire(g, sceau); const r = g.executer(a, () => ({}));
  const ids = [a.requeteId, a.propositionId, a.autorisationId, r.transactionId];
  const v = g.transaction(a.autorisationId);
  return { ok: ids.every(x => typeof x === 'string' && x.length > 8) && new Set(ids).size === 4
             && v && v.transactionId === r.transactionId && v.requeteId === a.requeteId,
           info: ids.map(x => String(x).slice(0, 8)).join(' -> ') };
});
t('T2.2', "requeteId rejouee : refusee", () => {
  const { g, sceau } = session();
  const a1 = lire(g, sceau, 'a', { requeteId: 'req-42' }), a2 = lire(g, sceau, 'b', { requeteId: 'req-42' });
  return { ok: a1.decide === 'AUTORISE' && a2.decide === 'REFUSE' && a2.motif === 'REQUETE_REJOUEE', info: a1.decide + ' puis ' + a2.decide + ' ' + (a2.motif || '') };
});
t('T2.3', "requeteId malformee : refusee", () => {
  const { g, sceau } = session(); const a = lire(g, sceau, 'a', { requeteId: 'req 42 <script>' });
  return { ok: a.decide === 'REFUSE', info: a.decide + ' ' + (a.motif || '') };
});
t('T2.4', "le recu est gele et ne transporte aucune permission du noyau", () => {
  const { g, sceau } = session(); const a = lire(g, sceau);
  return { ok: Object.isFrozen(a) && a._interne === undefined && typeof a.empreinte === 'string', info: 'gele=' + Object.isFrozen(a) + ' _interne=' + (a._interne === undefined ? 'absent' : 'PRESENT') };
});
t('T2.5', "[non-regression] autorisation revoquee cote noyau entre la decision et le commit : refus", () => {
  const j = new K.Jarvis({ initialCeiling: 100 });
  const { g, sceau } = session(undefined, { jarvis: j }); const a = lire(g, sceau);
  j.permissions.revoke(a.permissionId); const r = g.executer(a, () => ({}));
  return { ok: r.etat !== 'EXECUTE', info: r.etat + ' ' + (r.motif || '') };
});

/* ---------------- I3 MONOTONICITE : machine d'etat ---------------- */
t('T3.1', "irreversible execute deux fois : un seul jeton, la seconde fois refusee", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau);
  const e1 = g.executer(a, () => ({})), e2 = g.executer(a, () => ({}));
  return { ok: e1.etat === 'EN_ATTENTE' && e2.etat === 'REFUSE', info: e1.etat + ' puis ' + e2.etat + ' ' + (e2.motif || '') };
});
t('T3.2', "[non-regression] reversible execute deux fois : la seconde refusee", () => {
  const { g, sceau } = session(); const a = lire(g, sceau);
  const r1 = g.executer(a, () => ({})), r2 = g.executer(a, () => ({}));
  return { ok: r1.etat === 'EXECUTE' && r2.etat !== 'EXECUTE', info: r1.etat + ' puis ' + r2.etat };
});
t('T3.3', "annuler puis re-executer le meme recu : refuse (pas de retour arriere)", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau); const e = g.executer(a, () => ({}));
  g.annuler(e.jetonAnnulation); const e2 = g.executer(a, () => ({}));
  avancer(10001); const f = e2.jetonAnnulation ? g.finaliser(e2.jetonAnnulation) : { etat: 'aucun jeton' };
  return { ok: e2.etat === 'REFUSE' && f.etat !== 'EXECUTE', info: 're-executer=' + e2.etat + ' ' + (e2.motif || '') + ' finaliser=' + f.etat };
});
t('T3.4', "[non-regression] annuler puis finaliser : rien ne part", () => {
  const { g, sceau } = session(); const e = g.executer(envoyer(g, sceau), () => ({}));
  g.annuler(e.jetonAnnulation); avancer(10001); const f = g.finaliser(e.jetonAnnulation);
  return { ok: f.etat !== 'EXECUTE', info: f.etat };
});
t('T3.5', "revoquer pendant la fenetre, puis finaliser : rien ne part", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau); const e = g.executer(a, () => ({}));
  const rv = g.revoquer(e.jetonAnnulation); avancer(10001); const f = g.finaliser(e.jetonAnnulation);
  const v = g.transaction(a.autorisationId);
  return { ok: rv.etat === 'REVOQUE' && f.etat !== 'EXECUTE' && v.etat === 'REVOKED', info: rv.etat + ' / ' + f.etat + ' / ' + v.etat };
});
t('T3.6', "revoquer avant d'executer : l'execution est refusee", () => {
  const { g, sceau } = session(); const a = lire(g, sceau); g.revoquer(a.autorisationId);
  const r = g.executer(a, () => ({}));
  return { ok: r.etat === 'REFUSE' && r.motif === 'ETAT_REVOKED', info: r.etat + ' ' + (r.motif || '') };
});
t('T3.7', "historique complet et ordonne d'une execution", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau); const e = g.executer(a, () => ({}));
  avancer(10001); g.finaliser(e.jetonAnnulation);
  const h = g.transaction(a.autorisationId).historique.map(x => x.etat).join('>');
  return { ok: h === 'PROPOSED>AUTHORIZED>PENDING>COMMITTING>EXECUTED', info: h };
});
t('T3.8', "le handler rappelle executer() sur le meme recu pendant l'effet : refuse", () => {
  const { g, sceau } = session(); const a = lire(g, sceau); let interne;
  const r = g.executer(a, () => { interne = g.executer(a, () => ({})); return {}; });
  return { ok: r.etat === 'EXECUTE' && interne && interne.etat === 'REFUSE', info: 'dehors=' + r.etat + ' dedans=' + (interne && interne.etat) + ' ' + ((interne && interne.motif) || '') };
});
t('T3.9', "le handler tente d'annuler pendant le commit : pas d'etat divise", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau); const e = g.executer(a, () => ({}));
  avancer(10001); let ann;
  const r = g.finaliser(e.jetonAnnulation);
  const { g: g2, sceau: s2 } = session(); const a2 = envoyer(g2, s2); let e2;
  e2 = g2.executer(a2, () => { ann = g2.annuler(e2.jetonAnnulation); return {}; });
  avancer(10001); const f2 = g2.finaliser(e2.jetonAnnulation);
  const v = g2.transaction(a2.autorisationId);
  return { ok: r.etat === 'EXECUTE' && f2.etat === 'EXECUTE' && ann.etat === 'INTROUVABLE' && v.etat === 'EXECUTED'
             && !g2.journal.some(x => x.evenement === 'ANNULE_PAR_UTILISATEUR'),
           info: 'annuler dedans=' + (ann && ann.etat) + ' final=' + (v && v.etat) };
});
t('T3.10', "le handler plante : transaction FAILED, aucun EXECUTE journalise, pas de nouvel essai", () => {
  const { g, sceau } = session(); const a = lire(g, sceau);
  const r = g.executer(a, () => { throw new Error('outil en panne'); });
  const r2 = g.executer(a, () => ({}));
  const v = g.transaction(a.autorisationId);
  return { ok: r.etat !== 'EXECUTE' && r2.etat === 'REFUSE' && v.etat === 'FAILED' && !g.journal.some(x => x.evenement === 'EXECUTE'),
           info: r.etat + ' / ' + r2.etat + ' / ' + (v && v.etat) };
});

/* ---------------- TEMPS ---------------- */
t('T4.1', "reculer l'heure systeme avant la mise en attente ne raccourcit pas la fenetre", () => {
  const { g, sceau } = session(); const a = envoyer(g, sceau);
  decalage -= 20000; const e = g.executer(a, () => ({})); decalage += 20000;
  const f = g.finaliser(e.jetonAnnulation);
  return { ok: f.etat === 'TROP_TOT', info: f.etat };
});
t('T4.2', "avancer l'heure systeme de 11 s ne raccourcit pas la fenetre (duree monotone)", () => {
  const { g, sceau } = session(); const e = g.executer(envoyer(g, sceau), () => ({}));
  decalage += 11000; const f = g.finaliser(e.jetonAnnulation);
  return { ok: f.etat === 'TROP_TOT', info: f.etat };
});
t('T4.3', "[non-regression] apres les 10 s reelles, l'envoi part", () => {
  const { g, sceau } = session(); const e = g.executer(envoyer(g, sceau), () => ({}));
  avancer(10001); const f = g.finaliser(e.jetonAnnulation);
  return { ok: f.etat === 'EXECUTE', info: f.etat };
});
t('T4.4', "autorisation expiree avant l'execution : refus, et la transaction passe EXPIRED", () => {
  const { g, sceau } = session(); const a = lire(g, sceau); avancer(301000);
  const r = g.executer(a, () => ({})); const v = g.transaction(a.autorisationId);
  return { ok: r.etat === 'REFUSE' && v && v.etat === 'EXPIRED', info: r.etat + ' ' + (r.motif || '') + ' etat=' + (v && v.etat) };
});
t('T4.5', "[non-regression] expiration pendant la fenetre : la finalisation est refusee", () => {
  const { g, sceau } = session(); const e = g.executer(envoyer(g, sceau), () => ({}));
  avancer(301000); const f = g.finaliser(e.jetonAnnulation);
  return { ok: f.etat !== 'EXECUTE', info: f.etat + ' ' + (f.motif || '') };
});

/* ---------------- FAIL-CLOSED ---------------- */
t('T5.1', "[non-regression] executer(undefined, null, '', [], 42, {}) : refus propre a chaque fois", () => {
  const { g } = session();
  const out = [undefined, null, '', [], 42, {}].map(x => { try { return g.executer(x, () => ({})).etat; } catch { return 'EXCEPTION'; } });
  return { ok: out.every(x => x === 'REFUSE'), info: out.join(' ') };
});
t('T5.2', "demander(null, {}, [], {action:42}) : refus propre, sans exception", () => {
  const { g } = session();
  const out = [null, {}, [], { action: 42 }].map(x => { try { return g.demander(x).decide; } catch { return 'EXCEPTION'; } });
  return { ok: out.every(x => x === 'REFUSE'), info: out.join(' ') };
});
t('T5.3', "[non-regression] finaliser / annuler avec un jeton inconnu, vide ou d'une autre forme : introuvable", () => {
  const { g } = session();
  const out = [undefined, '', 'tx_inexistant', { id: 1 }, '../x'].map(x => g.finaliser(x).etat + '/' + g.annuler(x).etat);
  return { ok: out.every(x => x === 'INTROUVABLE/INTROUVABLE'), info: out[0] };
});
t('T5.4', "[non-regression] handler qui n'est pas une fonction : refus avant tout effet", () => {
  const { g, sceau } = session(); const a = lire(g, sceau);
  const r = g.executer(a, 'rm -rf /');
  return { ok: r.etat === 'REFUSE', info: r.etat + ' ' + (r.motif || '') };
});

t('T5.5', "F112 getter qui change de valeur entre deux lectures : jamais un envoi classe reversible", () => {
  const bilan = [];
  for (let k = 0; k < 10; k++) {
    const { g } = session(); let n = 0;
    const spec = { resource: 'EMAIL', target: 'pirate@evil.com', get action() { return n++ < k ? 'READ' : 'SEND'; } };
    let a; try { a = g.demander(spec); } catch { bilan.push('EXC'); continue; }
    if (a.decide === 'AUTORISE') g.executer(a, () => ({}));
    const faux = g.journal.some(x => x.evenement === 'EXECUTE' && String(x.action).toUpperCase() === 'SEND');
    bilan.push(faux ? 'PERCE' : 'ok');
  }
  return { ok: bilan.every(x => x === 'ok'), info: bilan.join(' ') };
});
t('T5.6', "champ non textuel (objet dont toString change) : refus", () => {
  const { g } = session(); let n = 0;
  const a = g.demander({ action: 'READ', resource: 'LOCAL', target: { toString: () => (n++ ? 'pirate' : 'notes') } });
  return { ok: a.decide === 'REFUSE', info: a.decide + ' ' + (a.motif || '') };
});
t('T5.7', "portee joker (ALL, *, GLOBAL) : refusee ; absente : la plus etroite", () => {
  const { g, sceau } = session();
  const out = ['ALL', '*', 'GLOBAL', '/**'].map(x => g.demander({ action: 'READ', resource: 'LOCAL', target: 'x', scope: x }, { sceauContexte: sceau }).decide);
  const d = lire(g, sceau); const v = g.transaction ? g.transaction(d.autorisationId) : null;
  return { ok: out.every(x => x === 'REFUSE') && v && v.spec.scope === 'CURRENT_CONTEXT', info: out.join(' ') + ' / defaut=' + (v && v.spec.scope) };
});
t('T5.8', "recu dont la lecture plante (getter piege) : refus propre", () => {
  const { g } = session();
  const piege = { get decide() { throw new Error('boum'); } };
  let r; try { r = g.executer(piege, () => ({})); } catch { r = { etat: 'EXCEPTION' }; }
  return { ok: r.etat === 'REFUSE', info: r.etat + ' ' + (r.motif || '') };
});

/* ---------------- UNE PREUVE HUMAINE = UNE AUTORISATION ---------------- */
const envoyerJusquauBout = (g, a) => { const e = g.executer(a, () => ({})); avancer(10001); return g.finaliser(e.jetonAnnulation); };
t('T2.6', "une reformulation autorise UN envoi, pas trois", () => {
  const g = nouvelle({ horloge }); direct(g,{origine:'USER_DIRECT', resume: 'x', source: 'clavier' });
  reform(g,'SEND', 'a@b.c'); g.dryRun({ action: 'SEND', resource: 'EMAIL', target: 'a@b.c' });
  const out = [];
  for (let i = 0; i < 3; i++) {
    const a = g.demander({ action: 'SEND', resource: 'EMAIL', target: 'a@b.c' });
    out.push(a.decide === 'AUTORISE' ? envoyerJusquauBout(g, a).etat : a.motif);
  }
  return { ok: out[0] === 'EXECUTE' && out.slice(1).every(x => x === 'REFORMULATION_REQUISE'), info: out.join(' ') };
});
t('T2.7', "une phrase tapee autorise UN envoi : la meme demande scellee ne resert pas", () => {
  const { g, sceau } = session(); const out = [];
  for (let i = 0; i < 2; i++) { const a = envoyer(g, sceau); out.push(a.decide === 'AUTORISE' ? envoyerJusquauBout(g, a).etat : a.motif); }
  return { ok: out[0] === 'EXECUTE' && out[1] === 'REFORMULATION_REQUISE', info: out.join(' ') };
});
t('T2.8', "une demande refusee par le noyau ne brule pas la preuve : on peut reessayer", () => {
  const g = nouvelle({ horloge }); direct(g,{origine:'USER_DIRECT', resume: 'x', source: 'clavier' });
  g.dryRun({ action: 'SEND', resource: 'EMAIL', target: 'a@b.c' });
  reform(g,'SEND', 'a@b.c');
  const a0 = g.demander({ action: 'SEND', resource: 'EMAIL', target: 'a@b.c' });   /* reste active */
  reform(g,'SEND', 'a@b.c');                                                 /* nouvelle preuve */
  const a1 = g.demander({ action: 'SEND', resource: 'EMAIL', target: 'a@b.c' });   /* le noyau refuse (M3) */
  g.revoquer(a0.autorisationId);
  const a2 = g.demander({ action: 'SEND', resource: 'EMAIL', target: 'a@b.c' });   /* la preuve est intacte */
  return { ok: a0.decide === 'AUTORISE' && a1.decide === 'REFUSE' && a1.motif !== 'REFORMULATION_REQUISE' && a2.decide === 'AUTORISE',
           info: a0.decide + ' / ' + a1.decide + ' ' + a1.motif + ' / ' + a2.decide + ' ' + (a2.motif || '') };
});

/* ---------------- COMPENSATION PROUVEE ---------------- */
t('T6.1', "compensation sans moyen de verification : refusee", () => {
  const { g, sceau } = session(); const a = ecrire(g, sceau); g.executer(a, () => ({}));
  const c = g.compenser(a.autorisationId, { executer: () => ({}) });
  return { ok: c.etat === 'REFUSE' && c.motif === 'COMPENSATION_NON_VERIFIABLE', info: c.etat + ' ' + (c.motif || '') };
});
t('T6.2', "verification qui repond « ok » (et pas true) : echec, jamais compte comme fait", () => {
  const { g, sceau } = session(); const a = ecrire(g, sceau); g.executer(a, () => ({}));
  const c = g.compenser(a.autorisationId, { executer: () => ({ restaure: true }), verifier: () => 'ok' });
  const rayon = g.rayonDImpact(0).aCompenser.map(x => x.cible);
  return { ok: c.etat === 'ECHEC' && g.transaction(a.autorisationId).etat === 'COMPENSATION_FAILED' && rayon.includes('n.txt'),
           info: c.etat + ' / reste a compenser : ' + rayon.join(',') };
});
t('T6.3', "compensation executee ET verifiee : preuve, et elle sort du rayon d'impact", () => {
  const { g, sceau } = session(); const a = ecrire(g, sceau, 'm.txt', 'restaurer m.txt'); g.executer(a, () => ({}));
  let fichier = 'modifie';
  const c = g.compenser(a.autorisationId, { executer: () => { fichier = 'original'; return { fichier }; }, verifier: () => fichier === 'original' });
  const v = g.transaction(a.autorisationId); const rayon = g.rayonDImpact(0).aCompenser.map(x => x.cible);
  return { ok: c.etat === 'COMPENSE' && typeof c.preuve === 'string' && v.etat === 'COMPENSATED' && v.preuveCompensation === c.preuve && !rayon.includes('m.txt'),
           info: c.etat + ' preuve=' + String(c.preuve).slice(0, 12) };
});
t('T6.4', "compenser deux fois : la seconde refusee", () => {
  const { g, sceau } = session(); const a = ecrire(g, sceau); g.executer(a, () => ({}));
  const ok = { executer: () => ({}), verifier: () => true };
  const c1 = g.compenser(a.autorisationId, ok), c2 = g.compenser(a.autorisationId, ok);
  return { ok: c1.etat === 'COMPENSE' && c2.etat === 'REFUSE', info: c1.etat + ' puis ' + c2.etat + ' ' + (c2.motif || '') };
});
t('T6.5', "compenser une action qui n'a pas eu lieu : refuse", () => {
  const { g, sceau } = session(); const a = ecrire(g, sceau);
  const c = g.compenser(a.autorisationId, { executer: () => ({}), verifier: () => true });
  return { ok: c.etat === 'REFUSE', info: c.etat + ' ' + (c.motif || '') };
});

Date.now = dateReelle;
console.log('JARVIS — transactions scellees (' + DIR + ')\n');
for (const x of R) console.log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(6) + x.nom + (x.info !== undefined ? '  [' + x.info + ']' : ''));
const ko = R.filter(x => !x.ok).length;
console.log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
process.exit(ko ? 1 : 0);
