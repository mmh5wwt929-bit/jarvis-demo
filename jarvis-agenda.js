'use strict';
/* ============================================================================
 * JARVIS — outil agenda 1.0 (lecture seule)
 * ----------------------------------------------------------------------------
 * Le premier vrai outil de JARVIS. Il lit l'agenda de la personne a partir de
 * son adresse iCal secrete (Google Agenda : « Adresse secrete au format
 * iCal »), et rien d'autre.
 *
 * CE QUI LE REND SUR PAR CONSTRUCTION
 *  - LECTURE SEULE PAR NATURE : un lien iCal ne permet que de lire. Meme si ce
 *    code avait une faille, l'identifiant confie ne sait ni creer, ni modifier,
 *    ni supprimer un evenement.
 *  - PAS DE LECTURE SANS PERMIS : le reseau n'est touche que par lire(permis),
 *    et un permis ne nait que dans le gestionnaire d'une transaction que la
 *    couche a autorisee (T6 : il recoit l'action gelee, periode comprise).
 *    Un permis sert une fois, expire en 30 s, et un objet qui lui ressemble ne
 *    vaut rien (registre prive, identite d'objet).
 *  - PERIODE BORNEE : uniquement des formes fixes (aujourd'hui, demain, apres-
 *    demain, semaine, semaine prochaine, une date, un intervalle de 31 jours
 *    au plus), jamais un chemin, une adresse ou un joker.
 *  - TELECHARGEMENT GARDE : https seulement (webcal:// converti), 3
 *    redirections au plus et toutes en https, 2 Mo au plus, 8 s au total
 *    (y compris contre un serveur qui distille un octet a la fois).
 *  - LE SECRET NE SORT JAMAIS : aucune erreur, aucun resultat, aucun journal
 *    ne contient l'adresse. Les echecs sont des codes (DELAI_DEPASSE...).
 *  - CALCUL BORNE : nombre d'evenements lus, nombre de pas de recurrence par
 *    evenement et au total ; au-dela, le resultat est marque « tronque » au
 *    lieu de bloquer le serveur.
 *  - CONTENU EXTERNE : titres, lieux et notes peuvent venir d'autres personnes
 *    (une invitation). Ils sont nettoyes et tronques ici ; c'est au serveur de
 *    les declarer a la couche comme contenu externe (CONTENT_DERIVED).
 * ========================================================================== */
const https = require('https');
const { URL } = require('url');

const LIMITES_AGENDA = Object.freeze({
  delaiMs: 8000, maxOctets: 2 * 1024 * 1024, maxRedirections: 3,
  maxEvenementsLus: 3000, maxEvenementsRendus: 60,
  maxPasParEvenement: 40000, maxPasTotal: 1500000,
  cacheMs: 5 * 60 * 1000, cacheEchecMs: 30 * 1000, permisMs: 30 * 1000,
  maxJoursPeriode: 31, titreMax: 120, lieuMax: 120, descriptionMax: 300, valeurMax: 5000
});

/* ---------------------------------------------------------------- dates -- */
const JOUR_MS = 86400000;
const JOURS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const jourDe = (y, mo, d) => Math.floor(Date.UTC(y, mo - 1, d) / JOUR_MS);
const civil = (j) => { const t = new Date(j * JOUR_MS); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const jourSemaine = (j) => new Date(j * JOUR_MS).getUTCDay();
const joursDansMois = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const iso = (j) => { const c = civil(j); return c.y + '-' + String(c.mo).padStart(2, '0') + '-' + String(c.d).padStart(2, '0'); };
function jourValide(y, mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null;
  const j = jourDe(y, mo, d), c = civil(j);
  return (c.y === y && c.mo === mo && c.d === d) ? j : null;
}

const formats = new Map();
function formatZone(zone) {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formats.set(zone, f);
  }
  return f;
}
function zoneValide(z) {
  if (typeof z !== 'string' || !z || z.length > 64) return false;
  try { formatZone(z); return true; } catch { return false; }
}
function partiesLocales(ms, zone) {
  const p = {};
  for (const x of formatZone(zone).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, s: +p.second };
}
const decalage = (ms, zone) => {
  const l = partiesLocales(ms, zone);
  return Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s) - Math.floor(ms / 1000) * 1000;
};
/* Heure murale d'un fuseau -> instant universel (deux passes : changement d'heure). */
function versUtc(zone, y, mo, d, h = 0, mi = 0, s = 0) {
  if (zone === 'UTC') return Date.UTC(y, mo - 1, d, h, mi, s);
  const naif = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = naif - decalage(naif, zone);
  t = naif - decalage(t, zone);
  return t;
}
const jourLocal = (ms, zone) => { const l = partiesLocales(ms, zone); return jourDe(l.y, l.mo, l.d); };

