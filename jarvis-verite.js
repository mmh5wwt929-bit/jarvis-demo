'use strict';
/* ============================================================================
 * JARVIS — verite 1.0 : ce que le SERVEUR sait, le modele ne l'invente pas
 * ----------------------------------------------------------------------------
 * Vu en ligne le 26 sept (v4.6.6), un seul defaut sous plusieurs formes : le
 * modele AFFIRME des faits sur le systeme ou sur le calendrier que le serveur
 * n'a pas verifies.
 *  - « Supprimer » tape -> « C'est fait » : rien n'a ete supprime.        [A]
 *  - « Et dimanche ? » -> lecture du 28, annonce « dimanche 28 » (lundi).   [C]
 *  - « Ajoute hand mercredi » (samedi 26) -> carte du 7 octobre.           [C]
 *  - « je peux seulement lire », puis « un seul evenement a la fois ».     [E]
 *  - « Quel jour sommes-nous ? » -> « 23 septembre » (date d'un souvenir). [F]
 *  - « Ajoute hand mercredi » (sans heure) -> 18:00 -> 19:30 inventes.     [G]
 * Ce module ne fait AUCUN appel reseau et ne decide d'aucune action : il
 * calcule (dates, jours de la semaine, heures tapees) et il verifie
 * (affirmations d'action) de facon deterministe. Le serveur s'en sert AVANT
 * le modele (dates et heures resolues, questions de date sans modele) et APRES
 * lui (jours corriges, affirmations sans effet retirees de la reponse).
 *
 * Regles de calendrier (Europe/Paris par defaut) :
 *  - un jour nomme seul (« mercredi ») = le PROCHAIN, strictement apres
 *    aujourd'hui ; tape un mercredi, c'est celui de la semaine suivante
 *    (signale) ; aujourd'hui s'ecrit « aujourd'hui » ;
 *  - « demain » tape entre 0 h et 5 h = le jour civil suivant, et la date est
 *    affichee en evidence (la personne corrige avec « aujourd'hui ») ;
 *  - un jour ET un numero qui se contredisent (« dimanche 28 » un lundi) :
 *    on demande, on ne choisit pas.
 *
 * Jours : nombre de jours depuis 1970-01-01 (UTC), comme jarvis-agenda.js.
 * ========================================================================== */
const { separer, normaliser } = require('./jarvis-vigilance.js');
const AG = require('./jarvis-agenda.js');

const VERSION = '1.0';
const JOUR_MS = 86400000;
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS_AFF = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS = Object.freeze({ janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12 });
const RE_MOIS = 'janvier|janv|fevrier|fevr|fev|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec';
const RE_JOURS = 'lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche';

/* ------------------------------------------------------------ calendrier -- */
const jourDe = (y, mo, d) => Math.floor(Date.UTC(y, mo - 1, d) / JOUR_MS);
const civil = (j) => { const t = new Date(j * JOUR_MS); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const jourSemaine = (j) => new Date(j * JOUR_MS).getUTCDay();
const deux = (n) => String(n).padStart(2, '0');
const iso = (j) => { const c = civil(j); return c.y + '-' + deux(c.mo) + '-' + deux(c.d); };
function valide(y, mo, d) {
  if (!(y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const j = jourDe(y, mo, d), c = civil(j);
  return c.y === y && c.mo === mo && c.d === d ? j : null;
}
const formats = new Map();
function local(ms, zone) {
  let f = formats.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); formats.set(zone, f); }
  const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const l = { y: +p.year, mo: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute };
  l.jour = jourDe(l.y, l.mo, l.d);
  return l;
}
/* « lundi 28 septembre 2026 » : le jour de la semaine est CALCULE, jamais dit par le modele */
function libelle(j, annee = true) {
  const c = civil(j);
  return JOURS[jourSemaine(j)] + ' ' + (c.d === 1 ? '1er' : c.d) + ' ' + MOIS_AFF[c.mo - 1] + (annee ? ' ' + c.y : '');
}
/* « AAAA-MM-JJ..AAAA-MM-JJ » (fin incluse) -> texte ; null si illisible */
function libellePeriode(cle) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\.\.(\d{4})-(\d{2})-(\d{2}))?$/.exec(String(cle || ''));
  if (!m) return null;
  const a = valide(+m[1], +m[2], +m[3]), b = m[4] ? valide(+m[4], +m[5], +m[6]) : a;
  if (a == null || b == null || b < a) return null;
  if (a === b) return libelle(a);
  return 'du ' + libelle(a, civil(a).y !== civil(b).y) + ' au ' + libelle(b);
}
const heureTexte = (l) => deux(l.h) + ':' + deux(l.mi);
const nomZone = (zone) => zone === 'Europe/Paris' ? 'heure de Paris' : 'fuseau ' + zone;
/* l'annee la plus proche d'aujourd'hui pour un jour et un mois sans annee */
function plusProcheAnnee(auj, mo, d) {
  const y = civil(auj).y; let best = null;
  for (const yy of [y - 1, y, y + 1]) { const j = valide(yy, mo, d); if (j != null && (best == null || Math.abs(j - auj) < Math.abs(best - auj))) best = j; }
  return best;
}
/* le mois le plus proche pour un numero de jour seul (« le 28 ») ; a egalite, l'avenir */
function plusProcheMois(auj, d) {
  const c = civil(auj); let best = null;
  for (const k of [-1, 0, 1]) {
    const mo0 = c.mo - 1 + k, y = c.y + Math.floor(mo0 / 12), mo = ((mo0 % 12) + 12) % 12 + 1;
    const j = valide(y, mo, d);
    if (j != null && (best == null || Math.abs(j - auj) < Math.abs(best - auj) || (Math.abs(j - auj) === Math.abs(best - auj) && j > best))) best = j;
  }
  return best;
}

