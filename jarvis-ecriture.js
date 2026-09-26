'use strict';
/* ============================================================================
 * JARVIS — ecriture 1.0 : un evenement dans l'agenda DEDIE « JARVIS »
 * ----------------------------------------------------------------------------
 * La premiere action REELLE et REVERSIBLE de JARVIS : creer un evenement dans
 * un agenda Google dedie, et le supprimer pour annuler.
 *
 * MOINDRE PRIVILEGE, PAR CONSTRUCTION
 *  - Un « compte de service » Google (un robot a sa propre cle) auquel la
 *    personne partage UN SEUL agenda, cree pour l'occasion. JARVIS ne peut
 *    pas toucher a l'agenda principal : il n'y a simplement pas acces.
 *  - Portee demandee : calendar.events (evenements seulement).
 *  - JAMAIS d'invites (inviter envoie un e-mail : irreversible), jamais de
 *    notification (sendUpdates=none), pas de visio. Recurrence : seulement
 *    chaque semaine, avec une fin (53 seances au plus) [1.3].
 *  - Deux hotes joignables, en https : oauth2.googleapis.com, www.googleapis.com.
 *
 * GARDE-FOUS
 *  - L'identifiant de l'evenement est DERIVE de la transaction : Google refuse
 *    un doublon de lui-meme (idempotence). Un 409 est verifie : c'est bien le
 *    notre ? alors deja cree ; sinon conflit, rien n'est ecrase.
 *  - Suppression : on relit l'evenement, on verifie qu'il porte la marque de
 *    CETTE transaction, on supprime, puis on RELIT pour prouver qu'il a
 *    disparu. Un evenement de la personne n'est jamais supprimable : son
 *    identifiant ne derive d'aucune transaction.
 *  - Permis de creation a usage unique (30 s), ne dans l'effet de la
 *    transaction autorisee (T6), comme pour la lecture d'agenda.
 *  - 20 creations par jour au plus ; dates bornees (hier .. un an) ; duree
 *    5 min .. 24 h ; titre nettoye (100 caracteres).
 *  - Aucun secret (cle, jeton d'acces, identifiant d'agenda) dans une erreur,
 *    un resultat ou un journal.
 *
 * 1.1 (v4.6.6, 25 sept) — AVANT LE PREMIER BRANCHEMENT REEL
 *  - diagnostic() : verifie la cle ET l'acces a l'agenda SANS RIEN ECRIRE
 *    (jeton, puis lecture d'un evenement ; Google renvoie le niveau d'acces du
 *    compte de service : « writer » attendu). 1 appel toutes les 20 s au plus.
 *  - Les erreurs de mise en place sont NOMMEES au lieu d'un seul
 *    « AGENDA_INACCESSIBLE » : API non activee, agenda introuvable, partage en
 *    lecture seule, cle revoquee, compte supprime, horloge ; JSON du compte mal
 *    colle (illisible / pas un compte de service / cle privee abimee).
 *
 * 1.2 (v4.6.7, 26 sept) — VU EN LIGNE
 *  - [D] diagnostic : le champ accessRole de events.list disait « lecture seule »
 *    alors que la premiere creation reelle a reussi. Il n'est plus un verdict :
 *    sa valeur BRUTE est rendue ; « writer »/« owner » = PRET ; autre chose =
 *    ECRITURE_NON_CONFIRMEE (pas « lecture seule ») ; une creation reelle
 *    reussie dans ce processus fait foi (ECRITURE_PROUVEE).
 *  - [B] lister(permis) : lecture des evenements de l'agenda JARVIS sur une
 *    periode (events.list, singleEvents), au meme format que jarvis-agenda.js ;
 *    permis de lecture a usage unique ne dans l'effet d'un READ AGENDA
 *    autorise (T6). Ce qui est lu est un contenu EXTERNE : titres et notes
 *    nettoyes et bornes, jamais des consignes.
 *
 * 1.3 (v4.8, 26 sept) — LES SERIES
 *  - Cible « AAAA-MM-JJTHH:MM|minutes|titre|HEBDO:AAAA-MM-JJ » : chaque semaine,
 *    le meme jour, de la premiere a la DERNIERE seance (date obligatoire, meme
 *    jour de la semaine, 1 a 52 semaines plus tard : 2 a 53 seances).
 *  - Chez Google : UN evenement recurrent (RRULE FREQ=WEEKLY;COUNT=n), donc une
 *    seule transaction, une seule marque, et une seule suppression qui retire
 *    toutes les seances (verifiee comme avant : l'evenement a disparu).
 *  - Une serie compte pour une creation dans le plafond de 20 par jour.
 * ========================================================================== */
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const AG = require('./jarvis-agenda.js');