/* -------------------------------------------------------------- periodes -- */
/* Les seules formes admises. Tout le reste : null (refus). La cle canonique
 * « AAAA-MM-JJ..AAAA-MM-JJ » (fin incluse) est ce que la transaction porte. */
function periodeDe(cible, maintenantMs, zone, L = LIMITES_AGENDA) {
  if (typeof cible !== 'string') return null;
  const t = cible.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019'\s_]+/g, '-');
  if (!t || t.length > 40) return null;
  const auj = jourLocal(maintenantMs, zone);
  let a, b;
  if (t === 'aujourdhui' || t === 'aujourd-hui' || t === 'today') a = b = auj;
  else if (t === 'demain') a = b = auj + 1;
  else if (t === 'apres-demain') a = b = auj + 2;
  else if (t === 'semaine' || t === 'cette-semaine' || t === '7-jours') { a = auj; b = auj + 6; }
  else if (t === 'semaine-prochaine') { a = auj + (((1 - jourSemaine(auj) + 7) % 7) || 7); b = a + 6; }
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:\.\.(\d{4})-(\d{2})-(\d{2}))?$/.exec(t);
    if (!m) return null;
    a = jourValide(+m[1], +m[2], +m[3]);
    b = m[4] ? jourValide(+m[4], +m[5], +m[6]) : a;
    if (a == null || b == null) return null;
  }
  if (b < a || b - a + 1 > L.maxJoursPeriode) return null;
  if (a < auj - 31 || b > auj + 366) return null;
  const ca = civil(a), cf = civil(b + 1);
  return Object.freeze({
    jourDebut: a, jourFin: b + 1,
    debutMs: versUtc(zone, ca.y, ca.mo, ca.d), finMs: versUtc(zone, cf.y, cf.mo, cf.d),
    cle: iso(a) + '..' + iso(b)
  });
}

