'use strict';
/* ============================================================================
 * JARVIS — domaines 1.0 : l'AGE d'un domaine, par RDAP            [S133] v4.15
 * ----------------------------------------------------------------------------
 * Un domaine utilise juste apres sa creation a bien plus de chances d'avoir
 * ete monte pour une attaque. Ce module lit la date d'enregistrement d'un
 * domaine dans l'annuaire officiel (RDAP), sans cle :
 *  - l'annuaire IANA (data.iana.org/rdap/dns.json) dit quel serveur RDAP
 *    repond pour une extension (.fr -> rdap.nic.fr, .com -> Verisign…) ;
 *  - ce serveur donne l'evenement « registration » du domaine.
 * Garde-fous : https seulement, 4 s par requete, 256 Ko au plus, 2
 * redirections https au plus, 8 domaines par lecture, cache 24 h en memoire.
 * Ce module ne decide RIEN : un domaine recent est un SIGNAL (« moyen »),
 * jamais « suspect » a lui seul ; un age non verifiable est dit « non
 * verifie », jamais « ancien ».
 * ========================================================================== */
const https = require('https');

const VERSION = '1.0';
const LIMITES_DOMAINES = Object.freeze({ delaiMs: 4000, maxOctets: 256 * 1024, cacheMs: 24 * 3600000, bootstrapMs: 24 * 3600000,
  parLecture: 8, budgetMs: 3500, redirections: 2, recentJours: 30, cacheMax: 2000 });
const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
/* suffixes a deux niveaux les plus courants (liste volontairement courte : au-dela, le
 * domaine « enregistrable » est approche par les 2 derniers niveaux, et c'est dit) */
const SUFFIXES_2 = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.tw', 'com.hk', 'co.in', 'co.za', 'co.kr', 'gouv.fr', 'asso.fr', 'nom.fr', 'presse.fr', 'tm.fr',
  'com.fr', 'gov.br', 'gc.ca', 'qc.ca', 'co.il', 'com.sg', 'com.my', 'com.pl', 'co.at', 'or.at', 'co.ma', 'com.tn', 'com.dz']);

/* « mail.pirate.co.uk » -> « pirate.co.uk » ; ASCII seulement (un domaine IDN arrive en xn--) */
function enregistrable(hote) {
  const h = String(hote || '').trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]{3,253}$/.test(h) || !h.includes('.') || /^\d+(\.\d+){3}$/.test(h)) return null;
  const p = h.split('.').filter(Boolean);
  if (p.length < 2) return null;
  const deux = p.slice(-2).join('.');
  return SUFFIXES_2.has(deux) && p.length >= 3 ? p.slice(-3).join('.') : deux;
}

function obtenirDefaut(url, L) {
  return new Promise((resolve) => {
    let fini = false, req = null;
    const finir = (r) => { if (fini) return; fini = true; clearTimeout(m); if (!r.ok && req) { try { req.destroy(); } catch { /* deja */ } } resolve(r); };
    const m = setTimeout(() => finir({ ok: false, code: 'DELAI_DEPASSE' }), L.delaiMs);
    try {
      req = https.request(url, { method: 'GET', headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': 'JARVIS-domaines/' + VERSION }, rejectUnauthorized: true }, (res) => {
        const morceaux = []; let taille = 0;
        res.on('data', (c) => { if (fini) return; taille += c.length; if (taille > L.maxOctets) return finir({ ok: false, code: 'TROP_VOLUMINEUX' }); morceaux.push(c); });
        res.on('end', () => finir({ ok: true, status: res.statusCode, location: res.headers && res.headers.location, texte: Buffer.concat(morceaux).toString('utf8') }));
        res.on('error', () => finir({ ok: false, code: 'REPONSE_INCOMPLETE' }));
      });
      req.on('error', () => finir({ ok: false, code: 'RESEAU' }));
      req.end();
    } catch { finir({ ok: false, code: 'RESEAU' }); }
  });
}