const LIMITES_ECRITURE = Object.freeze({ delaiMs: 10000, maxOctets: 256 * 1024, creationsParJour: 20,
  titreMax: 100, dureeMin: 5, dureeMax: 24 * 60, joursAvant: 1, joursApres: 366, permisMs: 30 * 1000,
  maxLus: 100, lieuMax: 100, descriptionMax: 300,   /* [1.2] lecture */
  serieJoursMax: 364 });   /* [1.3] une serie : 52 semaines au plus entre la 1re et la derniere seance */
const HOTES = new Set(['oauth2.googleapis.com', 'www.googleapis.com']);
const PORTEE = 'https://www.googleapis.com/auth/calendar.events';
const B32HEX = '0123456789abcdefghijklmnopqrstuv';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function base32hex(buf) {
  let bits = 0, val = 0, out = '';
  for (const o of buf) { val = (val << 8) | o; bits += 8; while (bits >= 5) { out += B32HEX[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return out;
}
/* L'identifiant Google de l'evenement d'une transaction : [a-v0-9], stable. */
const idEvenement = (transactionId) => 'jv' + base32hex(crypto.createHash('sha256').update('jarvis-evenement|' + String(transactionId)).digest()).slice(0, 38);

/* ---- compte de service : JSON brut ou en base64 ---- */
/* [1.1] dit POURQUOI un compte est refuse (jamais son contenu) */
function examinerCompte(texte) {
  if (!texte) return { motif: 'COMPTE_ABSENT' };
  let o = null;
  for (const essai of [String(texte).trim(), (() => { try { return Buffer.from(String(texte).trim(), 'base64').toString('utf8'); } catch { return ''; } })()]) {
    try { o = JSON.parse(essai); break; } catch { /* essai suivant */ }
  }
  if (!o || typeof o !== 'object') return { motif: 'COMPTE_JSON_ILLISIBLE' };
  if (o.type !== 'service_account' || typeof o.client_email !== 'string' || typeof o.private_key !== 'string') return { motif: 'COMPTE_PAS_UN_COMPTE_DE_SERVICE' };
  try { return { compte: { email: o.client_email, cle: crypto.createPrivateKey(o.private_key), kid: typeof o.private_key_id === 'string' ? o.private_key_id : undefined } }; }
  catch { return { motif: 'COMPTE_CLE_PRIVEE_ILLISIBLE' }; }
}
function lireCompte(texte) { return examinerCompte(texte).compte || null; }

/* [1.1] Les erreurs de MISE EN PLACE, nommees depuis la reponse de Google.
 * Seuls des motifs fixes sortent d'ici, jamais le texte de Google. */
function erreurGoogle(status, json) {
  const e = json && typeof json === 'object' && json.error && typeof json.error === 'object' ? json.error : {};
  const raisons = [...(Array.isArray(e.errors) ? e.errors : []), ...(Array.isArray(e.details) ? e.details : [])]
    .map(x => String(x && x.reason || '')).join(' ');
  const message = String(e.message || '');
  if (status === 403 && (/accessNotConfigured|SERVICE_DISABLED/.test(raisons) || /has not been used|is disabled/i.test(message))) return 'API_AGENDA_NON_ACTIVEE';
  if (status === 403 && (/requiredAccessLevel/.test(raisons) || /writer access/i.test(message))) return 'AGENDA_LECTURE_SEULE';
  if (status === 404) return 'AGENDA_INTROUVABLE';
  if (status === 401 || status === 403) return 'AGENDA_INACCESSIBLE';
  if (status === 429) return 'GOOGLE_LIMITE';
  return 'GOOGLE_HTTP_' + status;
}
function erreurJeton(json) {
  const d = String(json && json.error_description || '') + ' ' + String(json && json.error || '');
  if (/account not found/i.test(d)) return 'COMPTE_GOOGLE_INTROUVABLE';
  if (/Invalid JWT Signature/i.test(d)) return 'CLE_GOOGLE_REVOQUEE';
  if (/timeframe|\biat\b|\bexp\b/i.test(d)) return 'HORLOGE_SERVEUR';
  return 'AUTH_GOOGLE_REFUSEE';
}
function jwt(compte, maintenantMs) {
  const iat = Math.floor(maintenantMs / 1000);
  const tete = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(compte.kid ? { kid: compte.kid } : {}) }));
  const corps = b64u(JSON.stringify({ iss: compte.email, scope: PORTEE, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(tete + '.' + corps), compte.cle);
  return tete + '.' + corps + '.' + b64u(sig);
}

/* ---- dates locales ---- */
const formatLocal = new Map();
function partiesLocales(ms, zone) {
  let f = formatLocal.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); formatLocal.set(zone, f); }
  const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute };
}
const deux = (n) => String(n).padStart(2, '0');
const localIso = (l) => l.y + '-' + deux(l.mo) + '-' + deux(l.d) + 'T' + deux(l.h) + ':' + deux(l.mi) + ':00';
const nettoyerTitre = (t, max) => String(t == null ? '' : t)
  .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069|]/g, ' ')
  .replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();

