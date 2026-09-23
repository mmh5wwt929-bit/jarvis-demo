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
