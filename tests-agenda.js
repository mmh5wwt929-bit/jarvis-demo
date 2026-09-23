'use strict';
/* ============================================================================
 * JARVIS — tests de l'outil agenda 1.0   (node tests-agenda.js)
 * Lecture iCal, recurrences, changement d'heure, periodes admises,
 * telechargement garde, permis a usage unique, calcul borne.
 * Horloge fixee : mercredi 23 septembre 2026, 12:00 a Paris.
 * ========================================================================== */
const { EventEmitter } = require('events');
const A = require('./jarvis-agenda.js');

const MAINTENANT = Date.parse('2026-09-23T10:00:00Z');
const ZONE = 'Europe/Paris';
const R = [];
const t = async (id, nom, f) => {
  let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; }
  R.push({ id, nom, ok: !!r.ok, info: r.info });
};
const ics = (...evs) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//FR', ...evs.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...lignes) => ['BEGIN:VEVENT', ...lignes, 'END:VEVENT'];
const lire = (texte, cible) => {
  const a = A.analyserIcs(texte, { zone: ZONE });
  if (!a.ok) return a;
  return A.evenementsDans(a, A.periodeDe(cible, MAINTENANT, ZONE), ZONE);
};

/* Faux https.get : chaque adresse a son scenario. */
function fauxGet(scenarios, compteur = { n: 0, detruits: 0 }) {
  const get = (url, opts, cb) => {
    compteur.n++;
    const s = scenarios[url] || { status: 404 };
    const req = new EventEmitter();
    req.destroy = () => { compteur.detruits++; req.detruit = true; };
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = s.status; res.headers = s.headers || {}; res.resume = () => {};
      cb(res);
      if (s.status !== 200) return;
      const morceaux = s.morceaux || [s.corps || ''];
      let i = 0;
      const suivant = () => {
        if (req.detruit) return;
        if (i < morceaux.length) { res.emit('data', Buffer.from(morceaux[i++])); setTimeout(suivant, s.pauseMs || 0); }
        else res.emit('end');
      };
      suivant();
    });
    return req;
  };
  get.compteur = compteur;
  return get;
}
const SECRET = 'https://calendar.google.com/calendar/ical/moi%40gmail.com/private-SECRET123abc/basic.ics';