function creerDomaines({ obtenir = obtenirDefaut, maintenant = () => Date.now(), limites } = {}) {
  const L = Object.freeze({ ...LIMITES_DOMAINES, ...(limites || {}) });
  const cache = new Map();        /* domaine -> { ts, r } */
  let annuaire = null;            /* { ts, table: Map(extension -> base https) } */

  async function lireJson(url) {
    let u = url;
    for (let i = 0; i <= L.redirections; i++) {
      let x; try { x = new URL(u); } catch { return { ok: false, code: 'URL_INVALIDE' }; }
      if (x.protocol !== 'https:') return { ok: false, code: 'PAS_HTTPS' };
      const r = await obtenir(x.href, L);
      if (!r.ok) return r;
      if ([301, 302, 303, 307, 308].includes(r.status) && r.location) { u = new URL(r.location, x.href).href; continue; }
      if (r.status === 404) return { ok: false, code: 'INCONNU' };
      if (r.status !== 200) return { ok: false, code: 'HTTP_' + r.status };
      try { return { ok: true, json: JSON.parse(r.texte) }; } catch { return { ok: false, code: 'JSON_ILLISIBLE' }; }
    }
    return { ok: false, code: 'TROP_DE_REDIRECTIONS' };
  }
  async function serveurPour(ext) {
    if (!annuaire || maintenant() - annuaire.ts > L.bootstrapMs) {
      const r = await lireJson(BOOTSTRAP);
      if (!r.ok || !r.json || !Array.isArray(r.json.services)) return { ok: false, code: 'ANNUAIRE_' + (r.code || 'ILLISIBLE') };
      const table = new Map();
      for (const s of r.json.services.slice(0, 2000)) {
        if (!Array.isArray(s) || !Array.isArray(s[0]) || !Array.isArray(s[1])) continue;
        const base = s[1].find(x => typeof x === 'string' && /^https:\/\//.test(x));
        if (base) for (const e of s[0]) if (typeof e === 'string') table.set(e.toLowerCase(), base.endsWith('/') ? base : base + '/');
      }
      annuaire = { ts: maintenant(), table };
    }
    const base = annuaire.table.get(ext);
    return base ? { ok: true, base } : { ok: false, code: 'EXTENSION_SANS_RDAP' };
  }
  /* -> { ok, domaine, creeLe (AAAA-MM-JJ), jours, recent } ou { ok:false, domaine, code } (« non vérifié ») */
  async function age(hote) {
    const d = enregistrable(hote);
    if (!d) return Object.freeze({ ok: false, domaine: null, code: 'DOMAINE_INVALIDE' });
    const c = cache.get(d);
    if (c && maintenant() - c.ts < L.cacheMs) return c.r;
    const ext = d.slice(d.lastIndexOf('.') + 1);
    let r;
    const s = await serveurPour(ext);
    if (!s.ok) r = { ok: false, domaine: d, code: s.code };
    else {
      const x = await lireJson(s.base + 'domain/' + encodeURIComponent(d));
      const ev = x.ok && x.json && Array.isArray(x.json.events) ? x.json.events.find(e => e && /^registration$/i.test(String(e.eventAction || ''))) : null;
      const t = ev ? Date.parse(String(ev.eventDate || '')) : NaN;
      if (!x.ok) r = { ok: false, domaine: d, code: x.code };
      else if (!Number.isFinite(t)) r = { ok: false, domaine: d, code: 'DATE_ABSENTE' };
      else { const jours = Math.max(0, Math.floor((maintenant() - t) / 86400000));
        r = { ok: true, domaine: d, creeLe: new Date(t).toISOString().slice(0, 10), jours, recent: jours < L.recentJours }; }
    }
    r = Object.freeze(r);
    cache.set(d, { ts: maintenant(), r });
    while (cache.size > L.cacheMax) cache.delete(cache.keys().next().value);
    return r;
  }
  /* plusieurs domaines, en parallele, 8 au plus, budget total : ce qui n'a pas repondu est « non vérifié » */
  async function ages(hotes) {
    const doms = [...new Set((hotes || []).map(enregistrable).filter(Boolean))].slice(0, L.parLecture);
    const res = new Map();
    let fin = null;
    const budget = new Promise((r) => { fin = setTimeout(r, L.budgetMs); });
    await Promise.race([Promise.all(doms.map(async (d) => { res.set(d, await age(d)); })), budget]);
    clearTimeout(fin);
    for (const d of doms) if (!res.has(d)) res.set(d, Object.freeze({ ok: false, domaine: d, code: 'DELAI_DEPASSE' }));
    return res;
  }
  return Object.freeze({ age, ages, enregistrable, LIMITES: L });
}

module.exports = Object.freeze({ VERSION, creerDomaines, enregistrable, LIMITES_DOMAINES, SUFFIXES_2 });