/* ------------------------------------------------ texte de la personne -- */
/* minuscules, sans accents ; tirets entre lettres -> espace (« apres-demain ») */
const norm = (t) => normaliser(t).replace(/([a-z])-(?=[a-z])/g, '$1 ');
/* mots seuls, sans ponctuation : pour les listes de vocabulaire */
const mots = (texte) => ' ' + norm(separer(texte).propres).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
/* suite admise apres « dimanche 28 » sans mois : sinon « mardi 2 seances » serait une date */
const SUITE_DATE = /^(\s*($|[,.;:!?)\]]|-|–|→)|\s+(a|au|et|de|du|des|entre|matin|soir|midi|apres|pour|vers|toute)\b|\s+\d{1,2}\s*[h:])/;
const SUITE_DATE_AFF = /^(\s*($|[,.;:!?)\]]|-|–|→)|\s+(à|a|au|et|de|du|des|entre|matin|soir|midi|après|apres|pour|vers|toute)(?![\p{L}\d])|\s+\d{1,2}\s*[h:])/iu;

/* Les dates que la personne a ecrites, resolues en jours exacts (Europe/Paris
 * par defaut). Seulement ses propres mots (hors texte cite ou colle).
 * { dates:[{expr,jour,iso,libelle,ambigu}], plages:[...], contradictions:[{expr,jour,dit,vrai}], nuit, heure }
 * ambigu = jour nomme seul, tape ce jour-la : pris pour la semaine suivante. */
