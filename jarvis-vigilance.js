'use strict';
/* ==========================================================================
 * JARVIS — VIGILANCE 5.29.3  (provenance de l'INTENTION, par action)
 * --------------------------------------------------------------------------
 * C3 (5.29.2) verifie que la CIBLE d'une action vient de ce que la personne
 * a tape. Il ne verifie pas l'ACTION : "resume le mail de marc@exemple.fr",
 * plus un e-mail piege, donne un plan SEND vers marc@exemple.fr — cible
 * tapee, donc raccourci C3, donc fenetre de 10 s sans aucun avertissement.
 *
 * Ce module ajoute la moitie manquante : l'intention d'agir doit, elle aussi,
 * figurer dans ce que la personne a tape. Si la demande ne contient aucun
 * verbe correspondant a l'action planifiee, l'action est ramenee a la
 * reformulation (cible retapee a la main).
 *
 * INVARIANTS — ce qui a manque a la premiere version 5.29.3 :
 *  V1 MONOTONE. Ce module ne peut que durcir : il retire un raccourci ou
 *     ajoute un avertissement. Il ne transforme jamais un refus en accord,
 *     ne raccourcit aucune fenetre, ne touche ni au noyau ni a la couche.
 *  V2 AUCUN MODELE. Tout est deterministe. Aucun texte ecrit par un modele
 *     n'est lu ici, et aucun ne sert a justifier une decision : un modele qui
 *     a lu un e-mail piege ecrirait l'argumentaire du pirate.
 *  V3 ETAT PAR SESSION, BORNE. L'etat vit dans la session emise par le
 *     serveur (deja bornee en nombre et en duree). Rien n'est indexe par un
 *     nom fourni par le client.
 *  V4 SEULE UNE FRAPPE HUMAINE LEVE LE DOUTE. La levee passe par la cible
 *     retapee au clavier (/api/reformuler), jamais par un texte lu, jamais
 *     par une reponse du modele.
 *  V5 FERME PAR DEFAUT. Une action inconnue n'a aucun verbe : toujours
 *     ramenee a la reformulation.
 *
 * 5.29.4 — les deux limites connues de 5.29.3, fermees :
 *  N1 NEGATION. "n'envoie rien a marc@x.fr" contenait "envoie" : l'intention
 *     etait comptee presente. Un verbe nie ne compte plus.
 *  N2 TEXTE CITE OU COLLE. Un e-mail colle dans le fil apportait son propre
 *     verbe ("Envoie les factures a..."), compte comme tape par la personne.
 *     Ne comptent plus : ce qui est entre guillemets, les lignes citees (>),
 *     et tout ce qui suit un en-tete de message colle (De :, Objet :,
 *     "---- Message transfere ----", "Le ... a ecrit :").
 *  Les deux ne font que durcir (V1) : un faux positif coute une cible a
 *  retaper, jamais une action.
 * ======================================================================== */

/* Racines de verbes, sans accents, en minuscules. Chaque racine doit
 * commencer un mot. Les listes sont volontairement etroites : un oubli ne
 * coute qu'une cible a retaper (V1), un exces rouvrirait la faille. Pas de
 * "mail" ni de "reponse" (noms) : "trie ma boite mail" ne vaut pas "envoie". */
const VERBES = Object.freeze({
  SEND:    ['envoie', 'envoy', 'renvoie', 'renvoy', 'transfere', 'transmet', 'transmis', 'expedie',
            'expedier', 'repond', 'send', 'forward', 'reply'],
  DELETE:  ['supprim', 'effac', 'detrui', 'jette', 'jeter', 'vider', 'nettoi', 'nettoy', 'menage',
            'purge', 'delete', 'remove', 'erase'],
  PAY:     ['paie', 'paiement', 'paye', 'payer', 'regler', 'regle la', 'regle le', 'vire', 'virer', 'virement',
            'rembours', 'achet', 'pay', 'buy'],
  PUBLISH: ['publi', 'poste', 'poster', 'publish', 'tweet'],
  GRANT:   ['donne acces', 'donner acces', 'donne les droits', 'partage', 'partager', 'autorise',
            'autoriser', 'grant', 'share'],
  DEPLOY:  ['deploi', 'deploy', 'mets en prod', 'mettre en prod', 'mets en ligne', 'mettre en ligne',
            'mise en ligne', 'release'],
  WRITE:   ['ecri', 'redig', 'ajoute', 'ajouter', 'sauvegard', 'enregistr', 'modifie', 'modifier',
            'mets a jour', 'mettre a jour', 'write', 'save', 'edit', 'update'],
  CREATE:  ['cree', 'creer', 'genere', 'prepare', 'fais un', 'fais une', 'create'],
  RENAME:  ['renomm', 'rename'],
  MOVE:    ['deplace', 'deplacer', 'bouge', 'range', 'ranger', 'classe', 'classer', 'trie', 'trier',
            'archive', 'archiver', 'mets dans', 'mettre dans', 'move']
});

