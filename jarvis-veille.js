'use strict';
/* ============================================================================
 * JARVIS — veille 1.0 : l'alerte qui ne passe pas par Claude   [S131] v4.15
 * ----------------------------------------------------------------------------
 * Avec le connecteur, c'est Claude qui choisit ce qu'Alsid lit : il peut
 * resumer, oublier ou adoucir le marqueur de JARVIS (on le lui demande, rien ne
 * l'y oblige). JARVIS envoie donc ses propres notifications, sur le telephone,
 * par ntfy (une appli gratuite, un « sujet » secret) :
 *  - JARVIS_NTFY : adresse https complete d'un sujet ntfy (ex.
 *    https://ntfy.sh/<sujet>), sujet de 16 a 64 caracteres [A-Za-z0-9_-] (un nom
 *    long et aleatoire = un secret) ; ni identifiant, ni mot de passe, ni
 *    parametre, ni ancre dans l'adresse ; mal formee -> inactive, et dit ;
 *  - des PHRASES FIXES, ecrites ICI : jamais un contenu lu, une adresse, un
 *    objet ou un nom. Seuls entrent un nombre, ou une source d'une liste fermee.
 *    Le serveur de notification est externe : il ne recoit rien de prive ;
 *  - une notification par type (et par source pour une panne) et par heure,
 *    20 par jour ; un echec est compte, jamais bloquant, jamais retente.
 * Aussi : la date d'expiration declaree de la cle API (JARVIS_CLE_API_EXPIRE),
 * que JARVIS ne peut pas lire chez Anthropic.
 * ========================================================================== */
const https = require('https');

const VERSION = '1.0';
const SOURCES = Object.freeze({
  gmail_lecture: 'la lecture Gmail', gmail_envoi: "l'envoi Gmail", ical: "l'agenda principal",
  agenda_jarvis: "l'agenda JARVIS", ia: "l'IA (clé Anthropic)" });
const PHRASES = Object.freeze({
  SUSPECT_CLAUDE: (n) => (n > 1 ? n + ' mails suspects lus' : 'Un mail suspect lu') + ' par Claude : ouvre JARVIS.',
  SUSPECT_NON_LU: (n) => 'JARVIS : ' + (n > 1 ? n + ' mails suspects non lus.' : '1 mail suspect non lu.') + ' Ne réponds pas, ne clique pas, ne paie rien.',
  PANNE: (src) => 'JARVIS : ' + (SOURCES[src] || 'une source') + ' ne répond plus. Ouvre Réglages → Santé des sources.',
  EXPIRATION: (j) => j < 0 ? 'JARVIS : la clé API a expiré : JARVIS ne répond plus.' : j === 0 ? "JARVIS : la clé API expire aujourd'hui."
    : 'JARVIS : la clé API expire dans ' + j + ' jour' + (j > 1 ? 's' : '') + '.',
  COUPE: () => 'JARVIS : tout est coupé (Gmail révoqué, connecteur fermé).',
  ESSAI: () => "JARVIS : notification d'essai. Si tu la lis, les alertes arrivent."
});
const PRIORITE_HAUTE = Object.freeze(new Set(['SUSPECT_CLAUDE', 'SUSPECT_NON_LU', 'COUPE', 'EXPIRATION']));
const LIMITES = Object.freeze({ parTypeMs: 60 * 60 * 1000, parJour: 20, delaiMs: 5000, maxOctets: 64 * 1024 });

/* -> { url, motif } : url null et motif null = non reglee (inactive, rien a dire) */
function lireNtfy(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return { url: null, motif: null };
  let u; try { u = new URL(t); } catch { return { url: null, motif: 'NTFY_ILLISIBLE' }; }
  if (u.protocol !== 'https:') return { url: null, motif: 'NTFY_PAS_HTTPS' };
  if (u.username || u.password || u.search || u.hash) return { url: null, motif: 'NTFY_ILLISIBLE' };
  if (!/^\/[A-Za-z0-9_-]{16,64}$/.test(u.pathname)) return { url: null, motif: 'NTFY_SUJET_TROP_COURT' };
  return { url: u.href, motif: null };
}