/* -------------------------------------------------------------- lecture -- */
function lignesDepliees(texte) {
  const out = [];
  for (const l of String(texte).replace(/\r\n|\r/g, '\n').split('\n')) {
    if ((l.charCodeAt(0) === 32 || l.charCodeAt(0) === 9) && out.length) out[out.length - 1] += l.slice(1);
    else out.push(l);
  }
  return out;
}
/* NOM;PARAM=V;PARAM="a:b":VALEUR — le premier « : » hors guillemets. */
function decouper(ligne) {
  let q = false, i = 0;
  for (; i < ligne.length; i++) { const c = ligne[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
  if (i >= ligne.length) return null;
  const tete = ligne.slice(0, i), valeur = ligne.slice(i + 1);
  const morceaux = []; let cur = ''; q = false;
  for (const c of tete) {
    if (c === '"') { q = !q; cur += c; } else if (c === ';' && !q) { morceaux.push(cur); cur = ''; } else cur += c;
  }
  morceaux.push(cur);
  const nom = morceaux.shift().trim().toUpperCase();
  const params = Object.create(null);              /* pas de prototype : un parametre « __proto__ » reste une donnee */
  for (const m of morceaux) {
    const k = m.indexOf('=');
    if (k > 0) params[m.slice(0, k).trim().toUpperCase()] = m.slice(k + 1).replace(/^"|"$/g, '');
  }
  return { nom, params, valeur };
}
const texteIcs = (v) => String(v).replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N') ? '\n' : c);

function lireDate(prop, zoneDefaut) {
  if (!prop) return null;
  const v = String(prop.valeur).trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || prop.params.VALUE === 'DATE') {
    if (!m) return null;
    const j = jourValide(+m[1], +m[2], +m[3]);
    return j == null ? null : { journee: true, jour: j };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const loc = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
  if (jourValide(loc.y, loc.mo, loc.d) == null || loc.h > 23 || loc.mi > 59 || loc.s > 60) return null;
  if (m[7] === 'Z') return { journee: false, zone: 'UTC', loc, ms: Date.UTC(loc.y, loc.mo - 1, loc.d, loc.h, loc.mi, loc.s) };
  const zone = zoneValide(prop.params.TZID) ? prop.params.TZID : zoneDefaut;
  return { journee: false, zone, loc, ms: versUtc(zone, loc.y, loc.mo, loc.d, loc.h, loc.mi, loc.s) };
}
function lireDuree(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m || m[1] === '-') return null;
  return ((+(m[2] || 0)) * 7 * JOUR_MS) + ((+(m[3] || 0)) * JOUR_MS) + ((+(m[4] || 0)) * 3600000)
    + ((+(m[5] || 0)) * 60000) + ((+(m[6] || 0)) * 1000);
}
function lireRegle(v, zoneDefaut) {
  const r = Object.create(null);
  for (const kv of String(v).split(';')) { const k = kv.indexOf('='); if (k > 0) r[kv.slice(0, k).trim().toUpperCase()] = kv.slice(k + 1).trim().toUpperCase(); }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) return { nonGeree: true };
  if (r.BYSETPOS || r.BYHOUR || r.BYMINUTE || r.BYSECOND || r.BYWEEKNO || r.BYYEARDAY) return { nonGeree: true };
  const regle = { freq: r.FREQ, intervalle: Math.max(1, Math.min(1000, parseInt(r.INTERVAL || '1', 10) || 1)),
    count: r.COUNT ? Math.max(0, Math.min(100000, parseInt(r.COUNT, 10) || 0)) : null,
    until: null, jours: null, joursMois: null, mois: null, wkst: r.WKST in JOURS ? JOURS[r.WKST] : 1 };
  if (r.UNTIL) {
    const u = lireDate({ valeur: r.UNTIL, params: Object.create(null) }, zoneDefaut);
    if (!u) return { nonGeree: true };
    regle.until = u;
  }
  if (r.BYDAY) {
    const l = r.BYDAY.split(',').map(x => /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(x.trim()));
    if (l.some(x => !x)) return { nonGeree: true };
    regle.jours = l.map(m => ({ n: m[1] ? parseInt(m[1], 10) : 0, j: JOURS[m[2]] }));
  }
  if (r.BYMONTHDAY) {
    const l = r.BYMONTHDAY.split(',').map(x => parseInt(x, 10));
    if (l.some(n => !n || Math.abs(n) > 31)) return { nonGeree: true };
    regle.joursMois = l;
  }
  if (r.BYMONTH) {
    const l = r.BYMONTH.split(',').map(x => parseInt(x, 10));
    if (l.some(n => !(n >= 1 && n <= 12))) return { nonGeree: true };
    regle.mois = l;
  }
  return regle;
}