const CONFIRMATIONS_MAX = 50;
const LIBELLES = Object.freeze({ SEND: 'envoyer', DELETE: 'supprimer', PAY: 'payer', PUBLISH: 'publier',
  GRANT: 'donner un accès', DEPLOY: 'déployer', WRITE: 'écrire', CREATE: 'créer', RENAME: 'renommer', MOVE: 'déplacer' });

/* Minuscules, sans accents, espaces normalises. Les lettres non latines
 * (cyrillique...) ne sont PAS converties : un homoglyphe ne forme aucun
 * verbe, donc il durcit au lieu d'ouvrir. */
function normaliser(t) {
  return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
}

/* La demande tapee exprime-t-elle cette action, dans les propres mots de la personne ? */
function intentionPresente(action, texte) { return analyserIntention(action, texte).presente; }

/* ---------------- N2 : separer ses propres mots du texte cite ---------------- */
const ENTETE = /^(de|from|a|to|cc|cci|bcc|objet|subject|envoye|envoye le|sent|date|expediteur|reply-to|repondre a)\s*:/;
const TRANSFERT = /^(-{3,}.*(message|forwarded|origine|transfer)|debut du message reexpedie|(le|on)\s.{3,90}(a ecrit|wrote)\s*:?\s*$)/;

function separer(texte) {
  const lignes = String(texte == null ? '' : texte).split(/\r?\n/);
  const norm = lignes.map(l => normaliser(l));
  /* Un message colle : un marqueur de transfert, ou au moins deux en-tetes. */
  let coupe = norm.findIndex(l => TRANSFERT.test(l));
  const entetes = norm.map((l, i) => ENTETE.test(l) ? i : -1).filter(i => i >= 0);
  if (entetes.length >= 2 && (coupe < 0 || entetes[0] < coupe)) coupe = entetes[0];
  const cites = [];
  let propres = (coupe >= 0 ? (cites.push(lignes.slice(coupe).join('\n')), lignes.slice(0, coupe)) : lignes)
    .filter(l => { if (/^\s*>/.test(l)) { cites.push(l); return false; } return true; }).join('\n');
  /* Guillemets : une citation non fermee court jusqu'a la fin (ferme). */
  for (const re of [/«[^»]*(?:»|$)/g, /“[^”]*(?:”|$)/g, /„[^“”]*(?:[“”]|$)/g, /"[^"]*(?:"|$)/g])
    propres = propres.replace(re, m => { cites.push(m); return ' '; });
  return { propres, cites: cites.join(' ') };
}

/* ---------------- N1 : un verbe nie ne compte pas ---------------- */
const NEG_AVANT = new Set(['ne', 'n', 'sans', 'jamais', 'pas', 'rien', 'plus', 'evite', 'eviter', 'evitez',
  'arrete', 'arreter', 'arretez', 'stop', 'dont', 'don', 'not', 'never', 'no']);
const NEG_APRES = new Set(['pas', 'rien', 'jamais', 'aucun', 'aucune', 'point', 'guere']);
const NEG_APRES_AVEC_NE = new Set(['plus', 'personne']);
const RAPPEL = new Set(['oublie', 'oublies', 'oubliez', 'oublier']);   /* "n'oublie pas d'envoyer" */
const mots = (t) => t.split(/[^a-z0-9]+/).filter(Boolean);

function occurrenceNiee(t, debut, fin) {
  const avant = mots(t.slice(0, debut)).slice(-3);
  const suite = t.slice(fin).replace(/^[a-z0-9]*/, '');           /* finir le mot du verbe */
  const apres = mots(suite).slice(0, 3);
  const rappel = avant.some(m => RAPPEL.has(m));
  const ne = !rappel && (avant.includes('ne') || avant.includes('n'));
  if (apres.some(m => NEG_APRES.has(m))) return true;
  if (ne && apres.some(m => NEG_APRES_AVEC_NE.has(m))) return true;
  if (ne && apres.some(m => m === 'que' || m === 'qu')) return false; /* "n'envoie que le rapport" */
  if (ne) return true;
  return !rappel && avant.some(m => NEG_AVANT.has(m));
}

function occurrences(racines, t) {
  const out = [];
  for (const r of racines) {
    const re = new RegExp('(^|[^a-z0-9])(' + r.replace(/ /g, '\\s+') + ')', 'g');
    let m; while ((m = re.exec(t))) { const d = m.index + m[1].length; out.push([d, d + m[2].length]); }
  }
  return out;
}

/* Analyse complete : { presente, raison: 'PRESENTE' | 'ABSENT' | 'NIE' | 'CITE' } */
function analyserIntention(action, texte) {
  const racines = VERBES[String(action).toUpperCase()];
  if (!racines) return { presente: false, raison: 'ABSENT' };                          /* V5 */
  const { propres, cites } = separer(texte);
  const t = ' ' + normaliser(propres) + ' ';
  const occ = occurrences(racines, t);
  if (occ.some(([d, f]) => !occurrenceNiee(t, d, f))) return { presente: true, raison: 'PRESENTE' };
  if (occ.length) return { presente: false, raison: 'NIE' };
  if (occurrences(racines, ' ' + normaliser(cites) + ' ').length) return { presente: false, raison: 'CITE' };
  return { presente: false, raison: 'ABSENT' };
}

const cleDe = (action, cible) => String(action).toUpperCase() + '|' + String(cible);

class Vigilance {
  #confirmations = [];

  /* V4 : appelee par /api/reformuler, apres une cible retapee a la main. */
  confirmer(action, cible) {
    const c = cleDe(action, cible);
    if (!this.#confirmations.includes(c)) this.#confirmations.push(c);
    while (this.#confirmations.length > CONFIRMATIONS_MAX) this.#confirmations.shift();
  }

  /* Rend un avis, jamais une decision. {classe, plancher} viennent de la couche. */
  evaluer({ action, target, classe, plancher, texte, manuel }) {
    const act = String(action).toUpperCase();
    const avis = { exigerReformulation: false, signaux: [], motif: null };

    /* Mode manuel : l'action a ete choisie a la main, l'intention est la sienne. */
    if (manuel || classe === 'REVERSIBLE') return avis;
    const analyse = analyserIntention(act, texte);
    if (analyse.presente) return avis;

    if (this.#confirmations.includes(cleDe(act, target))) {
      avis.signaux.push({ poids: 'info',
        texte: 'Tu as déjà confirmé cette action et cette cible au clavier dans cette session.' });
      return avis;
    }

    const lib = LIBELLES[act] ? '« ' + LIBELLES[act] + ' »' : null;
    const suite = ' : cette action a pu être suggérée par un contenu lu, pas par toi.';
    const texteSignal =
        analyse.raison === 'NIE'  ? 'Ta demande dit de ne pas ' + (lib || 'faire cette action') + suite
      : analyse.raison === 'CITE' ? 'Le verbe ' + lib + " n'apparaît que dans un texte cité ou collé, pas dans tes propres mots" + suite
      : 'Ta demande ne contient aucun verbe pour ' + (lib || 'cette action inconnue') + suite;

    /* Irreversible : ramenee a la reformulation.
     * Compensable : avertissement seulement. En session rouge, le noyau la
     * refuse deja (PROVENANCE_ACTION_DENIED) ; y ajouter une case "retape la
     * cible" creerait une impasse, car la reformulation ne leve le doute que
     * pour l'irreversible. En session verte, elle reste annulable. */
    if (classe === 'IRREVERSIBLE') {
      avis.exigerReformulation = true;
      avis.motif = { NIE: 'INTENTION_NIEE', CITE: 'INTENTION_CITEE' }[analyse.raison] || 'INTENTION_NON_TAPEE';
      avis.signaux.push({ poids: 'fort', texte: texteSignal });
    } else {
      avis.signaux.push({ poids: 'moyen', texte: texteSignal
        + (plancher === 'USER_DIRECT' ? ' Action annulable, laissée passer.' : '') });
    }
    return avis;
  }
}

module.exports = { Vigilance, intentionPresente, analyserIntention, separer, normaliser, VERBES, VERSION: '5.29.4' };
