'use strict';
/* ==========================================================================
 * JARVIS — MÉMOIRE GOUVERNÉE 5.30  (garantie G6)
 * --------------------------------------------------------------------------
 * Un assistant qui se souvient devient une cible : un e-mail piege qui lui
 * fait "retenir" que ton comptable est pirate@evil.com empoisonne toutes les
 * sessions suivantes. D'ou ces regles :
 *
 *  G6.1 SEULS TES PROPRES MOTS. Un souvenir n'est cree que par une commande
 *       explicite ("retiens que ...") en tete de TES mots. Jamais depuis un
 *       contenu lu, un texte colle ou cite (separer() de la vigilance),
 *       jamais depuis une phrase du modele : le modele ne peut rien retenir.
 *  G6.2 LE NOYAU ARBITRE L'ECRITURE. Chaque souvenir est une action WRITE sur
 *       MEMOIRE : auditee, compensable (effacable), et refusee dans une
 *       session qui a lu du contenu externe.
 *  G6.3 LA MEMOIRE NOURRIT LA CONVERSATION, JAMAIS LE PLANIFICATEUR. Aucun
 *       souvenir ne peut choisir une action ni fournir une cible : pour agir,
 *       la cible doit toujours etre tapee dans la demande (C3).
 *  G6.4 CHEZ TOI, BORNEE, VISIBLE. Les souvenirs vivent dans ton navigateur,
 *       rien n'est garde sur le serveur. 40 au plus, 200 caracteres chacun,
 *       4000 au total dans un prompt. Tu les vois et tu les effaces.
 * ======================================================================== */
const { separer } = require('./jarvis-vigilance.js');

const MAX_SOUVENIRS = 40, MAX_CARACTERES = 200, MAX_TOTAL = 4000;

/* Commande en tete de message, eventuellement precedee d'une interpellation. */
const COMMANDE = /^(?:(?:jarvis|stp|s il te plait|au fait|ok)[\s,:!]+)*(?:(?:peux tu|pourrais tu|tu peux|merci de|je veux que tu)\s+)?(retiens|retenir|retiennes|souviens toi|rappelle toi|memorise|garde en memoire|note bien|remember)(?=[\s,:!]|$)[\s,:!]*(?:(?:bien|aussi|ceci|ca)[\s,:!]+)*(?:que\s+|qu\s+|that\s+)?/;
const NEGATION = /^(?:pas|rien|jamais|plus)\b/;

/* G6.5 PAS DE SECRETS. Un souvenir accompagne chaque message et part au
 * modele : un mot de passe, un code ou un numero bancaire n'a rien a y faire.
 * Un telephone (10 chiffres) passe ; 12 chiffres ou plus, non. */
const MOTS_SECRETS = /(^|[^a-z0-9])(mots? de passe|mdp|password|passcode|passphrase|code pin|code secret|code wifi|code d acces|digicode|code (?:de la |de l |d |du )?(?:porte|entree|immeuble|alarme|portail|garage|coffre|telephone|portable|carte|cb|banque)|cvv|cvc|cryptogramme|iban|cle api|api key|token)([^a-z0-9]|$)/;
function ressembleSecret(t) {
  if (MOTS_SECRETS.test(plier(t))) return true;
  if (/\bsk-[a-z0-9_-]{8,}/i.test(t)) return true;                        /* cle d'API */
  if (/\b[a-z]{2}\d{2}(?:\s?[a-z0-9]{4}){3,7}\b/i.test(t)) return true;  /* IBAN */
  return /\d{12,}/.test(t.replace(/(\d)[\s.-](?=\d)/g, '$1'));             /* carte, NIR... */
}

/* Minuscules sans accents, MEME LONGUEUR que l'entree (pour recouper). */
const plier = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’'-]/g, ' ');

/* G6.1 : { texte } si les propres mots de la personne commencent par une commande, sinon null. */
function extraireSouvenir(message) {
  const brut = separer(message).propres.normalize('NFC').replace(/\u0000/g, '').trim();
  const plie = plier(brut);
  if (plie.length !== brut.length) return null;                 /* recoupement impossible : ferme */
  const m = COMMANDE.exec(plie);
  if (!m) return null;
  const reste = brut.slice(m[0].length).replace(/\s+/g, ' ').trim();
  if (NEGATION.test(plier(reste))) return null;                  /* "retiens pas ca" */
  const texte = reste.replace(/^[«"“]\s*|\s*[»"”]$/g, '').replace(/\s*\?$/, '').slice(0, MAX_CARACTERES).trim();
  if (texte.length < 3) return null;
  return ressembleSecret(reste) ? { texte, secret: true } : { texte };
}

/* G6.4 : ce que le navigateur envoie est borne et nettoye, quoi qu'il envoie. */
function nettoyerSouvenirs(liste) {
  if (!Array.isArray(liste)) return [];
  const propres = [];
  let total = 0;
  for (const x of liste.slice(-MAX_SOUVENIRS).reverse()) {           /* les plus recents d'abord */
    const brut = typeof x === 'string' ? x : (x && typeof x.texte === 'string' ? x.texte : '');
    const texte = brut.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CARACTERES);
    if (!texte || total + texte.length > MAX_TOTAL) continue;
    const date = x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null;
    propres.push({ texte, date }); total += texte.length;
  }
  return propres.reverse();
}

/* Bloc pour le prompt de REPONSE uniquement (G6.3). */
function blocPourPrompt(souvenirs) {
  if (!souvenirs.length) return 'Aucun souvenir enregistré.';
  return souvenirs.map(s => '- ' + (s.date ? '(' + s.date + ') ' : '') + s.texte).join('\n');
}

module.exports = { extraireSouvenir, nettoyerSouvenirs, blocPourPrompt, ressembleSecret,
  MAX_SOUVENIRS, MAX_CARACTERES, MAX_TOTAL, VERSION: '5.30' };