function analyserIcs(texte, { zone = 'Europe/Paris', limites = LIMITES_AGENDA } = {}) {
  const L = limites;
  if (!/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(String(texte).slice(0, 200))) return { ok: false, code: 'ICS_INVALIDE' };
  const brut = []; const pile = []; let cur = null, tronque = false;
  for (const ligne of lignesDepliees(texte)) {
    if (!ligne) continue;
    const p = decouper(ligne); if (!p) continue;
    if (p.nom === 'BEGIN') {
      const c = p.valeur.trim().toUpperCase(); pile.push(c);
      if (c === 'VEVENT' && pile.length === 2) cur = { exdates: [] };
      continue;
    }
    if (p.nom === 'END') {
      const c = pile.pop();
      if (c === 'VEVENT' && cur && pile.length === 1) {
        brut.push(cur); cur = null;
        if (brut.length >= L.maxEvenementsLus) { tronque = true; break; }
      }
      continue;
    }
    if (!cur || pile[pile.length - 1] !== 'VEVENT') continue;      /* VALARM et consorts : ignores */
    const prop = { valeur: p.valeur.slice(0, L.valeurMax), params: p.params };
    if (p.nom === 'EXDATE') { if (cur.exdates.length < 500) cur.exdates.push(prop); continue; }
    if (['UID', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'DTSTART', 'DTEND', 'DURATION', 'RRULE',
         'RECURRENCE-ID', 'STATUS'].includes(p.nom) && !(p.nom in cur)) cur[p.nom] = prop;
  }

  const evenements = [];
  for (const b of brut) {
    const debut = lireDate(b.DTSTART, zone);
    if (!debut) continue;
    let dureeMs = null, dureeJours = null;
    const fin = lireDate(b.DTEND, zone);
    if (debut.journee) {
      dureeJours = (fin && fin.journee && fin.jour > debut.jour) ? fin.jour - debut.jour : 1;
      if (!fin && b.DURATION) { const d = lireDuree(b.DURATION.valeur); if (d) dureeJours = Math.max(1, Math.round(d / JOUR_MS)); }
    } else {
      dureeMs = (fin && !fin.journee && fin.ms >= debut.ms) ? fin.ms - debut.ms : (b.DURATION ? (lireDuree(b.DURATION.valeur) || 0) : 0);
    }
    const exdates = new Set();
    for (const x of b.exdates) for (const v of String(x.valeur).split(',')) {
      const d = lireDate({ valeur: v, params: x.params }, zone);
      if (d) exdates.add(d.journee ? 'j' + d.jour : 'm' + d.ms);
    }
    const rid = lireDate(b['RECURRENCE-ID'], zone);
    evenements.push({
      uid: b.UID ? String(b.UID.valeur).slice(0, 300) : null,
      titre: b.SUMMARY ? texteIcs(b.SUMMARY.valeur) : '',
      lieu: b.LOCATION ? texteIcs(b.LOCATION.valeur) : '',
      description: b.DESCRIPTION ? texteIcs(b.DESCRIPTION.valeur) : '',
      annule: !!(b.STATUS && /^CANCELLED$/i.test(String(b.STATUS.valeur).trim())),
      debut, dureeMs, dureeJours, exdates,
      regle: b.RRULE ? lireRegle(b.RRULE.valeur, zone) : null,
      recurrenceId: rid ? (rid.journee ? 'j' + rid.jour : 'm' + rid.ms) : null
    });
  }
  return { ok: true, evenements, tronque };
}

/* ----------------------------------------------------------- recurrence -- */
function dansLeMois(regle, c, js, c0) {
  if (regle.joursMois) {
    const n = joursDansMois(c.y, c.mo);
    const ok = regle.joursMois.some(x => x > 0 ? x === c.d : (n + x + 1) === c.d);
    return ok && (!regle.jours || regle.jours.some(x => x.j === js));
  }
  if (regle.jours) {
    const n = joursDansMois(c.y, c.mo);
    const rang = Math.floor((c.d - 1) / 7) + 1, rangFin = -(Math.floor((n - c.d) / 7) + 1);
    return regle.jours.some(x => x.j === js && (x.n === 0 || x.n === rang || x.n === rangFin));
  }
  return c.d === c0.d;
}
function correspond(regle, j0, c0, j) {
  if (j < j0) return false;
  const c = civil(j), js = jourSemaine(j);
  if (regle.mois && !regle.mois.includes(c.mo)) return false;
  switch (regle.freq) {
    case 'DAILY':
      if ((j - j0) % regle.intervalle) return false;
      if (regle.jours && !regle.jours.some(x => x.j === js)) return false;
      if (regle.joursMois) { const n = joursDansMois(c.y, c.mo); if (!regle.joursMois.some(x => x > 0 ? x === c.d : (n + x + 1) === c.d)) return false; }
      return true;
    case 'WEEKLY': {
      const debutSemaine = (x) => x - ((jourSemaine(x) - regle.wkst + 7) % 7);
      if (Math.round((debutSemaine(j) - debutSemaine(j0)) / 7) % regle.intervalle) return false;
      return (regle.jours ? regle.jours.map(x => x.j) : [jourSemaine(j0)]).includes(js);
    }
    case 'MONTHLY':
      if (((c.y - c0.y) * 12 + (c.mo - c0.mo)) % regle.intervalle) return false;
      return dansLeMois(regle, c, js, c0);
    case 'YEARLY':
      if ((c.y - c0.y) % regle.intervalle) return false;
      if (!regle.mois && c.mo !== c0.mo) return false;
      return dansLeMois(regle, c, js, c0);
  }
  return false;
}