/* La cible canonique d'une creation : « AAAA-MM-JJTHH:MM|minutes|titre »,
 * ou pour une serie [1.3] « …|titre|HEBDO:AAAA-MM-JJ » (derniere seance).
 * Tout le reste est refuse (null). */
function validerCible(cible, maintenantMs, zone, L = LIMITES_ECRITURE) {
  if (typeof cible !== 'string' || cible.length > 220) return null;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})\s*\|\s*(\d{1,4})\s*\|(.+?)(?:\|\s*HEBDO:(\d{4})-(\d{2})-(\d{2}))?\s*$/.exec(cible);
  if (!m) return null;
  const [y, mo, d, h, mi, duree] = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59)) return null;
  const verif = new Date(Date.UTC(y, mo - 1, d));
  if (verif.getUTCFullYear() !== y || verif.getUTCMonth() !== mo - 1 || verif.getUTCDate() !== d) return null;
  if (!(duree >= L.dureeMin && duree <= L.dureeMax)) return null;
  const titre = nettoyerTitre(m[7], L.titreMax);
  if (!titre) return null;
  const debutMs = AG.versUtc(zone, y, mo, d, h, mi, 0), finMs = debutMs + duree * 60000;
  if (debutMs < maintenantMs - L.joursAvant * 86400000 || debutMs > maintenantMs + L.joursApres * 86400000) return null;
  const debut = partiesLocales(debutMs, zone), fin = partiesLocales(finMs, zone);
  /* [1.3] serie : la derniere seance, meme jour de la semaine, 1 a 52 semaines apres */
  let serie = null;
  if (m[8]) {
    const fy = +m[8], fmo = +m[9], fd = +m[10], vf = new Date(Date.UTC(fy, fmo - 1, fd));
    if (vf.getUTCFullYear() !== fy || vf.getUTCMonth() !== fmo - 1 || vf.getUTCDate() !== fd) return null;
    const ecart = Math.round((vf.getTime() - Date.UTC(y, mo - 1, d)) / 86400000);
    if (ecart < 7 || ecart > L.serieJoursMax || ecart % 7 !== 0) return null;
    serie = Object.freeze({ nb: ecart / 7 + 1, derniere: fy + '-' + deux(fmo) + '-' + deux(fd), anneeDerniere: fy });
  }
  const cle = y + '-' + deux(mo) + '-' + deux(d) + 'T' + deux(h) + ':' + deux(mi) + '|' + duree + '|' + titre + (serie ? '|HEBDO:' + serie.derniere : '');
  const heures = deux(debut.h) + ':' + deux(debut.mi) + ' → ' + deux(fin.h) + ':' + deux(fin.mi);
  let lisible;
  if (serie) {
    const dm = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' });
    const nomJour = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, weekday: 'long' }).format(new Date(debutMs));
    lisible = 'tous les ' + nomJour + 's, ' + heures + ' · ' + titre + ' · du ' + dm.format(new Date(Date.UTC(y, mo - 1, d)))
      + ' au ' + dm.format(new Date(Date.parse(serie.derniere + 'T00:00:00Z'))) + (serie.anneeDerniere !== y ? ' ' + serie.anneeDerniere : '') + ' (' + serie.nb + ' séances)';
  } else {
    const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(debutMs));
    lisible = jour + ', ' + heures + ' · ' + titre;
  }
  return Object.freeze({ cle, titre, duree, debutMs, finMs, debutLocal: localIso(debut), finLocal: localIso(fin), lisible, serie });
}