function resoudreDates(texte, maintenantMs, zone = 'Europe/Paris') {
  const l = local(maintenantMs, zone), auj = l.jour, ws = jourSemaine(auj);
  let t = ' ' + norm(separer(texte).propres) + ' ';
  const dates = [], plages = [], contradictions = [];
  let nuit = false;
  const masquer = (m) => { t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length); };
  const ajouter = (expr, j, ambigu) => { if (j != null && !dates.some(x => x.jour === j && x.expr === expr)) dates.push({ expr, jour: j, iso: iso(j), libelle: libelle(j), ambigu: !!ambigu }); };
  const passe = (re, f) => { let m; re.lastIndex = 0; const tout = []; while ((m = re.exec(t))) tout.push(m); for (const x of tout) { f(x); masquer(x); } };

  passe(/(?<=[^a-z0-9])(\d{4})-(\d{2})-(\d{2})(?=[^0-9])/g, (m) => ajouter(m[0], valide(+m[1], +m[2], +m[3])));
  passe(/(?<=[^a-z])(aujourd hui|aujourdhui|ce jour)(?=[^a-z])/g, () => ajouter("aujourd'hui", auj));
  passe(/(?<=[^a-z])apres demain(?=[^a-z])/g, () => ajouter('après-demain', auj + 2));
  passe(/(?<=[^a-z])avant hier(?=[^a-z])/g, () => ajouter('avant-hier', auj - 2));
  passe(/(?<=[^a-z])demain(?=[^a-z])/g, () => { ajouter('demain', auj + 1); if (l.h < 5) nuit = true; });
  passe(/(?<=[^a-z])hier(?=[^a-z])/g, () => ajouter('hier', auj - 1));
  passe(/(?<=[^a-z])(ce )?(week end|weekend)(?=[^a-z])/g, () => {
    const a = ws === 6 ? auj : ws === 0 ? auj - 1 : auj + (6 - ws);
    plages.push({ expr: 'ce week-end', debut: Math.max(a, auj), fin: a + 1, libelle: libellePeriode(iso(Math.max(a, auj)) + '..' + iso(a + 1)) });
  });
  /* jour de la semaine, avec ou sans numero, mois, annee ; « prochain », « dernier », « en huit » */
  const reJour = new RegExp('(?<=[^a-z])(' + RE_JOURS + ')(?:\\s+(1er|\\d{1,2})(?:\\s+(' + RE_MOIS + ')\\.?(?:\\s+(\\d{4}))?)?)?(?:\\s+(prochain|prochaine|dernier|derniere|en huit|suivant))?(?=[^a-z0-9])', 'g');
  passe(reJour, (m) => {
    const w = JOURS.indexOf(m[1]);
    if (m[2]) {
      const d = m[2] === '1er' ? 1 : +m[2];
      const suite = t.slice(m.index + m[0].length);
      if (m[3] || SUITE_DATE.test(suite)) {
        const j = m[3] ? (m[4] ? valide(+m[4], MOIS[m[3]], d) : plusProcheAnnee(auj, MOIS[m[3]], d)) : plusProcheMois(auj, d);
        if (j == null) return;
        if (jourSemaine(j) !== w) contradictions.push({ expr: m[0].trim(), jour: j, dit: m[1], vrai: JOURS[jourSemaine(j)] });
        else ajouter(m[0].trim(), j);
        return;
      }
    }
    const mod = m[5] || '';
    const ecart = (w - ws + 7) % 7;
    let delta = ecart || 7;                               /* [C] le PROCHAIN, jamais aujourd'hui */
    if (mod === 'en huit') delta = (ecart || 7) + 7;
    else if (/^dernier/.test(mod)) delta = -(((ws - w + 7) % 7) || 7);
    ajouter(m[1] + (mod ? ' ' + mod : ''), auj + delta, !mod && ecart === 0);
  });
  passe(new RegExp('(?<=[^a-z0-9])(1er|\\d{1,2})\\s+(' + RE_MOIS + ')\\.?(?:\\s+(\\d{4}))?(?=[^a-z0-9])', 'g'), (m) => {
    const d = m[1] === '1er' ? 1 : +m[1];
    ajouter(m[0].trim(), m[3] ? valide(+m[3], MOIS[m[2]], d) : plusProcheAnnee(auj, MOIS[m[2]], d));
  });
  passe(/(?<=[^0-9\/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?=[^0-9\/])/g, (m) => {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    ajouter(m[0].trim(), y ? valide(y, +m[2], +m[1]) : plusProcheAnnee(auj, +m[2], +m[1]));
  });
  passe(/(?<=[^a-z])le (1er|\d{1,2})(?![0-9a-z])(?!\s*(h(?![a-z])|h\d|:|heures?(?![a-z])|min|euros?(?![a-z])|€|%|\/|fois|jours|semaines|mois|ans|personnes))/g, (m) => ajouter(m[0].trim(), plusProcheMois(auj, m[1] === '1er' ? 1 : +m[1])));
  return { dates, plages, contradictions, nuit, heure: heureTexte(l), aujourdhui: auj };
}
/* Une seule date, sans plage ni contradiction : celle que la personne a dite. */
function dateUnique(r) {
  if (!r || r.contradictions.length || r.plages.length) return null;
  const jours = [...new Set(r.dates.map(d => d.jour))];
  return jours.length === 1 ? r.dates.find(d => d.jour === jours[0]) : null;
}
/* Reference remise au planificateur et au modele : des dates calculees par le
 * serveur, jamais un contenu lu (les expressions sont des mots de liste fixe
 * ou des chiffres). */