/* Occurrences d'un evenement qui touchent la periode. `budget` est partage
 * entre tous les evenements : au-dela, on s'arrete et on le dit. */
function occurrences(ev, periode, zone, budget, L) {
  const out = [];
  const touche = (dMs, fMs) => dMs < periode.finMs && Math.max(fMs, dMs + 1) > periode.debutMs;
  const toucheJour = (j, n) => j < periode.jourFin && j + n > periode.jourDebut;
  const d = ev.debut;
  if (!ev.regle) {
    if (d.journee ? toucheJour(d.jour, ev.dureeJours) : touche(d.ms, d.ms + ev.dureeMs))
      out.push(d.journee ? { journee: true, jour: d.jour, jours: ev.dureeJours, cle: 'j' + d.jour }
                         : { journee: false, debutMs: d.ms, finMs: d.ms + ev.dureeMs, cle: 'm' + d.ms });
    return out;
  }
  const regle = ev.regle;
  if (regle.nonGeree) {   /* recurrence non prise en charge : la premiere occurrence seule, signalee */
    const r = occurrences({ ...ev, regle: null }, periode, zone, budget, L);
    return r.map(x => ({ ...x, approximatif: true }));
  }
  const j0 = d.journee ? d.jour : jourDe(d.loc.y, d.loc.mo, d.loc.d);
  const c0 = civil(j0);
  const zoneEv = d.journee ? zone : d.zone;
  const jourFinZone = d.journee ? periode.jourFin : jourLocal(periode.finMs, zoneEv) + 1;
  const etendue = d.journee ? ev.dureeJours : Math.ceil(ev.dureeMs / JOUR_MS) + 1;
  const jourDebutZone = d.journee ? periode.jourDebut : jourLocal(periode.debutMs, zoneEv) - 1;
  let jourUntil = Infinity;
  if (regle.until) jourUntil = regle.until.journee ? regle.until.jour : jourLocal(regle.until.ms, zoneEv) + 1;
  /* Sans COUNT, on peut sauter directement pres de la periode. */
  let j = regle.count == null ? Math.max(j0, jourDebutZone - etendue) : j0;
  const fin = Math.min(jourFinZone, jourUntil);
  /* Avant ce jour, une occurrence ne peut pas toucher la periode : on la
   * COMPTE (pour COUNT) sans calculer son heure. La conversion d'heure est
   * le pas le plus cher ; la faire pour 50 ans d'occurrences bloquait le
   * serveur 18 s sur un agenda piege (test H4). */
  const proche = jourDebutZone - etendue - 1;
  let vus = 0, pas = 0;
  for (; j <= fin; j++) {
    if (++pas > L.maxPasParEvenement || --budget.restant < 0) { budget.depasse = true; break; }
    if (!correspond(regle, j0, c0, j)) continue;
    vus++;
    if (regle.count != null && vus > regle.count) break;
    if (j < proche) continue;
    let occ;
    if (d.journee) occ = { journee: true, jour: j, jours: ev.dureeJours, cle: 'j' + j };
    else {
      const c = civil(j);
      const ms = versUtc(zoneEv, c.y, c.mo, c.d, d.loc.h, d.loc.mi, d.loc.s);
      if (regle.until && !regle.until.journee && ms > regle.until.ms) break;
      occ = { journee: false, debutMs: ms, finMs: ms + ev.dureeMs, cle: 'm' + ms };
    }
    if (ev.exdates.has(occ.cle)) continue;
    if (occ.journee ? toucheJour(occ.jour, occ.jours) : touche(occ.debutMs, occ.finMs)) out.push(occ);
  }
  return out;
}

/* ------------------------------------------------------------- rendu -- */
const nettoyer = (v, max) => String(v == null ? '' : v)
  .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
  .replace(/[<>]/g, (c) => c === '<' ? '\u2039' : '\u203A')
  .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
  .slice(0, max);