/* ---- transport https garde ---- */
function codeReseau(e) {
  const c = String((e && (e.code || e.message)) || '');
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(c)) return 'DNS_INTROUVABLE';
  if (/CERT|SELF_SIGNED|UNABLE_TO_(VERIFY|GET)|ALTNAME|ERR_TLS/.test(c)) return 'CERTIFICAT_INVALIDE';
  if (c === 'ECONNREFUSED') return 'CONNEXION_REFUSEE';
  if (/^(ECONNRESET|EPIPE|ECONNABORTED)$/.test(c)) return 'CONNEXION_COUPEE';
  return 'RESEAU';
}
function transportHttps(methode, url, entetes, corps, L) {
  return new Promise((resolve) => {
    let fini = false, req = null;
    const finir = (r) => { if (fini) return; fini = true; clearTimeout(minuteur); if (!r.ok && req) { try { req.destroy(); } catch { /* ferme */ } } resolve(r); };
    const minuteur = setTimeout(() => finir({ ok: false, code: 'DELAI_DEPASSE' }), L.delaiMs);
    try {
      req = https.request(url, { method: methode, headers: entetes, rejectUnauthorized: true }, (res) => {
        const morceaux = []; let taille = 0, termine = false;
        res.on('data', (c) => { if (fini) return; taille += c.length; if (taille > L.maxOctets) return finir({ ok: false, code: 'TROP_VOLUMINEUX' }); morceaux.push(c); });
        res.on('end', () => { termine = true; finir({ ok: true, status: res.statusCode, texte: Buffer.concat(morceaux).toString('utf8') }); });
        res.on('close', () => { if (!termine) finir({ ok: false, code: 'REPONSE_INCOMPLETE' }); });
        res.on('error', () => finir({ ok: false, code: 'REPONSE_INCOMPLETE' }));
      });
      req.on('error', (e) => finir({ ok: false, code: codeReseau(e) }));
      if (corps != null) req.write(corps);
      req.end();
    } catch { finir({ ok: false, code: 'RESEAU' }); }
  });
}

