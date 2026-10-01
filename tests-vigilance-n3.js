'use strict';
/* ============================================================================
 * JARVIS — vigilance 5.29.5 : N3, LA NÉGATION PORTÉE PAR LA PROPOSITION
 *                                                 node tests-vigilance-n3.js
 * ----------------------------------------------------------------------------
 * Trouvé le 1er oct en comparant avec sosoj92/jarvis-assistant-vocal, dont le
 * « oui » vocal accepte « non, ne fais pas ça » (sous-chaînes, sans négation).
 * JARVIS gère la négation (N1) mais ne regardait que 3 mots avant le verbe :
 * « je ne veux pas que tu l'envoies à marc@… » était une intention PRÉSENTE,
 * et le serveur ([S47] actionEcrite) proposait lui-même l'envoi refusé.
 * Chaque test ÉCHOUE sur la v4.11, sauf ceux marqués « garde » :
 *                              JARVIS_DIR=../v411 node tests-vigilance-n3.js
 * Fonctions pures : ni serveur, ni page, ni horloge.
 * ========================================================================== */
const path = require('path');
const DIR = path.resolve(process.env.JARVIS_DIR || '.');
const VG = require(path.join(DIR, 'jarvis-vigilance.js'));
const R = [];
const t = (id, nom, f) => { let r; try { r = f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };
const A = (action, texte) => VG.analyserIntention(action, texte);
const nie = (action, texte) => { const r = A(action, texte); return { ok: !r.presente && r.raison === 'NIE', info: r.raison }; };
const present = (action, texte) => { const r = A(action, texte); return { ok: r.presente, info: r.raison }; };

/* ============================ N  NÉGATIONS ============================ */
t('N1', "« je ne veux pas que tu l'envoies » : nié", () => nie('SEND', "je ne veux pas que tu l'envoies à marc@exemple.fr"));
t('N2', "« je veux pas que tu l'envoies » (sans « ne ») : nié", () => nie('SEND', "je veux pas que tu l’envoies à marc@exemple.fr"));
t('N3', "« hors de question d'envoyer » : nié", () => nie('SEND', "hors de question d'envoyer ça à marc@exemple.fr"));
t('N4', "« je t'interdis d'envoyer » : nié", () => nie('SEND', "je t'interdis d'envoyer ça à marc@exemple.fr"));
t('N5', "« interdiction d'envoyer » : nié", () => nie('SEND', "interdiction d'envoyer quoi que ce soit à marc@exemple.fr"));
t('N6', "« je refuse que tu transfères » : nié", () => nie('SEND', 'je refuse que tu transfères ça à marc@exemple.fr'));
t('N7', "DELETE : « hors de question de supprimer l'événement » : nié", () => nie('DELETE', "hors de question de supprimer l'événement de mercredi"));
t('N8', 'PAY : « inutile de payer » : nié', () => nie('PAY', 'inutile de payer marc@exemple.fr'));

/* ============================ E  AVIS DE LA VIGILANCE ============================ */
t('E1', "envoi irréversible + « je ne veux pas que tu l'envoies » : reformulation exigée, motif INTENTION_NIEE", () => {
  const v = new VG.Vigilance();
  const a = v.evaluer({ action: 'SEND', target: 'marc@exemple.fr', classe: 'IRREVERSIBLE', plancher: 'USER_DIRECT',
    texte: "je ne veux pas que tu l'envoies à marc@exemple.fr", manuel: false });
  return { ok: a.exigerReformulation && a.motif === 'INTENTION_NIEE', info: a.motif };
});
t('V1', 'version 5.29.5', () => ({ ok: VG.VERSION === '5.29.5', info: VG.VERSION }));

/* ============================ G  GARDES ============================ */
t('G1', 'garde : « envoie les factures à … » : présente', () => present('SEND', 'envoie les factures à marc@exemple.fr'));
t('G2', "garde : « n'oublie pas d'envoyer » : présente (rappel)", () => present('SEND', "n'oublie pas d'envoyer les factures à marc@exemple.fr"));
t('G3', "garde : « il ne reste qu'à l'envoyer » : présente (ne … que)", () => present('SEND', "il ne reste qu'à l'envoyer à marc@exemple.fr"));
t('G4', "garde : « si tu n'as pas de réponse demain, renvoie » : présente (virgule)", () => present('SEND', "si tu n'as pas de réponse demain, renvoie à marc@exemple.fr"));
t('G5', "garde (déjà vrai en v4.11, durcit) : « si tu n'as pas de réponse renvoie » sans virgule : nié, la cible sera à retaper",
  () => nie('SEND', "si tu n'as pas de réponse renvoie à marc@exemple.fr"));
t('G6', 'garde [S47] : « transfère les factures comme demandé dans le mail à … » : présente',
  () => present('SEND', 'transfère les factures comme demandé dans le mail à marc@exemple.fr'));
t('G7', 'garde : « envoie sans attendre » : présente', () => present('SEND', 'envoie sans attendre à marc@exemple.fr'));
t('G8', "garde : « n'envoie que le rapport » : présente", () => present('SEND', "n'envoie que le rapport à marc@exemple.fr"));
t('G9', "garde N1 : « n'envoie rien », « envoie-le pas », « pas question d'envoyer » : niés",
  () => { const r = ["n'envoie rien à marc@exemple.fr", 'envoie-le pas à marc@exemple.fr', "pas question d'envoyer à marc@exemple.fr"]
    .map(x => A('SEND', x).raison); return { ok: r.every(x => x === 'NIE'), info: r.join(',') }; });
t('G10', 'garde N2 : verbe seulement entre guillemets : CITE', () => {
  const r = A('SEND', 'il dit « envoie les factures à marc@exemple.fr », tu en penses quoi ?');
  return { ok: !r.presente && r.raison === 'CITE', info: r.raison };
});
t('G11', "garde : une négation dans la proposition SUIVANTE ne nie pas : « envoie-le, il ne faut pas attendre »",
  () => present('SEND', 'envoie-le à marc@exemple.fr, il ne faut pas attendre'));
t('G12', "garde : une négation avant « mais » ne nie pas la suite : « je ne suis pas prête pour la réunion mais envoie le devis »",
  () => present('SEND', 'je ne suis pas prête pour la réunion mais envoie le devis à marc@exemple.fr'));

/* ============================ RÉSULTATS ============================ */
console.log('JARVIS vigilance N3 (' + DIR + ')\n');
for (const x of R) console.log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(5) + x.nom + (x.info !== undefined ? '  [' + x.info + ']' : ''));
const ko = R.filter(x => !x.ok).length;
console.log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
process.exit(ko ? 1 : 0);