function evenementsDans(analyse, periode, zone, L = LIMITES_AGENDA) {
  const budget = { restant: L.maxPasTotal, depasse: false };
  const remplaces = new Set(), resultats = [];
  for (const ev of analyse.evenements) if (ev.recurrenceId && ev.uid) remplaces.add(ev.uid + '|' + ev.recurrenceId);
  /* Les evenements simples d'abord, les series ensuite : une invitation
   * recurrente piegee (n'importe qui peut en envoyer une, Google l'ajoute
   * seul a l'agenda) ne peut epuiser le budget qu'au detriment d'autres
   * series, jamais cacher un rendez-vous ponctuel. */
  const ordre = analyse.evenements.filter(e => !e.regle).concat(analyse.evenements.filter(e => e.regle));
  for (const ev of ordre) {
    if (ev.recurrenceId) {                               /* occurrence modifiee : elle-meme, si non annulee */
      if (ev.annule) continue;
      for (const o of occurrences({ ...ev, regle: null }, periode, zone, budget, L)) resultats.push({ ev, o });
      continue;
    }
    if (ev.annule) continue;
    for (const o of occurrences(ev, periode, zone, budget, L)) {
      if (ev.uid && remplaces.has(ev.uid + '|' + o.cle)) continue;
      resultats.push({ ev, o });
    }
    if (budget.depasse) break;
  }
  const debutDe = (o) => o.journee ? versUtc(zone, civil(o.jour).y, civil(o.jour).mo, civil(o.jour).d) : o.debutMs;
  resultats.sort((a, b) => debutDe(a.o) - debutDe(b.o) || (a.o.journee ? -1 : 1));
  const rendus = resultats.slice(0, L.maxEvenementsRendus).map(({ ev, o }) => Object.freeze({
    journee: o.journee,
    debut: o.journee ? iso(o.jour) : new Date(o.debutMs).toISOString(),
    fin: o.journee ? iso(o.jour + o.jours - 1) : new Date(o.finMs).toISOString(),
    titre: nettoyer(ev.titre, L.titreMax) || '(sans titre)',
    lieu: nettoyer(ev.lieu, L.lieuMax),
    description: nettoyer(ev.description, L.descriptionMax),
    recurrent: !!ev.regle, approximatif: !!o.approximatif
  }));
  return { evenements: rendus, total: resultats.length,
    tronque: !!(analyse.tronque || budget.depasse || resultats.length > rendus.length) };
}

/* Texte lisible, en heure locale, a remettre au modele comme DONNEES. */
function enTexte(evenements, zone) {
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' });
  const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  const jourCivil = (s) => { const [y, m, d] = s.split('-').map(Number); return jour.format(new Date(Date.UTC(y, m - 1, d, 12))); };
  return evenements.map(e => {
    let quand;
    if (e.journee) quand = e.debut === e.fin ? jourCivil(e.debut) + ' (toute la journée)' : 'du ' + jourCivil(e.debut) + ' au ' + jourCivil(e.fin);
    else {
      const d = new Date(e.debut), f = new Date(e.fin);
      quand = jour.format(d) + ', ' + heure.format(d) + (f > d ? ' → ' + heure.format(f) : '');
    }
    return '- ' + quand + ' · ' + e.titre + (e.lieu ? ' · lieu : ' + e.lieu : '')
      + (e.recurrent ? ' · récurrent' : '') + (e.approximatif ? ' (récurrence non prise en charge : première date seulement)' : '')
      + (e.description ? '\n  note : ' + e.description.replace(/\n/g, ' / ') : '');
  }).join('\n');
}