function tableDates(r, maintenantMs, zone = 'Europe/Paris') {
  const l = local(maintenantMs, zone);
  const lignes = ["aujourd'hui = " + libelle(l.jour) + ' (' + iso(l.jour) + '), il est ' + heureTexte(l)];
  if (r) {
    for (const d of r.dates.slice(0, 6)) lignes.push('« ' + d.expr.replace(/[^a-z0-9 '\-\/àéèêëîïôöûüç]/gi, '').slice(0, 30) + ' » = ' + d.libelle + ' (' + d.iso + ')');
    for (const p of r.plages.slice(0, 2)) lignes.push('« ' + p.expr + ' » = ' + p.libelle + ' (' + iso(p.debut) + '..' + iso(p.fin) + ')');
  }
  return lignes.join(' ; ');
}
/* « Il est 1h12 : "demain" = ... » : entre 0h et 5h, demain est ambigu. */
function avertissementNuit(r) {
  if (!r || !r.nuit) return null;
  const d = r.dates.find(x => x.expr === 'demain'); if (!d) return null;
  return 'Il est ' + r.heure + ' : « demain » veut dire ici ' + d.libelle + ". Si tu pensais à aujourd'hui (" + libelle(d.jour - 1, false) + "), redemande avec « aujourd'hui ».";
}
function questionContradiction(r) {
  const c = r && r.contradictions[0]; if (!c) return null;
  const cc = civil(c.jour);
  return 'Le ' + (cc.d === 1 ? '1er' : cc.d) + ' ' + MOIS_AFF[cc.mo - 1] + ' ' + cc.y + ' est un ' + c.vrai + ', pas un ' + c.dit + '. '
    + 'Tu parles de quel jour ? Redemande avec la date ou le jour seul, par exemple « ' + c.vrai + ' ' + (cc.d === 1 ? '1er' : cc.d) + ' » ou « ' + c.dit + ' ».';
}

/* ------------------------------------ questions de date : sans le modele -- */
const RE_Q_JOUR = /(^| )(quel jour (sommes nous|est on|on est|nous sommes|est il|est ce|c est|aujourd hui)|on est quel jour|c est quel jour|nous sommes quel jour|quelle (est la )?date|quelle date|on est le combien|nous sommes le combien|la date d aujourd hui|la date du jour|quel jour)( |$)/;
const RE_Q_HEURE = /(^| )(quelle heure|il est quelle heure|l heure qu il est|l heure)( |$)/;
const RE_Q_TOMBE = /(^| )(quel jour|tombe|c est un|est un|quel jour de la semaine)( |$)/;
/* On ne repond sans modele QUE si la phrase entiere est une question de date :
 * chaque mot doit appartenir a ce vocabulaire (sinon « a quelle heure est mon
 * rendez-vous ? » partirait avec l'heure qu'il est). */
const VOCAB = new Set(('quel quelle quels jour date heure est on sommes nous c il ce la le l aujourd hui aujourdhui maintenant '
  + 'combien qu actuellement exactement en moment stp svp s te plait jarvis dis moi donc alors et ok bonjour salut merci au fait '
  + 'on y a-t-il t de').split(' '));
const VOCAB_TOMBE = new Set(('tombe sera etait un une semaine demain apres avant hier prochain prochaine dernier derniere '
  + '1er ' + RE_MOIS.split('|').join(' ') + ' ' + RE_JOURS.split('|').join(' ')).split(' '));
/* reponse exacte, ou null (la question part alors au modele, avec la date) */
function questionDate(texte, maintenantMs, zone = 'Europe/Paris') {
  const t = norm(texte).replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const liste = t ? t.split(' ') : [];
  if (!liste.length || liste.length > 12) return null;
  const l = local(maintenantMs, zone);
  const r = resoudreDates(texte, maintenantMs, zone), u = dateUnique(r);
  if (r.contradictions.length) return null;
  const tombe = liste.every(m => VOCAB.has(m) || VOCAB_TOMBE.has(m) || /^\d{1,4}$/.test(m)) && RE_Q_TOMBE.test(' ' + t + ' ');
  if (tombe && u && u.jour !== l.jour) {
    const c = civil(u.jour);
    const relatif = /^(demain|apres|avant|hier)/.test(norm(u.expr));
    return relatif ? u.expr.charAt(0).toUpperCase() + u.expr.slice(1) + ", c'est le " + libelle(u.jour) + '.'
      : 'Le ' + (c.d === 1 ? '1er' : c.d) + ' ' + MOIS_AFF[c.mo - 1] + ' ' + c.y + ' est un ' + JOURS[jourSemaine(u.jour)] + '.';
  }
  if (!liste.every(m => VOCAB.has(m))) return null;
  const jour = RE_Q_JOUR.test(t), heure = RE_Q_HEURE.test(t);
  if (jour && heure) return 'Nous sommes le ' + libelle(l.jour) + ', il est ' + heureTexte(l) + ' (' + nomZone(zone) + ').';
  if (jour) return 'Nous sommes le ' + libelle(l.jour) + '.';
  if (heure) return 'Il est ' + heureTexte(l) + ' (' + nomZone(zone) + '), le ' + libelle(l.jour) + '.';
  return null;
}

/* -------------------------------------- jours de la semaine du modele -- */
/* « dimanche 28 septembre » quand le 28 est un lundi : le jour est corrige
 * dans la reponse, et la correction est dite. Rien d'autre n'est touche. */
const RE_JOUR_AFF = /(?<![\p{L}\d])(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lun\.|mar\.|mer\.|jeu\.|ven\.|sam\.|dim\.)(\s+|\s*,\s*)(1er|\d{1,2})(?:\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre|janv\.|f[ée]vr\.|avr\.|juil\.|sept\.|oct\.|nov\.|d[ée]c\.)(?:\s+(\d{4}))?)?(?![\p{L}\d])/giu;
function corrigerJours(texte, maintenantMs, zone = 'Europe/Paris') {
  const auj = local(maintenantMs, zone).jour, corrections = [];
  const s = String(texte == null ? '' : texte);
  const sortie = s.replace(RE_JOUR_AFF, (tout, jour, sep, num, mois, an, pos) => {
    const d = num.toLowerCase() === '1er' ? 1 : +num;
    if (!mois && !SUITE_DATE_AFF.test(s.slice(pos + tout.length))) return tout;
    const cleMois = mois ? normaliser(mois).replace(/\.$/, '') : null;
    if (cleMois && !MOIS[cleMois]) return tout;
    const j = cleMois ? (an ? valide(+an, MOIS[cleMois], d) : plusProcheAnnee(auj, MOIS[cleMois], d)) : plusProcheMois(auj, d);
    if (j == null) return tout;
    const court = jour.endsWith('.');
    const dit = court ? JOURS_COURTS.indexOf(jour.toLowerCase()) : JOURS.indexOf(jour.toLowerCase());
    const vrai = jourSemaine(j);
    if (dit === vrai) return tout;
    let nouveau = court ? JOURS_COURTS[vrai] : JOURS[vrai];
    if (jour[0] !== jour[0].toLowerCase()) nouveau = nouveau[0].toUpperCase() + nouveau.slice(1);
    corrections.push({ dit: jour, vrai: JOURS[vrai], iso: iso(j), libelle: libelle(j) });
    return nouveau + tout.slice(jour.length);
  });
  return { texte: sortie, corrections };
}

/* --------------------------------- affirmations d'action sans effet -- */
/* Une phrase du modele qui ANNONCE une action (fait, cree, supprime, envoye)
 * alors que le serveur n'a rien execute pendant ce message est RETIREE de la
 * reponse ; la page dit ce qui a ete retire. Etroit par construction : une
 * phrase niee, une question, un futur ou un conditionnel ne sont jamais vises ;
 * « j'ai ajoute des exemples » (du texte) non plus, faute d'objet reel. */
const V_ACTION = '(supprim|effac|annul|envoy|cree|creee|ajout|programm|enregistr|modifi|deplac|pay|regl|transfer|retir|reserv|planifi|inscri|rajout|bloqu)';
const OBJET_REEL = /(^| )(agenda|calendrier|evenement|evenements|rendez vous|rdv|rappel|rappels|mail|mails|e mail|email|courriel|facture|factures|paiement|virement|fichier|fichiers|reunion|entrainement|creneau|google|souvenir|memoire|test)( |$)/;
const AFFIRMATIONS = [
  { re: /(^| )c est (bien |desormais |maintenant )?(fait|supprime|annule|envoye|cree|ajoute|programme|enregistre|note|planifie|reserve|regle|paye|transfere|retire|inscrit|efface|bloque)e?s?( |$)/, objet: false },
  { re: new RegExp('(^| )je (l|les|la|te|lui|leur|vous) ai (bien |deja |aussi )?' + V_ACTION), objet: false },
  { re: new RegExp('(^| )(j ai|nous avons|je viens d|je viens de|on a) (bien |deja |aussi )?' + V_ACTION), objet: true },
  { re: new RegExp('(^| )(a|ont) (bien |deja )?ete ' + V_ACTION), objet: true, passif: true },
  { re: /^(voila )?(fait|supprime|annule|envoye|cree|ajoute|c est fait)$/, objet: false }
];
const NEGATION = new Set(['n', 'ne', 'rien', 'pas', 'jamais', 'aucun', 'aucune', 'personne']);
/* strict (defaut) : la personne a demande une action ; sinon, seules les
 * phrases qui nomment un objet reel sont visees (« voila, c'est fait : » sous
 * un texte reformule n'annonce aucune action). */
function affirme(phrase, passif, strict = true) {
  const brut = String(phrase).trim();
  if (!brut || /\?\s*$/.test(brut)) return false;
  const p = norm(brut).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const a of AFFIRMATIONS) {
    if (a.passif && !passif) continue;
    const m = a.re.exec(p);
    if (!m) continue;
    const avant = p.slice(0, m.index + (m[1] ? m[1].length : 0)).split(' ').filter(Boolean).slice(-3);
    if (avant.some(x => NEGATION.has(x))) continue;
    if ((a.objet || !strict) && !OBJET_REEL.test(' ' + p + ' ') && !(a.passif && /(^| )(il|elle|ils|elles) (a|ont) /.test(p))) continue;
    return true;
  }
  return false;
}
function retirerAffirmations(texte, { passif = true, strict = true } = {}) {
  const s = String(texte == null ? '' : texte);
  const retirees = [];
  const lignes = s.split('\n').map((ligne) => {
    const morceaux = ligne.match(/[^.!?…]+[.!?…]*\s*|[.!?…]+\s*/g) || [ligne];
    return morceaux.filter((m) => { if (affirme(m, passif, strict)) { retirees.push(m.trim()); return false; } return true; }).join('').replace(/\s+$/, '');
  });
  const propre = lignes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texte: retirees.length ? propre : s, retirees };
}