(async () => {
  /* ---------------------------------------------------------- lecture */
  const U18 = ev('UID:u18@test', 'SUMMARY:Entraînement U18', 'LOCATION:Gymnase de Firminy',
    'DTSTART;TZID=Europe/Paris:20260903T183000', 'DTEND;TZID=Europe/Paris:20260903T200000',
    'RRULE:FREQ=WEEKLY;BYDAY=TH');
  await t('L1', 'evenement horaire avec fuseau : 18h30 a Paris = 16h30 universel', () => {
    const r = lire(ics(ev('UID:a', 'SUMMARY:Dentiste', 'DTSTART;TZID=Europe/Paris:20260924T183000',
      'DTEND;TZID=Europe/Paris:20260924T190000')), 'demain');
    return { ok: r.evenements.length === 1 && r.evenements[0].debut === '2026-09-24T16:30:00.000Z', info: r.evenements.map(e => e.debut).join() };
  });
  await t('L2', 'journee entiere (fin exclusive) et plusieurs jours', () => {
    const r = lire(ics(ev('UID:b', 'SUMMARY:Congés', 'DTSTART;VALUE=DATE:20260925', 'DTEND;VALUE=DATE:20260928')), 'semaine');
    const e = r.evenements[0];
    return { ok: r.evenements.length === 1 && e.journee && e.debut === '2026-09-25' && e.fin === '2026-09-27', info: JSON.stringify(e && [e.debut, e.fin]) };
  });
  await t('L3', 'heure universelle (Z)', () => {
    const r = lire(ics(ev('UID:c', 'SUMMARY:Appel', 'DTSTART:20260924T080000Z', 'DTEND:20260924T083000Z')), 'demain');
    return { ok: r.evenements[0] && r.evenements[0].debut === '2026-09-24T08:00:00.000Z', info: r.evenements.map(e => e.debut).join() };
  });
  await t('L4', "lignes repliees, echappements, et l'alarme n'ecrase pas la note", () => {
    const texte = ics(['BEGIN:VEVENT', 'UID:d', 'SUMMARY:Réunion\\, point\\n', ' suivi', 'DESCRIPTION:Salle 3\\; apporter le dossier',
      'DTSTART;TZID=Europe/Paris:20260924T090000', 'DTEND;TZID=Europe/Paris:20260924T100000',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel automatique', 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT']);
    const e = lire(texte, 'demain').evenements[0];
    return { ok: e && e.titre === 'Réunion, point\nsuivi' && e.description === 'Salle 3; apporter le dossier', info: JSON.stringify(e && [e.titre, e.description]) };
  });
  await t('L4b', "une alarme placee AVANT la note de l'evenement ne la remplace pas", () => {
    const texte = ics(['BEGIN:VEVENT', 'UID:d2', 'DTSTART;TZID=Europe/Paris:20260924T090000',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'SUMMARY:Titre de l alarme', 'DESCRIPTION:Rappel automatique', 'TRIGGER:-PT10M', 'END:VALARM',
      'SUMMARY:Vrai titre', 'DESCRIPTION:Vraie note', 'END:VEVENT']);
    const e = lire(texte, 'demain').evenements[0];
    return { ok: e && e.titre === 'Vrai titre' && e.description === 'Vraie note', info: JSON.stringify(e && [e.titre, e.description]) };
  });
  await t('L5', "recurrence hebdo : l'entrainement reste a 18h30 apres le changement d'heure (25 oct)", () => {
    const r = lire(ics(U18), '2026-10-19..2026-11-01');
    const d = r.evenements.map(e => e.debut);
    return { ok: d.length === 2 && d[0] === '2026-10-22T16:30:00.000Z' && d[1] === '2026-10-29T17:30:00.000Z', info: d.join(' ') };
  });
  await t('L6', 'COUNT et UNTIL respectes', () => {
    const c = lire(ics(ev('UID:e', 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:20260901T100000', 'RRULE:FREQ=WEEKLY;COUNT=3')), '2026-09-01..2026-09-30');
    const u = lire(ics(ev('UID:f', 'SUMMARY:y', 'DTSTART;TZID=Europe/Paris:20260910T100000', 'RRULE:FREQ=DAILY;UNTIL=20260917T235959Z')), '2026-09-01..2026-09-30');
    return { ok: c.evenements.length === 3 && u.evenements.length === 8, info: 'COUNT=3 -> ' + c.evenements.length + ', 10..17 -> ' + u.evenements.length };
  });
  await t('L7', 'EXDATE : la seance supprimee disparait', () => {
    const r = lire(ics(ev('UID:g', 'SUMMARY:Entraînement', 'DTSTART;TZID=Europe/Paris:20260903T183000', 'RRULE:FREQ=WEEKLY;BYDAY=TH',
      'EXDATE;TZID=Europe/Paris:20261001T183000')), '2026-09-28..2026-10-11');
    const d = r.evenements.map(e => e.debut.slice(0, 10));
    return { ok: d.length === 1 && d[0] === '2026-10-08', info: d.join(' ') };
  });
  await t('L8', 'occurrence decalee (RECURRENCE-ID) et occurrence annulee', () => {
    const r = lire(ics(U18,
      ev('UID:u18@test', 'RECURRENCE-ID;TZID=Europe/Paris:20261008T183000', 'SUMMARY:Entraînement (décalé)',
        'DTSTART;TZID=Europe/Paris:20261008T200000', 'DTEND;TZID=Europe/Paris:20261008T213000'),
      ev('UID:u18@test', 'RECURRENCE-ID;TZID=Europe/Paris:20261015T183000', 'STATUS:CANCELLED', 'SUMMARY:Entraînement',
        'DTSTART;TZID=Europe/Paris:20261015T183000')), '2026-10-05..2026-10-18');
    const d = r.evenements.map(e => e.debut + ' ' + e.titre);
    return { ok: d.length === 1 && d[0] === '2026-10-08T18:00:00.000Z Entraînement (décalé)', info: d.join(' | ') };
  });
  await t('L9', 'mensuel : 2e mardi et dernier vendredi', () => {
    const r = lire(ics(ev('UID:h', 'SUMMARY:Bureau', 'DTSTART;TZID=Europe/Paris:20260113T190000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU'),
      ev('UID:i', 'SUMMARY:Bilan', 'DTSTART;TZID=Europe/Paris:20260130T170000', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR')), '2026-10-01..2026-10-31');
    const d = r.evenements.map(e => e.debut.slice(0, 10));
    return { ok: d.join() === '2026-10-13,2026-10-30', info: d.join(' ') };
  });
  await t('L10', 'anniversaire annuel en journee entiere', () => {
    const r = lire(ics(ev('UID:j', 'SUMMARY:Anniversaire de Sam', 'DTSTART;VALUE=DATE:19900924', 'RRULE:FREQ=YEARLY')), 'demain');
    return { ok: r.evenements.length === 1 && r.evenements[0].debut === '2026-09-24', info: r.evenements.map(e => e.debut).join() };
  });
  await t('L11', 'recurrence non prise en charge (BYSETPOS) : premiere date seule, signalee', () => {
    const r = lire(ics(ev('UID:k', 'SUMMARY:z', 'DTSTART;TZID=Europe/Paris:20260924T100000', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1')), 'demain');
    return { ok: r.evenements.length === 1 && r.evenements[0].approximatif === true, info: JSON.stringify(r.evenements.map(e => e.approximatif)) };
  });
  await t('L12', 'evenement annule (STATUS:CANCELLED) ignore', () => {
    const r = lire(ics(ev('UID:l', 'SUMMARY:Annulé', 'STATUS:CANCELLED', 'DTSTART;TZID=Europe/Paris:20260924T100000')), 'demain');
    return { ok: r.evenements.length === 0, info: String(r.evenements.length) };
  });

  /* ---------------------------------------------------- contenu hostile */
  await t('H1', 'titre enorme, caracteres de controle, balises : nettoye et tronque', () => {
    const r = lire(ics(ev('UID:m', 'SUMMARY:<script>alert(1)</script>\u0007\u202E' + 'A'.repeat(10000),
      'DTSTART;TZID=Europe/Paris:20260924T100000')), 'demain');
    const e = r.evenements[0];
    return { ok: e && e.titre.length <= 120 && !/[<>\u0007\u202E]/.test(e.titre), info: e && e.titre.slice(0, 30) + '… (' + e.titre.length + ')' };
  });
  await t('H2', 'parametre « __proto__ » : aucune pollution, aucune panne', () => {
    const r = lire(ics(ev('UID:n', 'SUMMARY:p', 'DTSTART;__proto__=x;TZID=Europe/Paris:20260924T100000')), 'demain');
    return { ok: r.evenements.length === 1 && ({}).x === undefined, info: 'pollution ' + (({}).x === undefined ? 'aucune' : 'OUI') };
  });
  await t('H3', 'fichier de 5 000 evenements : lecture bornee et marquee « tronque »', () => {
    const evs = []; for (let i = 0; i < 5000; i++) evs.push(ev('UID:' + i, 'SUMMARY:e' + i, 'DTSTART;TZID=Europe/Paris:20260924T100000'));
    const d = Date.now(); const r = lire(ics(...evs), 'demain');
    return { ok: r.tronque === true && r.evenements.length === 60 && Date.now() - d < 3000, info: 'rendus ' + r.evenements.length + ', ' + (Date.now() - d) + ' ms' };
  });
  await t('H4', "recurrence quotidienne depuis 1970 (COUNT enorme) : calcul borne, pas de blocage", () => {
    const evs = []; for (let i = 0; i < 200; i++) evs.push(ev('UID:r' + i, 'SUMMARY:r', 'DTSTART;TZID=Europe/Paris:19700101T100000', 'RRULE:FREQ=DAILY;COUNT=100000'));
    const d = Date.now(); const r = lire(ics(...evs), 'demain');
    return { ok: Date.now() - d < 5000 && r.tronque === true, info: (Date.now() - d) + ' ms, tronque=' + r.tronque };
  });
  await t('H4b', "une serie piegee ne cache pas un rendez-vous ponctuel (invitation hostile en tete de fichier)", () => {
    const evs = []; for (let i = 0; i < 200; i++) evs.push(ev('UID:r' + i, 'SUMMARY:spam', 'DTSTART;TZID=Europe/Paris:19700101T100000', 'RRULE:FREQ=DAILY;COUNT=100000'));
    evs.push(ev('UID:vrai', 'SUMMARY:Médecin', 'DTSTART;TZID=Europe/Paris:20260924T090000'));
    const r = lire(ics(...evs), 'demain');
    return { ok: r.evenements.some(e => e.titre === 'Médecin') && r.tronque === true, info: 'Médecin ' + (r.evenements.some(e => e.titre === 'Médecin') ? 'présent' : 'CACHE') + ', tronque=' + r.tronque };
  });
  await t('H6', "regle qui ne tombe jamais (30 fevrier depuis 1900) : arretee par le budget, resultat marque incomplet", () => {
    const d = Date.now();
    const r = lire(ics(ev('UID:jamais', 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:19000101T100000', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30;COUNT=5')), 'demain');
    return { ok: r.tronque === true && r.evenements.length === 0 && Date.now() - d < 2000, info: 'tronque=' + r.tronque + ', ' + (Date.now() - d) + ' ms' };
  });
  const chrono = (f) => { const d = Date.now(); const r = f(); return { r, ms: Date.now() - d }; };
  await t('H7', "300 series avec BYDAY de 1 240 jours (invitations piegees) : calcul borne sous 1 s", () => {
    const j = Array(1240).fill('MO').join(','); const evs = [];
    for (let i = 0; i < 300; i++) evs.push(ev('UID:b' + i, 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:19700101T100000', 'RRULE:FREQ=DAILY;COUNT=100000;BYDAY=' + j));
    const { r, ms } = chrono(() => lire(ics(...evs), 'demain'));
    return { ok: ms < 1000 && r.tronque === true, info: ms + ' ms (1 800 ms avant la correction)' };
  });
  await t('H8', "300 series avec BYMONTHDAY de 1 600 valeurs : calcul borne sous 1 s", () => {
    const md = Array(1600).fill('1').join(','); const evs = [];
    for (let i = 0; i < 300; i++) evs.push(ev('UID:m' + i, 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:19700101T100000', 'RRULE:FREQ=DAILY;COUNT=100000;BYMONTHDAY=' + md));
    const { r, ms } = chrono(() => lire(ics(...evs), 'demain'));
    return { ok: ms < 1000 && r.tronque === true, info: ms + ' ms (3 400 ms avant la correction)' };
  });
  await t('H9', "2 Mo de dates exclues : lecture bornee sous 0,6 s, resultat marque incomplet", () => {
    const ex = Array(290).fill('20200101T100000').join(','); const evs = []; let taille = 0;
    for (let i = 0; taille < 1.9e6; i++) { const l = []; for (let k = 0; k < 5; k++) l.push('EXDATE;TZID=Europe/Paris:' + ex);
      const e = ev('UID:x' + i, 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:20260924T100000', ...l); taille += e.join('\r\n').length; evs.push(e); }
    const { r, ms } = chrono(() => lire(ics(...evs), 'demain'));
    return { ok: ms < 600 && r.tronque === true, info: ms + ' ms (1 350 ms avant la correction), tronque=' + r.tronque };
  });
  await t('H10', "dates exclues au-dela du plafond : la serie est signalee « approximative », jamais affichee comme sure", () => {
    const l = []; for (let k = 0; k < 20; k++) l.push('EXDATE;TZID=Europe/Paris:' + Array(300).fill(0).map((_, i) => '2020' + String(1 + (i % 12)).padStart(2, '0') + String(1 + (i % 28)).padStart(2, '0') + 'T1' + String(k % 10) + '0000').join(','));
    const r = lire(ics(ev('UID:s', 'SUMMARY:Série', 'DTSTART;TZID=Europe/Paris:20260101T100000', 'RRULE:FREQ=DAILY', ...l)), 'demain');
    return { ok: r.tronque === true && r.evenements.length === 1 && r.evenements[0].approximatif === true, info: 'tronque=' + r.tronque + ', approximatif=' + (r.evenements[0] || {}).approximatif };
  });
  await t('H11', "BYDAY=MO,MO,MO (doublons) se comporte exactement comme BYDAY=MO", () => {
    const a = lire(ics(ev('UID:a', 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:20260105T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,MO,MO')), '2026-10-01..2026-10-31');
    const b = lire(ics(ev('UID:a', 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:20260105T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO')), '2026-10-01..2026-10-31');
    return { ok: JSON.stringify(a.evenements) === JSON.stringify(b.evenements) && a.evenements.length === 4, info: a.evenements.length + ' lundis dans les deux cas' };
  });
  await t('H12', "changement d'heure : 2h30 qui n'existe pas (28 mars 2027) et 2h30 qui existe deux fois (25 oct) -> heures valides", () => {
    const r1 = lire(ics(ev('UID:p', 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:20270328T023000')), '2027-03-28');
    const r2 = lire(ics(ev('UID:q', 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:20261025T023000')), '2026-10-25');
    const d1 = r1.evenements[0] && r1.evenements[0].debut, d2 = r2.evenements[0] && r2.evenements[0].debut;
    return { ok: !!d1 && !!d2 && !isNaN(Date.parse(d1)) && !isNaN(Date.parse(d2)) && d1.startsWith('2027-03-28T0') && d1 === '2027-03-28T01:30:00.000Z' && d2 === '2026-10-25T00:30:00.000Z', info: d1 + ' ; ' + d2 + ' (RFC 5545 : avant le trou ; premiere occurrence)' };
  });
  await t('H13', "regles invalides ou extremes (HOURLY, INTERVAL=0, COUNT=0, UNTIL avant le debut, BYDAY=9MO) : aucune panne, rien d'invente", () => {
    const cas = [['RRULE:FREQ=HOURLY', 1], ['RRULE:FREQ=DAILY;INTERVAL=0', null], ['RRULE:FREQ=DAILY;COUNT=0', 0], ['RRULE:FREQ=DAILY;UNTIL=20200101T000000Z', 0], ['RRULE:FREQ=MONTHLY;BYDAY=99MO', 1], ['RRULE:FREQ=WEEKLY;BYDAY=XX', 1]];
    const res = cas.map(([rr]) => lire(ics(ev('UID:z', 'SUMMARY:x', 'DTSTART;TZID=Europe/Paris:20260924T100000', rr)), 'demain').evenements.length);
    const ok = cas.every(([, attendu], i) => attendu === null ? res[i] >= 1 : res[i] === attendu);
    return { ok, info: res.join(' ') };
  });
  await t('H5', "fichier qui n'est pas un calendrier : refuse", () => {
    const r = A.analyserIcs('<html><body>Connexion requise</body></html>', { zone: ZONE });
    return { ok: !r.ok && r.code === 'ICS_INVALIDE', info: r.code };
  });

  /* ---------------------------------------------------------- periodes */
  await t('P1', 'periodes admises (formes fixes, cle canonique)', () => {
    const c = (x) => (A.periodeDe(x, MAINTENANT, ZONE) || {}).cle;
    const ok = c('aujourdhui') === '2026-09-23..2026-09-23' && c("aujourd'hui") === '2026-09-23..2026-09-23'
      && c('demain') === '2026-09-24..2026-09-24' && c('après-demain') === '2026-09-25..2026-09-25'
      && c('semaine') === '2026-09-23..2026-09-29' && c('semaine prochaine') === '2026-09-28..2026-10-04'
      && c('2026-10-08') === '2026-10-08..2026-10-08' && c('2026-10-01..2026-10-31') === '2026-10-01..2026-10-31';
    return { ok, info: [c('semaine prochaine'), c('2026-10-08')].join(' ; ') };
  });
  await t('P2', 'periodes refusees : joker, chemin, adresse, trop longue, date impossible, trop loin', () => {
    const refus = ['*', '../../etc/passwd', 'https://evil.com/x.ics', '2026-01-01..2026-12-31', '2026-02-30',
      '2026-09-24..2026-11-30', '2026-11-31', '2026-10-15..2026-10-01',
      '2030-01-01', '1999-01-01', 'demain; rm -rf', '', 'x'.repeat(100), 'DEMAIN..SEMAINE'];
    const passes = refus.filter(x => A.periodeDe(x, MAINTENANT, ZONE) !== null);
    return { ok: passes.length === 0 && A.periodeDe(null, MAINTENANT, ZONE) === null && A.periodeDe({ toString: () => 'demain' }, MAINTENANT, ZONE) === null,
             info: passes.length ? 'acceptees : ' + passes.join(' | ') : refus.length + '/' + refus.length + ' refusees (+ null, objet)' };
  });

  /* ---------------------------------------------------- telechargement */
  const CAL = ics(U18, ev('UID:dent', 'SUMMARY:Dentiste', 'DTSTART;TZID=Europe/Paris:20260924T183000'));
  const outil = (scenarios, opts = {}) => A.creerAgenda({ url: SECRET, get: fauxGet(scenarios), maintenant: opts.maintenant || (() => MAINTENANT), limites: opts.limites });
  const lecture = async (ag, cible = 'demain') => ag.lire(ag.permis({ action: 'READ', resource: 'AGENDA', target: cible, transactionId: 'tx_1' }));
  const tous = [];
  const garde = (r) => { tous.push(r); return r; };

  await t('F1', 'lecture reussie de bout en bout', async () => {
    const r = garde(await lecture(outil({ [SECRET]: { status: 200, corps: CAL } })));
    return { ok: r.ok && r.evenements.length === 2 && /Entraînement U18/.test(r.texte), info: r.ok ? r.evenements.length + ' evenements' : r.code };
  });
  await t('F2', 'serveur qui distille un octet a la fois : coupe au delai total', async () => {
    const morceaux = ['BEGIN:VCALENDAR\r\n'].concat(Array(50).fill('X'));
    const scen = { [SECRET]: { status: 200, morceaux, pauseMs: 100 } };
    const get = fauxGet(scen);
    const ag = A.creerAgenda({ url: SECRET, get, maintenant: () => MAINTENANT, limites: { delaiMs: 700 } });
    const d = Date.now(); const r = garde(await lecture(ag));
    return { ok: !r.ok && r.code === 'DELAI_DEPASSE' && Date.now() - d < 1500 && get.compteur.detruits >= 1, info: r.code + ' en ' + (Date.now() - d) + ' ms, requete detruite : ' + get.compteur.detruits };
  });
  await t('F3', 'fichier trop gros : coupe a 2 Mo', async () => {
    const gros = Array(30).fill('X'.repeat(100000)); gros.unshift('BEGIN:VCALENDAR\r\n');
    const r = garde(await lecture(outil({ [SECRET]: { status: 200, morceaux: gros } })));
    return { ok: !r.ok && r.code === 'TROP_VOLUMINEUX', info: r.code };
  });
  await t('F4', 'redirection vers http:// (non chiffre) ou webcal:// : refusee', async () => {
    const a = garde(await lecture(outil({ [SECRET]: { status: 302, headers: { location: 'http://evil.com/x.ics' } } })));
    const b = garde(await lecture(outil({ [SECRET]: { status: 302, headers: { location: 'webcal://evil.com/x.ics' } } })));
    return { ok: a.code === 'REDIRECTION_REFUSEE' && b.code === 'REDIRECTION_REFUSEE', info: a.code + ' / ' + b.code };
  });
  await t('F5', 'boucle de redirections : arretee apres 3', async () => {
    const s = {}; for (let i = 0; i < 6; i++) s[i ? 'https://r.test/' + i : SECRET] = { status: 302, headers: { location: 'https://r.test/' + (i + 1) } };
    const r = garde(await lecture(outil(s)));
    return { ok: r.code === 'TROP_DE_REDIRECTIONS', info: r.code };
  });
  await t('F6', 'erreur HTTP et page qui n\'est pas un calendrier', async () => {
    const a = garde(await lecture(outil({ [SECRET]: { status: 404 } })));
    const b = garde(await lecture(outil({ [SECRET]: { status: 200, corps: '<html>Connexion</html>' } })));
    return { ok: a.code === 'HTTP_404' && b.code === 'ICS_INVALIDE', info: a.code + ' / ' + b.code };
  });
  await t('F7', "l'adresse secrete n'apparait dans AUCUN resultat, reussi ou non", async () => {
    const fuite = tous.filter(r => /SECRET123|private-|calendar\.google/i.test(JSON.stringify(r)));
    return { ok: tous.length >= 7 && fuite.length === 0, info: tous.length + ' resultats examines, ' + fuite.length + ' fuite(s)' };
  });
  await t('F8', 'cache : pas de nouveau telechargement pendant 5 min, puis rafraichi', async () => {
    let now = MAINTENANT; const get = fauxGet({ [SECRET]: { status: 200, corps: CAL } });
    const ag = A.creerAgenda({ url: SECRET, get, maintenant: () => now });
    await lecture(ag); await lecture(ag); const n1 = get.compteur.n;
    now += 5 * 60 * 1000 + 1; await lecture(ag);
    return { ok: n1 === 1 && get.compteur.n === 2, info: 'appels : ' + n1 + ' puis ' + get.compteur.n };
  });
  await t('F9', 'apres un echec, pas de nouvel essai pendant 30 s (pas de martelage)', async () => {
    let now = MAINTENANT; const get = fauxGet({ [SECRET]: { status: 500 } });
    const ag = A.creerAgenda({ url: SECRET, get, maintenant: () => now });
    await lecture(ag); await lecture(ag); const n1 = get.compteur.n; now += 31000; await lecture(ag);
    return { ok: n1 === 1 && get.compteur.n === 2, info: 'appels : ' + n1 + ' puis ' + get.compteur.n };
  });
  await t('F10', 'adresses de configuration : webcal converti ; http, identifiants, charabia refuses', async () => {
    const ok = A.creerAgenda({ url: 'webcal://p01-caldav.icloud.com/published/2/abc' }).actif === true
      && A.creerAgenda({ url: 'http://calendar.google.com/x.ics' }).actif === false
      && A.creerAgenda({ url: 'https://moi:mdp@calendar.google.com/x.ics' }).actif === false
      && A.creerAgenda({ url: 'pas une adresse' }).actif === false
      && A.creerAgenda({}).actif === false;
    return { ok, info: ok ? '5/5' : 'ECHEC' };
  });

  /* ------------------------------------------------ reseau reel [R1-R4] */
  /* Certificat auto-signe, pour localhost et pour ces tests seulement. */
  const CLE_TEST = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDTgtEjM7GRL1R0
hOQ0dus3Bm/nk1cpDfSY6RiHZhNTB73IUO+szUoKCFEmTJLEO7lasSGO+pJv5WiT
47fCv02k9X5ZRAf/ioOmEpZSvUSZ7QhqaQzSKBCnATDXfBxzeKFrnrRQF18xKEwQ
uGuj7jXPv/k08MaeApCzuifbPj4Ps19P96FDn2qguUP2hxk6xqcY4RwTu70WA3UP
Jo8NwA0bf8/jlvkT01Lplwfz0Fi5VSS1hXOPCOlLcc9wQOC/khw2B2FqCjWoG/T3
O+uViTg7pJv9Ys7e+B3pmyZyher6KoSyv8V+lGOhpIVQf2KKKmGA3OBuWkKyneGs
x2wzAV8/AgMBAAECggEAFq9gKOthbxXpc/nQ1AOxJJyvIeI+peuWQVQ2ykbbabtZ
0oNDwX/fIgZUVcw+rYdOUPjQhZpAXHn5Zms1CVElTbz6yS4vwWukxQoXT1Z3Zh7z
GR6dPmkHqDHLgEESeBwHDBjgc/qdvhL5XY26FcH1yYtoehIc61ORG4WqwqwBUgOU
Ckv/ex7ysF2TsHhjMlJJi4IyC5cw7+hEU+R5o6lg4+8GN4+hub7LkvTFsQWMO7YI
vzFvd/NHCQK0RMTNv2hyH6f05DQIEZ54Zgd133RH52QRBcTvthbtBr1iy6ivvgAJ
SVEUGoP3pT1G09uERTUDhU26h5J3t6qxAKs9T0BfUQKBgQD0mXr84uhyqlMjZctL
DOw0wpFZYkkOFsoeX3vcTHAuEFCYBtXLvRHosZrQmM5ophMTW5tjI6CjRCsks6E1
08lmU+zpQKPGdYnY+Xb0zlSmZcY5/A5mYC3+6YWCtrbGCxDL4rbBlTs8OmfzhC1V
saUwr78IfE2zgV+QwJmz8IERGQKBgQDdXoemMcoYqB8a6yBpO2JWJ7Pll4IIqSeh
MmMmIWOErEaO7Cp+sEtv6MtaSlF4ketCzVMKXBVhg/P7bXFbvCziUASGNteVRQ2A
YnDfXONgD3ywGMk6UCXlinezWz2hLQYCCp9hYaSJ4HvBuQFNGgfN/xH5/N22REbH
GBfLnhxGFwKBgQDZa+BeEBjNbEdwjJiTgs4n69elm28S3gEV1IxV+4AwAgKR0GmU
q+DSdaUGzP2VGiKUr3ZFPrMYzYyIGEAxh6tbkThi8jliPLKmssEhxJKMQqVcf4gR
Smc4Uz2BPobjLYzlnwYSt2MrG0Oxu4lMxhbvWxk1IsEy0cov8nPt9dfUaQKBgQDV
rnLoRPVcuaRU2pQNoCn7GhX30DjP3WCIpFe6rc4feiAdw+/9HHWlD6SDgmuEI+5h
LEs1G8/zsmin0Wvz7f+xcSX83CFbUC2JOPzVTxeYWTq1zSco58a8/N0wvykNVKWR
AOn6GUO3Z35ucAPGhhL0kHuswJ7PWrarZiFKBlQqfwKBgD2DwjMQgw1p8qonWcrl
3ZWXTwYzR/DGDCC/d0rh9KaxV6fcKqg/Bn7QstMFTItRVrHvPraOvlGEYqMkWjSi
Qx147gt9v84YCE5/51kvnVqyFMoSSH7jEtpougCnKcM9ucCfmAzdivD+t7CIu7Cb
KeWSPBPGDKikL0E50ATqwYQq
-----END PRIVATE KEY-----`;
  const CERT_TEST = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUPggE9Et1mauJKzLXn1ekAXcrlbcwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDkyMzIzMjE0OVoXDTM2MDky
MDIzMjE0OVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA04LRIzOxkS9UdITkNHbrNwZv55NXKQ30mOkYh2YTUwe9
yFDvrM1KCghRJkySxDu5WrEhjvqSb+Vok+O3wr9NpPV+WUQH/4qDphKWUr1Eme0I
amkM0igQpwEw13wcc3iha560UBdfMShMELhro+41z7/5NPDGngKQs7on2z4+D7Nf
T/ehQ59qoLlD9ocZOsanGOEcE7u9FgN1DyaPDcANG3/P45b5E9NS6ZcH89BYuVUk
tYVzjwjpS3HPcEDgv5IcNgdhago1qBv09zvrlYk4O6Sb/WLO3vgd6ZsmcoXq+iqE
sr/FfpRjoaSFUH9iiiphgNzgblpCsp3hrMdsMwFfPwIDAQABo1MwUTAdBgNVHQ4E
FgQUCKDNfBsZxg2KpF8TFHan3/pw7YAwHwYDVR0jBBgwFoAUCKDNfBsZxg2KpF8T
FHan3/pw7YAwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAF02a
CcyA+nK3L+rReVPtW1t+zz741hZoHXF6zhivTmS1A8yF1fS5AwOiVH6uCV6M/LPN
+SIvY3+/kkHcLLBQ8EDycBr214W+iiJ8+6D0WLy2fp6j3RRe1byJjW1wflKyhPvx
DY/AoG3VxO3rnVeEj2hcZdszdyispfZgLMopWaOs5IebpymzuKLBnnTsMoBQBDWP
mg2oIRruwoARgjvUbVtF3diNU5qsQulzjph1g7hJTcv332ecS7N5jqW/AdpdnZqy
3ctQy0Q32Cm81kZ+OlLc5AyXuCbbdUp2WtC2qJMxoufcJdx+bZbilUhSiGad4UWo
GTJnZZ8q3/fp75kZRA==
-----END CERTIFICATE-----`;
  const httpsReel = require('https');
  const serveurTls = await new Promise((ok) => {
    const srv = httpsReel.createServer({ key: CLE_TEST, cert: CERT_TEST }, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(CAL); });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
  const urlTls = 'https://localhost:' + serveurTls.address().port + '/cal.ics';
  const lecteurReel = (url) => A.creerAgenda({ url, maintenant: () => MAINTENANT });
  await t('N1', "vrai DNS : domaine inexistant -> DNS_INTROUVABLE (sans l'adresse dans le resultat)", async () => {
    const r = await lecture(lecteurReel('https://jarvis-inexistant.invalid/cal.ics'));
    return { ok: r.code === 'DNS_INTROUVABLE' && !/inexistant/.test(JSON.stringify(r)), info: r.code };
  });
  await t('N2', "vrai serveur HTTPS au certificat auto-signe -> CERTIFICAT_INVALIDE, rien n'est lu", async () => {
    const r = await lecture(lecteurReel(urlTls));
    return { ok: !r.ok && r.code === 'CERTIFICAT_INVALIDE' && !r.evenements, info: r.code };
  });
  await t('N3', "meme avec NODE_TLS_REJECT_UNAUTHORIZED=0 (verification coupee pour tout Node) : REFUSE ; une requete temoin, elle, passe", async () => {
    const avant = process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const emit = process.emitWarning; process.emitWarning = () => {};
    const temoin = await new Promise((ok) => httpsReel.get(urlTls, (res) => { res.resume(); ok(res.statusCode); }).on('error', (e) => ok(e.code)));
    const r = await lecture(lecteurReel(urlTls));
    if (avant === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = avant;
    process.emitWarning = emit;
    return { ok: temoin === 200 && r.code === 'CERTIFICAT_INVALIDE', info: 'temoin sans option : ' + temoin + ' ; JARVIS : ' + r.code };
  });
  await t('N4', "vrai refus de connexion -> CONNEXION_REFUSEE", async () => {
    const r = await lecture(lecteurReel('https://localhost:1/cal.ics'));
    return { ok: r.code === 'CONNEXION_REFUSEE', info: r.code };
  });
  serveurTls.close();
  await t('N5', "reponse coupee en route (fermeture sans fin) -> REPONSE_INCOMPLETE, rien de lu a moitie", async () => {
    const get = (url, opts, cb) => { const req = new EventEmitter(); req.destroy = () => {};
      setImmediate(() => { const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; res.resume = () => {}; cb(res);
        res.emit('data', Buffer.from(CAL.slice(0, CAL.length / 2))); res.emit('close'); }); return req; };
    const r = await lecture(A.creerAgenda({ url: SECRET, get, maintenant: () => MAINTENANT }));
    return { ok: r.code === 'REPONSE_INCOMPLETE' && !r.evenements, info: r.code };
  });
  await t('N6', "longueur annoncee non tenue (Content-Length) -> REPONSE_INCOMPLETE", async () => {
    const r = await lecture(outil({ [SECRET]: { status: 200, headers: { 'content-length': String(CAL.length + 500) }, corps: CAL } }));
    return { ok: r.code === 'REPONSE_INCOMPLETE', info: r.code };
  });
  await t('N7', "calendrier sans sa ligne de fin (tronque) -> ICS_INCOMPLET, aucun evenement partiel", async () => {
    const tronque = CAL.slice(0, CAL.lastIndexOf('END:VCALENDAR'));
    const r = await lecture(outil({ [SECRET]: { status: 200, corps: tronque } }));
    return { ok: r.code === 'ICS_INCOMPLET' && !r.evenements, info: r.code };
  });
  await t('N8', "apres un echec reseau, le permis est consomme : impossible de le rejouer", async () => {
    const ag3 = outil({ [SECRET]: { status: 500 } });
    const p = ag3.permis({ action: 'READ', resource: 'AGENDA', target: 'demain' });
    const a = await ag3.lire(p), b = await ag3.lire(p);
    return { ok: !a.ok && b.code === 'PERMIS_DEJA_UTILISE', info: a.code + ' puis ' + b.code };
  });

  /* ------------------------------------------------------------ permis */
  const ag = outil({ [SECRET]: { status: 200, corps: CAL } });
  await t('K1', 'lire() sans permis, avec un objet vide, ou avec une copie imitee : refuse', async () => {
    const vrai = ag.permis({ action: 'READ', resource: 'AGENDA', target: 'demain' });
    const r = [await ag.lire(), await ag.lire({}), await ag.lire({ ...vrai }), await ag.lire(JSON.parse(JSON.stringify(vrai)))];
    return { ok: r.every(x => x.code === 'PERMIS_INCONNU'), info: r.map(x => x.code).join(' ') };
  });
  await t('K2', 'un permis ne sert qu\'une fois', async () => {
    const p = ag.permis({ action: 'READ', resource: 'AGENDA', target: 'demain' });
    const a = await ag.lire(p), b = await ag.lire(p);
    return { ok: a.ok && b.code === 'PERMIS_DEJA_UTILISE', info: (a.ok ? 'OK' : a.code) + ' puis ' + b.code };
  });
  await t('K3', 'un permis expire apres 30 s', async () => {
    let now = MAINTENANT; const ag2 = A.creerAgenda({ url: SECRET, get: fauxGet({ [SECRET]: { status: 200, corps: CAL } }), maintenant: () => now });
    const p = ag2.permis({ action: 'READ', resource: 'AGENDA', target: 'demain' }); now += 31000;
    const r = await ag2.lire(p);
    return { ok: r.code === 'PERMIS_EXPIRE', info: r.code };
  });
  await t('K4', 'pas de permis pour autre chose que READ sur AGENDA, ni pour une periode hors des formes admises', async () => {
    const essais = [{ action: 'SEND', resource: 'AGENDA', target: 'demain' }, { action: 'READ', resource: 'EMAIL', target: 'demain' },
      { action: 'READ', resource: 'AGENDA', target: '*' }, { action: 'READ', resource: 'AGENDA', target: 'https://evil.com/cal.ics' },
      { action: 'WRITE', resource: 'AGENDA', target: 'demain' }, null, undefined];
    const acceptes = essais.filter(x => { try { ag.permis(x); return true; } catch { return false; } });
    return { ok: acceptes.length === 0, info: (essais.length - acceptes.length) + '/' + essais.length + ' refuses' };
  });
  await t('K5', "un permis d'une instance ne vaut rien pour une autre", async () => {
    const autre = outil({ [SECRET]: { status: 200, corps: CAL } });
    const p = ag.permis({ action: 'READ', resource: 'AGENDA', target: 'demain' });
    const r = await autre.lire(p);
    return { ok: r.code === 'PERMIS_INCONNU', info: r.code };
  });
  await t('K6', "l'outil est gele : on ne remplace ni lire(), ni permis()", async () => {
    try { ag.lire = async () => ({ ok: true }); } catch { /* strict */ }
    try { ag.permis = () => ({}); } catch { /* strict */ }
    const r = await ag.lire({});
    return { ok: Object.isFrozen(ag) && r.code === 'PERMIS_INCONNU', info: 'gele=' + Object.isFrozen(ag) };
  });

  console.log('JARVIS — outil agenda ' + A.VERSION + '\n');
  for (const x of R) console.log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(5) + x.nom + '  [' + x.info + ']');
  const ko = R.filter(x => !x.ok).length;
  console.log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
  process.exit(ko ? 1 : 0);
})();