/* --------------------------------------------------------- telechargement -- */
function normaliserUrl(texte) {
  let u;
  try { u = new URL(String(texte || '').trim().replace(/^webcal:\/\//i, 'https://')); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
  return u.href;
}
function telecharger(url, get, L) {
  return new Promise((resolve) => {
    let fini = false, courante = null;
    const minuteur = setTimeout(() => finir({ ok: false, code: 'DELAI_DEPASSE' }), L.delaiMs);
    function finir(r) {
      if (fini) return; fini = true; clearTimeout(minuteur);
      if (!r.ok && courante) { try { courante.destroy(); } catch { /* deja ferme */ } }
      resolve(r);
    }
    function essai(u, restant) {
      let req;
      try {
        req = get(u, { headers: { 'User-Agent': 'JARVIS-agenda/1.0', Accept: 'text/calendar, text/plain;q=0.9' } }, (res) => {
          if (fini) { try { res.resume(); } catch { /* rien */ } return; }
          const code = Number(res.statusCode);
          if (code >= 300 && code < 400 && res.headers && res.headers.location) {
            try { res.resume(); } catch { /* rien */ }
            if (restant <= 0) return finir({ ok: false, code: 'TROP_DE_REDIRECTIONS' });
            const suivant = normaliserUrl((() => { try { return new URL(res.headers.location, u).href; } catch { return ''; } })());
            if (!suivant || /^webcal:/i.test(String(res.headers.location))) return finir({ ok: false, code: 'REDIRECTION_REFUSEE' });
            return essai(suivant, restant - 1);
          }
          if (code !== 200) { try { res.resume(); } catch { /* rien */ } return finir({ ok: false, code: 'HTTP_' + (code || 0) }); }
          const morceaux = []; let taille = 0;
          res.on('data', (c) => {
            if (fini) return;
            taille += c.length;
            if (taille > L.maxOctets) return finir({ ok: false, code: 'TROP_VOLUMINEUX' });
            morceaux.push(c);
          });
          res.on('end', () => finir({ ok: true, texte: Buffer.concat(morceaux).toString('utf8') }));
          res.on('error', () => finir({ ok: false, code: 'RESEAU' }));
        });
      } catch { return finir({ ok: false, code: 'RESEAU' }); }
      courante = req;
      req.on('error', () => finir({ ok: false, code: 'RESEAU' }));
    }
    essai(url, L.maxRedirections);
  });
}

/* ------------------------------------------------------------ l'outil -- */
function creerAgenda({ url, zone = 'Europe/Paris', get = https.get, maintenant = () => Date.now(), limites } = {}) {
  const L = Object.freeze({ ...LIMITES_AGENDA, ...(limites || {}) });
  const adresse = normaliserUrl(url);
  if (!adresse) return Object.freeze({ actif: false, motif: 'URL_INVALIDE' });
  if (!zoneValide(zone)) return Object.freeze({ actif: false, motif: 'FUSEAU_INVALIDE' });

  const permisEmis = new WeakMap();   /* permis -> { expire, utilise } ; un objet imite n'y est pas */
  let cache = null, echec = null, enCours = null;

  async function calendrier() {
    const t = maintenant();
    if (cache && t - cache.quand < L.cacheMs) return cache.r;
    if (echec && t - echec.quand < L.cacheEchecMs) return echec.r;
    if (!enCours) enCours = (async () => {
      const b = await telecharger(adresse, get, L);
      const r = b.ok ? analyserIcs(b.texte, { zone, limites: L }) : b;
      if (r.ok) { cache = { quand: maintenant(), r }; echec = null; } else echec = { quand: maintenant(), r };
      return r;
    })().finally(() => { enCours = null; });
    return enCours;
  }

  return Object.freeze({
    actif: true, zone,
    periodeDe: (cible) => periodeDe(cible, maintenant(), zone, L),
    /* Appele DANS le gestionnaire d'une transaction autorisee (T6). */
    permis(action) {
      if (!action || action.action !== 'READ' || action.resource !== 'AGENDA') throw new Error('PERMIS_REFUSE');
      const periode = periodeDe(action.target, maintenant(), zone, L);
      if (!periode) throw new Error('PERIODE_INVALIDE');
      const p = Object.freeze({ periode, transactionId: String(action.transactionId || '') });
      permisEmis.set(p, { expire: maintenant() + L.permisMs, utilise: false });
      return p;
    },
    async lire(permis) {
      const e = (permis && typeof permis === 'object') ? permisEmis.get(permis) : undefined;
      if (!e) return { ok: false, code: 'PERMIS_INCONNU' };
      if (e.utilise) return { ok: false, code: 'PERMIS_DEJA_UTILISE' };
      e.utilise = true;
      if (maintenant() > e.expire) return { ok: false, code: 'PERMIS_EXPIRE' };
      const c = await calendrier();
      if (!c.ok) return { ok: false, code: c.code };
      const r = evenementsDans(c, permis.periode, zone, L);
      return { ok: true, periode: permis.periode.cle, ...r, texte: enTexte(r.evenements, zone) };
    }
  });
}

module.exports = { creerAgenda, periodeDe, analyserIcs, evenementsDans, enTexte, telecharger, normaliserUrl,
  versUtc, LIMITES_AGENDA, VERSION: '1.0' };
