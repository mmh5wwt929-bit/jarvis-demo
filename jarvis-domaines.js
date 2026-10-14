'use strict';
/* ============================================================================
 * JARVIS — domaines 1.0 : l'AGE d'un domaine, par RDAP          [S132] v4.15
 * ----------------------------------------------------------------------------
 * Un domaine utilise dans les heures ou les jours qui suivent son enregistrement
 * est bien plus souvent monte pour une attaque. Ce module demande la date
 * d'enregistrement au REGISTRE (RDAP, public, sans cle) :
 *  - .com et .net (Verisign), .org (PIR), .fr (AFNIC) ; une autre extension :
 *    age inconnu, RIEN n'est affirme ;
 *  - le domaine enregistrable seulement (les deux derniers libelles), en
 *    ASCII, minuscules ; jamais un grand service (liste fermee) ;
 *  - 6 domaines au plus par appel, 3 s chacun, en parallele ; reponse lue a
 *    256 Ko ; https seulement, vers ces 4 hotes ; aucun cookie, aucun en-tete
 *    prive ; memoire 24 h (500 domaines) ; un echec n'est PAS mis en memoire ;
 *  - le resultat : { domaine -> jours } pour ceux dont la date est lue. Le
 *    CALCUL des alertes est dans jarvis-analyse.js (pur) : moins de 30 jours =
 *    alerte MOYENNE, jamais « suspect » a elle seule.
 * Ce que le registre apprend : qu'un domaine est consulte, rien d'autre.
 * ========================================================================== */
const https = require('https');

const VERSION = '1.0';
const REGISTRES = Object.freeze({
  com: 'https://rdap.verisign.com/com/v1/domain/', net: 'https://rdap.verisign.com/net/v1/domain/',
  org: 'https://rdap.publicinterestregistry.org/rdap/domain/', fr: 'https://rdap.nic.fr/domain/' });
const HOTES = Object.freeze(new Set(['rdap.verisign.com', 'rdap.publicinterestregistry.org', 'rdap.nic.fr']));
/* grands services : jamais demandes (inutile, et rien a apprendre au registre) */
const CONNUS = Object.freeze(new Set(['gmail.com', 'google.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr',
  'icloud.com', 'me.com', 'apple.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'bbox.fr', 'microsoft.com', 'amazon.com', 'amazon.fr',
  'paypal.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'github.com', 'anthropic.com', 'claude.ai', 'mistral.ai', 'ameli.fr', 'impots.gouv.fr', 'gouv.fr']));
const LIMITES = Object.freeze({ parAppel: 6, delaiMs: 3000, maxOctets: 256 * 1024, memoireMs: 24 * 3600 * 1000, memoireMax: 500, seuilJours: 30 });

/* « mail.Evil-Compta.COM. » -> « evil-compta.com » ; null si ce n'est pas un domaine lisible */
function enregistrable(d) {
  const t = String(d == null ? '' : d).trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]{3,253}$/.test(t) || t.includes('..')) return null;
  const l = t.split('.').filter(Boolean);
  if (l.length < 2 || l.some(x => x.length > 63 || x.startsWith('-') || x.endsWith('-'))) return null;
  return l.slice(-2).join('.');
}
const extension = (d) => d.split('.').pop();

function transportRdap(url, delaiMs) {
  return new Promise((resolve) => {
    let fini = false, req = null;
    const finir = (r) => { if (fini) return; fini = true; clearTimeout(m); if (!r.ok && req) { try { req.destroy(); } catch { /* ferme */ } } resolve(r); };
    const m = setTimeout(() => finir({ ok: false, code: 'DELAI_DEPASSE' }), delaiMs);
    try {
      req = https.request(url, { method: 'GET', rejectUnauthorized: true, headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': 'JARVIS-domaines/' + VERSION } }, (res) => {
        const morceaux = []; let taille = 0;
        res.on('data', (c) => { taille += c.length; if (taille > LIMITES.maxOctets) return finir({ ok: false, code: 'TROP_VOLUMINEUX' }); morceaux.push(c); });
        res.on('end', () => finir({ ok: true, status: res.statusCode, texte: Buffer.concat(morceaux).toString('utf8') }));
        res.on('error', () => finir({ ok: false, code: 'REPONSE_INCOMPLETE' }));
      });
      req.on('error', () => finir({ ok: false, code: 'RESEAU' }));
      req.end();
    } catch { finir({ ok: false, code: 'RESEAU' }); }
  });
}

/* la date d'enregistrement dans une reponse RDAP (events[].eventAction = registration) */
function dateEnregistrement(json) {
  const ev = Array.isArray(json && json.events) ? json.events : [];
  const e = ev.find(x => x && String(x.eventAction || '').toLowerCase() === 'registration' && typeof x.eventDate === 'string');
  const ms = e ? Date.parse(e.eventDate) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function creerAges({ transport = transportRdap, maintenant = () => Date.now(), actif = true } = {}) {
  const memoire = new Map();   /* domaine -> { ms, ts } */
  const compte = { demandes: 0, lus: 0, echecs: 0 };
  async function un(d) {
    const m = memoire.get(d);
    if (m && maintenant() - m.ts < LIMITES.memoireMs) return m.ms;
    const base = REGISTRES[extension(d)];
    if (!base) return null;
    const url = base + encodeURIComponent(d);
    if (!HOTES.has(new URL(url).hostname)) return null;
    compte.demandes++;
    const r = await transport(url, LIMITES.delaiMs);
    if (!r || !r.ok || r.status !== 200) { compte.echecs++; return null; }
    let json = null; try { json = JSON.parse(r.texte); } catch { json = null; }
    const ms = dateEnregistrement(json);
    if (ms === null) { compte.echecs++; return null; }
    compte.lus++;
    memoire.delete(d); memoire.set(d, { ms, ts: maintenant() });
    while (memoire.size > LIMITES.memoireMax) memoire.delete(memoire.keys().next().value);
    return ms;
  }
  /* domaines (bruts) -> Map(domaine enregistrable -> age en jours), seulement ceux dont la date est lue */
  async function ages(domaines) {
    const out = new Map();
    if (!actif) return out;
    const liste = [...new Set((domaines || []).map(enregistrable).filter(d => d && !CONNUS.has(d) && REGISTRES[extension(d)]))].slice(0, LIMITES.parAppel);
    const res = await Promise.all(liste.map(d => un(d).catch(() => null)));
    liste.forEach((d, i) => { if (res[i] !== null) out.set(d, Math.max(0, Math.floor((maintenant() - res[i]) / 86400000))); });
    return out;
  }
  return Object.freeze({ ages, etat: () => ({ actif, ...compte, memoire: memoire.size }) });
}

module.exports = Object.freeze({ VERSION, REGISTRES, CONNUS, LIMITES, enregistrable, dateEnregistrement, creerAges, transportRdap });