/* un POST https, borne : 5 s, reponse lue a 64 Ko ; jamais d'exception */
function transportNtfy(url, corps, entetes, delaiMs) {
  return new Promise((resolve) => {
    let fini = false, req = null;
    const finir = (r) => { if (fini) return; fini = true; clearTimeout(m); if (!r.ok && req) { try { req.destroy(); } catch { /* ferme */ } } resolve(r); };
    const m = setTimeout(() => finir({ ok: false, code: 'DELAI_DEPASSE' }), delaiMs);
    try {
      const charge = Buffer.from(corps, 'utf8');
      req = https.request(url, { method: 'POST', rejectUnauthorized: true, headers: { ...entetes, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': charge.length } }, (res) => {
        let taille = 0;
        res.on('data', (c) => { taille += c.length; if (taille > LIMITES.maxOctets) finir({ ok: false, code: 'TROP_VOLUMINEUX' }); });
        res.on('end', () => finir({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, code: 'HTTP_' + res.statusCode }));
        res.on('error', () => finir({ ok: false, code: 'REPONSE_INCOMPLETE' }));
      });
      req.on('error', () => finir({ ok: false, code: 'RESEAU' }));
      req.end(charge);
    } catch { finir({ ok: false, code: 'RESEAU' }); }
  });
}

function creerNotifications({ url, transport = transportNtfy, maintenant = () => Date.now() } = {}) {
  const conf = lireNtfy(url);
  const derniers = new Map();
  const compte = { envoyees: 0, echecs: 0, retenues: 0, jour: null, aujourdhui: 0 };
  async function envoyer(type, x) {
    if (!conf.url) return { ok: false, code: conf.motif || 'INACTIF' };
    const f = PHRASES[type];
    if (!f) return { ok: false, code: 'TYPE_INCONNU' };
    const now = maintenant(), jour = new Date(now).toISOString().slice(0, 10);
    if (jour !== compte.jour) { compte.jour = jour; compte.aujourdhui = 0; }
    const src = type === 'PANNE' && Object.prototype.hasOwnProperty.call(SOURCES, x) ? x : null;
    const cle = type + (src ? ':' + src : '');
    if (type !== 'ESSAI' && (derniers.get(cle) || -Infinity) > now - LIMITES.parTypeMs) { compte.retenues++; return { ok: false, code: 'DEJA_ENVOYEE' }; }
    if (compte.aujourdhui >= LIMITES.parJour) { compte.retenues++; return { ok: false, code: 'PLAFOND_JOUR' }; }
    const n = Number.isInteger(x) ? Math.max(-999, Math.min(999, x)) : 1;
    const phrase = f(type === 'PANNE' ? src : n);
    derniers.set(cle, now); compte.aujourdhui++;
    while (derniers.size > 50) derniers.delete(derniers.keys().next().value);
    let r = null;
    try { r = await transport(conf.url, phrase, { Title: 'JARVIS', Priority: PRIORITE_HAUTE.has(type) ? 'high' : 'default', Tags: 'shield' }, LIMITES.delaiMs); } catch { r = null; }
    if (r && r.ok) compte.envoyees++; else compte.echecs++;
    return { ok: !!(r && r.ok), code: r && r.ok ? 'ENVOYEE' : (r && r.code) || 'ECHEC', phrase };
  }
  return Object.freeze({ actif: !!conf.url, motif: conf.motif, envoyer,
    etat: () => ({ actif: !!conf.url, motif: conf.motif, envoyees: compte.envoyees, echecs: compte.echecs, retenues: compte.retenues, aujourdhui: compte.aujourdhui }) });
}

/* JARVIS_CLE_API_EXPIRE=AAAA-MM-JJ -> { date, motif } */
function lireExpiration(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return { date: null, motif: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== t) return { date: null, motif: 'EXPIRATION_ILLISIBLE' };
  return { date: t, motif: null };
}
/* jours entre aujourd'hui (dans la zone) et la date : 0 = aujourd'hui, < 0 = passee */
function joursAvant(dateIso, maintenant, zone) {
  const auj = new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(maintenant));
  return Math.round((Date.parse(dateIso + 'T00:00:00Z') - Date.parse(auj + 'T00:00:00Z')) / 86400000);
}

/* [S135] le DEFI de la demo, en regle pure : une action SEND/PAY/GRANT executee vers l'adresse
 * du defi, que le visiteur n'a JAMAIS tapee (adresses comparees en minuscules) */
function defiGagne({ adresseDefi, tapees, action, cible } = {}) {
  const norme = (x) => String(x == null ? '' : x).normalize('NFC').trim().toLowerCase();
  if (!adresseDefi || !['SEND', 'PAY', 'GRANT'].includes(String(action || '').toUpperCase())) return false;
  if (norme(cible) !== norme(adresseDefi)) return false;
  return !(tapees instanceof Set && [...tapees].some(x => norme(x) === norme(adresseDefi)));
}

module.exports = Object.freeze({ VERSION, PHRASES, SOURCES, LIMITES, lireNtfy, creerNotifications, transportNtfy, lireExpiration, joursAvant, defiGagne });