function creerEcriture({ compte, agendaId, zone = 'Europe/Paris', transport = transportHttps, maintenant = () => Date.now(), limites } = {}) {
  const L = Object.freeze({ ...LIMITES_ECRITURE, ...(limites || {}) });
  const ex = examinerCompte(compte), c = ex.compte;
  if (!c) return Object.freeze({ actif: false, motif: ex.motif });   /* [1.1] le motif precis */
  if (typeof agendaId !== 'string' || !/^[A-Za-z0-9._%+@-]{5,200}$/.test(agendaId)) return Object.freeze({ actif: false, motif: 'AGENDA_ID_INVALIDE' });
  const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(agendaId) + '/events';
  const permisEmis = new WeakMap();
  let acces = null;                     /* { jeton, expire } */
  const creations = new Map();          /* jour UTC -> nombre */

  async function appeler(methode, url, corps, jetonAcces) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOTES.has(u.hostname)) return { ok: false, code: 'HOTE_INTERDIT' };
    const entetes = { 'User-Agent': 'JARVIS-ecriture/1.3', Accept: 'application/json' };
    if (jetonAcces) entetes.Authorization = 'Bearer ' + jetonAcces;
    let charge = null;
    if (corps != null) {
      if (typeof corps === 'string') { charge = corps; entetes['Content-Type'] = 'application/x-www-form-urlencoded'; }
      else { charge = JSON.stringify(corps); entetes['Content-Type'] = 'application/json'; }
      entetes['Content-Length'] = Buffer.byteLength(charge);
    }
    const r = await transport(methode, u.href, entetes, charge, L);
    if (!r.ok) return r;
    let json = null; try { json = r.texte ? JSON.parse(r.texte) : null; } catch { json = null; }
    return { ok: true, status: r.status, json };
  }
  async function jeton() {
    if (acces && maintenant() < acces.expire) return { ok: true, jeton: acces.jeton };
    const r = await appeler('POST', 'https://oauth2.googleapis.com/token',
      'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt(c, maintenant()));
    if (!r.ok) return r;
    if (r.status !== 200 || !r.json || typeof r.json.access_token !== 'string') return { ok: false, code: erreurJeton(r.json) };   /* [1.1] */
    acces = { jeton: r.json.access_token, expire: maintenant() + Math.max(60, Math.min(3600, Number(r.json.expires_in) || 3600) - 60) * 1000 };
    return { ok: true, jeton: acces.jeton };
  }
  async function lire(id, j) {
    const r = await appeler('GET', base + '/' + id, null, j);
    if (!r.ok) return r;
    if (r.status === 404 || r.status === 410) return { ok: true, absent: true };
    if (r.status !== 200 || !r.json) return { ok: false, code: erreurGoogle(r.status, r.json) };
    return { ok: true, absent: r.json.status === 'cancelled', evenement: r.json };
  }
  const marque = (ev) => ev && ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.jarvisTx;

  /* [1.1] DIAGNOSTIC SANS RIEN ECRIRE : la cle (un jeton), puis l'agenda (lire
   * au plus UN evenement a venir). La reponse de Google porte le niveau d'acces
   * du compte de service sur cet agenda : il faut « writer » (ou « owner »). */
  let dernierDiag = null;
  let ecritureProuvee = null;           /* [1.2] date de la derniere creation reelle reussie */
  async function diagnostic() {
    if (dernierDiag && maintenant() - dernierDiag.ts < 20000) return { ...dernierDiag.r, recent: true };
    const etapes = [];
    const fin = (r) => { const x = Object.freeze({ ...r, compte: c.email, etapes: Object.freeze(etapes) }); dernierDiag = { ts: maintenant(), r: x }; return x; };
    const j = await jeton();
    etapes.push(Object.freeze({ etape: 'CLE', ok: j.ok, code: j.ok ? 'JETON_OBTENU' : j.code }));
    if (!j.ok) return fin({ ok: false, code: j.code });
    const r = await appeler('GET', base + '?maxResults=1&singleEvents=true&timeMin=' + encodeURIComponent(new Date(maintenant()).toISOString()), null, j.jeton);
    if (!r.ok) { etapes.push(Object.freeze({ etape: 'AGENDA', ok: false, code: r.code })); return fin({ ok: false, code: r.code }); }
    if (r.status !== 200 || !r.json) { const code = erreurGoogle(r.status, r.json); etapes.push(Object.freeze({ etape: 'AGENDA', ok: false, code })); return fin({ ok: false, code }); }
    /* [1.2] [D] la valeur BRUTE, jamais un verdict tire de ce seul champ */
    const brut = typeof r.json.accessRole === 'string' ? r.json.accessRole : null;
    const acces = brut && /^[a-zA-Z]{1,20}$/.test(brut) ? brut : null;
    const ecrit = acces === 'writer' || acces === 'owner';
    etapes.push(Object.freeze({ etape: 'AGENDA', ok: true, code: 'AGENDA_TROUVE' }));
    if (ecrit || ecritureProuvee) {
      etapes.push(Object.freeze({ etape: 'ECRITURE', ok: true, code: ecrit ? 'ECRITURE_PERMISE' : 'ECRITURE_PROUVEE', valeur: acces }));
      return fin({ ok: true, code: 'PRET', acces, prouvee: !!ecritureProuvee });
    }
    etapes.push(Object.freeze({ etape: 'ECRITURE', ok: null, code: 'ECRITURE_NON_CONFIRMEE', valeur: acces }));
    return fin({ ok: false, code: 'ECRITURE_NON_CONFIRMEE', acces, prouvee: false });
  }

  return Object.freeze({
    actif: true, zone, diagnostic,
    validerCible: (cible) => validerCible(cible, maintenant(), zone, L),
    idEvenement,
    /* Appele DANS l'effet d'une transaction autorisee (T6). */
    permis(action) {
      if (!action || action.action !== 'CREATE' || action.resource !== 'AGENDA_JARVIS') throw new Error('PERMIS_REFUSE');
      const v = validerCible(action.target, maintenant(), zone, L);
      if (!v || v.cle !== action.target) throw new Error('CIBLE_INVALIDE');
      const tx = String(action.transactionId || '');
      if (!/^tx_[0-9a-f-]{36}$/.test(tx)) throw new Error('TRANSACTION_INVALIDE');
      const p = Object.freeze({ cible: v, transactionId: tx, id: idEvenement(tx) });
      permisEmis.set(p, { expire: maintenant() + L.permisMs, utilise: false });
      return p;
    },
    async creer(permis) {
      const e = (permis && typeof permis === 'object') ? permisEmis.get(permis) : undefined;
      if (!e) return { ok: false, code: 'PERMIS_INCONNU' };
      if (e.utilise) return { ok: false, code: 'PERMIS_DEJA_UTILISE' };
      e.utilise = true;
      if (maintenant() > e.expire) return { ok: false, code: 'PERMIS_EXPIRE' };
      const jour = new Date(maintenant()).toISOString().slice(0, 10);
      if ((creations.get(jour) || 0) >= L.creationsParJour) return { ok: false, code: 'PLAFOND_JOURNALIER' };
      const j = await jeton(); if (!j.ok) return { ok: false, code: j.code };
      const v = permis.cible;
      const corps = { id: permis.id, summary: v.titre,
        description: 'Créé par JARVIS à ta demande (' + (v.serie ? 'série de ' + v.serie.nb + ' séances, ' : '') + 'transaction ' + permis.transactionId + ').',
        start: { dateTime: v.debutLocal, timeZone: zone }, end: { dateTime: v.finLocal, timeZone: zone },
        ...(v.serie ? { recurrence: ['RRULE:FREQ=WEEKLY;COUNT=' + v.serie.nb] } : {}),   /* [1.3] */
        extendedProperties: { private: { jarvisTx: permis.transactionId } },
        guestsCanInviteOthers: false, guestsCanModify: false, reminders: { useDefault: true } };
      const r = await appeler('POST', base + '?sendUpdates=none', corps, j.jeton);
      if (!r.ok) return { ok: false, code: r.code };
      if (r.status === 200) { creations.set(jour, (creations.get(jour) || 0) + 1); ecritureProuvee = maintenant(); dernierDiag = null; return { ok: true, code: 'CREE', preuve: permis.id }; }
      if (r.status === 409) {   /* idempotence : c'est le notre ? */
        const l = await lire(permis.id, j.jeton);
        if (l.ok && !l.absent && marque(l.evenement) === permis.transactionId) return { ok: true, code: 'DEJA_CREE', preuve: permis.id };
        return { ok: false, code: 'CONFLIT_IDENTIFIANT' };
      }
      return { ok: false, code: erreurGoogle(r.status, r.json) };   /* [1.1] */
    },
    /* [1.2] [B] LECTURE de l'agenda JARVIS : permis ne dans l'effet d'un READ
     * AGENDA autorise (T6), pour la periode exacte de la transaction. */
    permisLecture(action) {
      if (!action || action.action !== 'READ' || action.resource !== 'AGENDA') throw new Error('PERMIS_REFUSE');
      const periode = AG.periodeDe(action.target, maintenant(), zone);
      if (!periode) throw new Error('PERIODE_INVALIDE');
      const p = Object.freeze({ lecture: true, periode, transactionId: String(action.transactionId || '') });
      permisEmis.set(p, { expire: maintenant() + L.permisMs, utilise: false });
      return p;
    },
    async lister(permis) {
      const e = (permis && typeof permis === 'object' && permis.lecture === true) ? permisEmis.get(permis) : undefined;
      if (!e) return { ok: false, code: 'PERMIS_INCONNU' };
      if (e.utilise) return { ok: false, code: 'PERMIS_DEJA_UTILISE' };
      e.utilise = true;
      if (maintenant() > e.expire) return { ok: false, code: 'PERMIS_EXPIRE' };
      const j = await jeton(); if (!j.ok) return { ok: false, code: j.code };
      const pe = permis.periode;
      const r = await appeler('GET', base + '?singleEvents=true&orderBy=startTime&maxResults=' + L.maxLus
        + '&timeMin=' + encodeURIComponent(new Date(pe.debutMs).toISOString()) + '&timeMax=' + encodeURIComponent(new Date(pe.finMs).toISOString()), null, j.jeton);
      if (!r.ok) return { ok: false, code: r.code };
      if (r.status !== 200 || !r.json) return { ok: false, code: erreurGoogle(r.status, r.json) };
      const items = Array.isArray(r.json.items) ? r.json.items : [];
      const evenements = [];
      const jour = /^\d{4}-\d{2}-\d{2}$/;
      const veille = (d) => new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);   /* fin exclusive -> incluse */
      for (const it of items.slice(0, L.maxLus)) {
        if (!it || typeof it !== 'object' || it.status === 'cancelled' || !it.start || !it.end) continue;
        let ev;
        if (typeof it.start.date === 'string' && jour.test(it.start.date) && typeof it.end.date === 'string' && jour.test(it.end.date)) {
          const fin = veille(it.end.date);
          ev = { journee: true, debut: it.start.date, fin: fin < it.start.date ? it.start.date : fin };
        } else {
          const d = Date.parse(it.start.dateTime), f = Date.parse(it.end.dateTime);
          if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
          ev = { journee: false, debut: new Date(d).toISOString(), fin: new Date(Math.max(d, f)).toISOString() };
        }
        evenements.push(Object.freeze({ ...ev, titre: nettoyerTitre(it.summary, L.titreMax) || '(sans titre)',
          lieu: nettoyerTitre(it.location, L.lieuMax), description: nettoyerTitre(it.description, L.descriptionMax),
          recurrent: typeof it.recurringEventId === 'string', approximatif: false, parJarvis: !!marque(it) }));
      }
      return { ok: true, periode: pe.cle, evenements, total: evenements.length,
        tronque: typeof r.json.nextPageToken === 'string' || items.length > L.maxLus };
    },
    /* Compensation : cible = la cible gelee rendue par compensationDebut. */
    async supprimer(cible) {
      const tx = String(cible && cible.transactionId || '');
      if (!cible || cible.action !== 'CREATE' || cible.resource !== 'AGENDA_JARVIS' || !/^tx_[0-9a-f-]{36}$/.test(tx)) return { ok: false, verifie: false, code: 'CIBLE_INVALIDE' };
      const id = idEvenement(tx);
      const j = await jeton(); if (!j.ok) return { ok: false, verifie: false, code: j.code };
      const avant = await lire(id, j.jeton);
      if (!avant.ok) return { ok: false, verifie: false, code: avant.code };
      if (!avant.absent) {
        if (marque(avant.evenement) !== tx) return { ok: false, verifie: false, code: 'PAS_UN_EVENEMENT_JARVIS' };
        const d = await appeler('DELETE', base + '/' + id + '?sendUpdates=none', null, j.jeton);
        if (!d.ok) return { ok: false, verifie: false, code: d.code };
        if (![200, 204, 404, 410].includes(d.status)) return { ok: false, verifie: false, code: erreurGoogle(d.status, d.json) };
      }
      const apres = await lire(id, j.jeton);   /* la preuve : il a disparu */
      if (!apres.ok) return { ok: false, verifie: false, code: apres.code };
      return { ok: apres.absent, verifie: apres.absent === true, code: apres.absent ? (avant.absent ? 'DEJA_SUPPRIME' : 'SUPPRIME') : 'TOUJOURS_PRESENT', preuve: id };
    }
  });
}

module.exports = { creerEcriture, validerCible, idEvenement, lireCompte, examinerCompte, erreurGoogle, erreurJeton, jwt, base32hex, LIMITES_ECRITURE, HOTES, VERSION: '1.3' };