/* ---------------------------------------- intention de supprimer/annuler -- */
const RE_SUPPR = /(^| )(supprim|effac|annul|retir|enlev|delete|remove|cancel)[a-z]*/g;
function intentionSuppression(texte) {
  const p = mots(texte);
  let m, oui = false, annul = false;
  RE_SUPPR.lastIndex = 0;
  while ((m = RE_SUPPR.exec(p))) {
    const avant = p.slice(0, m.index + m[1].length).trim().split(' ').slice(-3);
    const apres = p.slice(m.index + m[0].length).trim().split(' ').slice(0, 2);
    if (avant.some(x => NEGATION.has(x) || x === 'sans') || apres.some(x => x === 'pas' || x === 'rien' || x === 'jamais')) continue;
    oui = true; if (/^(annul|cancel)/.test(m[2])) annul = true;
  }
  const liste = p.trim() ? p.trim().split(' ') : [];
  return { presente: oui, annulation: annul, mots: liste, court: liste.length <= 5,
    agenda: /(^| )(evenement|evenements|rendez vous|rdv|agenda|calendrier|creneau|entrainement|reunion)( |$)/.test(p) };
}
/* [A] Vrai quand le message n'est QU'une demande de suppression, sans autre
 * objet (« Supprimer », « supprime-le », « annule ça stp ») : c'est alors
 * l'evenement que JARVIS vient de creer qui est vise, pas un fichier. */
const MOTS_VIDES = new Set(('le la les l ca cela ce cet cette celui celle ci tout tous stp svp s il te plait jarvis oui '
  + 'moi merci alors donc bien vas y en maintenant dernier derniere derniers precedent precedente juste ok vite').split(' '));
function suppressionNue(texte) {
  const i = intentionSuppression(texte);
  if (!i.presente) return false;
  return i.mots.filter(x => !/^(supprim|effac|annul|retir|enlev|delete|remove|cancel)/.test(x) && !MOTS_VIDES.has(x)).length === 0;
}
/* [A] le titre d'un evenement cree est-il nomme dans la demande ? (« supprime le hand ») */
function titreNomme(texte, titre) {
  const p = mots(texte), q = mots(titre).trim();
  return q.length >= 2 && p.includes(' ' + q + ' ');
}

/* ------------------------------------------- heures tapees : [G] -- */
/* L'heure d'un evenement ne vient QUE des mots tapes. Vu en ligne le 26 sept :
 * « Ajoute hand mercredi » (sans heure) -> carte 18:00 -> 19:30 inventee.
 * Rendu : { debut:{h,mi}|null, fin:{h,mi}|null, duree:minutes|null, ambigu, heures }.
 * Ambigu = plusieurs heures de debut ou plusieurs durees : on demande, on ne
 * choisit pas. « apres-midi », « ce soir » ne sont pas des heures. */
const RE_HEURE = '(?:(\\d{1,2})\\s*(?:h|heures?)(?:\\s*(\\d{2}))?(?![a-z0-9])|(\\d{1,2}):(\\d{2})(?![0-9])|((?<!apres )midi|minuit)(?:\\s+et\\s+(demi|quart))?)';
function heureDe(m, i, suite) {
  let h, mi;
  if (m[i] !== undefined) { h = +m[i]; mi = m[i + 1] !== undefined ? +m[i + 1] : 0; }
  else if (m[i + 2] !== undefined) { h = +m[i + 2]; mi = +m[i + 3]; }
  else if (m[i + 4] !== undefined) { h = m[i + 4] === 'midi' ? 12 : 0; mi = m[i + 5] === 'demi' ? 30 : m[i + 5] === 'quart' ? 15 : 0; }
  else return null;
  if (/^\s*(du soir|de l apres midi|de l aprem)/.test(suite || '') && h >= 1 && h < 12) h += 12;
  return h <= 23 && mi <= 59 ? { h, mi } : null;
}
const RE_DUREE = /(?<![a-z0-9])(pendant|durant|duree|d une duree de)\s+(?:(une demi heure)|(une heure|1 heure)(\s+et demie)?|(\d{1,2})\s*(?:h|heures?)\s*(\d{2}|et demie)?(?![a-z0-9])|(\d{1,3})\s*(?:min|minutes?|mn)(?![a-z]))/g;
function resoudreHeures(texte) {
  let t = ' ' + norm(separer(texte).propres).replace(/[^a-z0-9:\- ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  const masquer = (m) => { t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length); };
  const tous = (re) => { const r = []; let m; re.lastIndex = 0; while ((m = re.exec(t))) r.push(m); return r; };
  const durees = [];
  for (const x of tous(RE_DUREE)) {
    let d = null;
    if (x[2]) d = 30; else if (x[3]) d = x[4] ? 90 : 60;
    else if (x[5] !== undefined) d = +x[5] * 60 + (x[6] === 'et demie' ? 30 : x[6] ? +x[6] : 0);
    else if (x[7] !== undefined) d = +x[7];
    if (d) durees.push(d);
    masquer(x);
  }
  /* « 45 minutes » seul : une duree, jamais une heure */
  for (const x of tous(/(?<![a-z0-9])(\d{1,3})\s*(?:min|minutes?|mn)(?![a-z])/g)) { durees.push(+x[1]); masquer(x); }
  /* plage : « de 18h a 19h30 », « 18h-19h30 », « entre 18h et 19h » */
  let fin = null; const debuts = [];
  for (const x of tous(new RegExp('(?<![a-z0-9])(?:de |entre )?' + RE_HEURE + '\\s*(?:a|-|et|jusqu a)\\s*' + RE_HEURE, 'g'))) {
    const a = heureDe(x, 1, ''), b = heureDe(x, 7, t.slice(x.index + x[0].length));
    if (a && b) { debuts.push(a); fin = b; }
    masquer(x);
  }
  for (const x of tous(new RegExp('(?<![a-z0-9])jusqu a\\s*' + RE_HEURE, 'g'))) { const b = heureDe(x, 1, t.slice(x.index + x[0].length)); if (b) fin = b; masquer(x); }
  for (const x of tous(new RegExp('(?<![a-z0-9])' + RE_HEURE, 'g'))) { const a = heureDe(x, 1, t.slice(x.index + x[0].length)); if (a) debuts.push(a); }
  const uniques = [...new Map(debuts.map(d => [d.h * 60 + d.mi, d])).values()];
  const dureesU = [...new Set(durees)];
  const debut = uniques.length === 1 ? uniques[0] : null;
  let duree = null;
  if (debut && fin) { duree = (fin.h * 60 + fin.mi) - (debut.h * 60 + debut.mi); if (duree <= 0) duree += 1440; }
  else if (dureesU.length === 1) duree = dureesU[0];
  const ambigu = uniques.length > 1 || dureesU.length > 1 || !!(fin && dureesU.length > 0 && dureesU[0] !== duree);
  return { debut, fin, duree, ambigu, heures: uniques };
}

/* ----------------------------- creations et series demandees : [E] [G] -- */
/* « ajoute ... tous les mercredis » : la reponse est celle du SERVEUR, la
 * meme a chaque fois (vu le 26 sept : « je peux seulement lire », puis « un
 * seul evenement a la fois », pour deux demandes semblables). */
const RE_CREER = /(^| )(ajout|rajout|cree |creer|creez|mets |met |note |noter|notez|programm|planifi|inscri|bloqu|enregistr|cale |caler)/;
const RE_SERIE = new RegExp('(^| )((tous|toutes) les (' + RE_JOURS + ')s?|(tous|toutes) les (jours|semaines|matins|soirs|deux semaines|15 jours|quinze jours)'
  + '|chaque (' + RE_JOURS + '|jour|semaine|matin|soir)|hebdomadaire|hebdo|quotidien|quotidienne|(' + RE_JOURS + ')s)( |$)');
const creationDemandee = (texte) => RE_CREER.test(mots(texte));
const demandeSerie = (texte) => { const p = mots(texte); return RE_CREER.test(p) && RE_SERIE.test(p); };
const RE_AGENDA = /(^| )(agenda|calendrier|evenement|rendez vous|rdv|creneau)( |$)/;
/* la personne demande-t-elle une action (creer, supprimer, envoyer, payer) ? */
const demandeAction = (texte) => intentionSuppression(texte).presente || RE_CREER.test(mots(texte))
  || /(^| )(envoi|envoy|paie|paye|payer|regle|regler|transfer|vire|virement|reserve|reserver)/.test(mots(texte));
/* une reponse qui refuse ou renonce (« 18h c'est trop tard, laisse tomber ») */
const renonce = (texte) => /(^| )(non|pas|laisse|laisser|oublie|oublier|rien|stop|tant pis)( |$)/.test(mots(texte));
const parleAgenda = (texte) => RE_AGENDA.test(mots(texte));

/* ------------------------------------------ deux agendas, une liste -- */
/* [B] Chaque evenement garde sa SOURCE ; un meme evenement vu dans les deux
 * agendas (meme debut, meme fin, meme titre) n'apparait qu'une fois. */
function fusionner(listes, zone = 'Europe/Paris', max = 60) {
  const par = new Map(); let doublons = 0;
  for (const l of listes) {
    for (const e of (l && Array.isArray(l.evenements) ? l.evenements : [])) {
      const cle = (e.journee ? 'J' : 'H') + '|' + e.debut + '|' + e.fin + '|' + norm(e.titre);
      const deja = par.get(cle);
      if (deja) { if (!deja.sources.includes(l.source)) { deja.sources.push(l.source); doublons++; } continue; }
      par.set(cle, { ...e, sources: [l.source] });
    }
  }
  const debutDe = (e) => { if (!e.journee) return Date.parse(e.debut); const [y, m, d] = String(e.debut).split('-').map(Number); return AG.versUtc(zone, y, m, d); };
  const tous = [...par.values()].sort((a, b) => debutDe(a) - debutDe(b) || (a.journee ? -1 : 1));
  const rendus = tous.slice(0, max).map(e => Object.freeze({ ...e, sources: Object.freeze(e.sources.slice()) }));
  return { evenements: rendus, total: tous.length, doublons, tronque: tous.length > rendus.length };
}
function texteFusion(evenements, zone = 'Europe/Paris') {
  return evenements.map(e => AG.enTexte([e], zone) + ' · agenda ' + e.sources.join(' + ')).join('\n');
}

module.exports = Object.freeze({ VERSION, resoudreDates, dateUnique, tableDates, avertissementNuit, questionContradiction, questionDate,
  corrigerJours, retirerAffirmations, affirme, intentionSuppression, suppressionNue, titreNomme, resoudreHeures,
  creationDemandee, demandeSerie, parleAgenda, demandeAction, renonce, fusionner, texteFusion, mots,
  libelle, libellePeriode, local, iso, jourDe, jourSemaine, civil });
