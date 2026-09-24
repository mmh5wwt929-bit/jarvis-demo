'use strict';
/* ============================================================================
 * JARVIS — elevation 1.0 : Face ID (cles d'acces / WebAuthn) et code de secours
 * ----------------------------------------------------------------------------
 * Pour confirmer une action IRREVERSIBLE, la couche exige une elevation
 * recente (15 min au plus). Ce module la prouve :
 *  - FACE_ID : une cle d'acces (passkey) creee sur l'iPad ou l'iPhone. La cle
 *    privee ne quitte jamais l'appareil ; le serveur ne connait que la cle
 *    publique, que la personne colle UNE fois dans la variable Render
 *    JARVIS_PASSKEYS. C'est Render qui fait foi : sans acces au compte Render,
 *    personne ne peut ajouter sa propre cle.
 *  - CODE : un code de secours (JARVIS_CODE_SECOURS), si Face ID manque.
 *
 * CE QUI EST VERIFIE A CHAQUE FACE ID
 *  - defi aleatoire (32 octets), a usage unique, valable 2 min, lie a la session ;
 *  - type « webauthn.get », origine exacte, empreinte du site (rpId) exacte ;
 *  - presence (UP) ET verification (UV) de la personne par l'appareil ;
 *  - signature ECDSA P-256 sur authenticatorData || SHA-256(clientDataJSON) ;
 *  - compteur de signatures qui ne recule pas (quand l'appareil en fournit un) ;
 *  - 5 echecs en 15 min : blocage (session ET adresse).
 * Aucune dependance : CBOR minimal borne, crypto de Node.
 * ========================================================================== */
const crypto = require('crypto');

const LIMITES_ELEVATION = Object.freeze({ defiMs: 2 * 60 * 1000, echecsMax: 5, fenetreEchecsMs: 15 * 60 * 1000,
  dureeMs: 15 * 60 * 1000, maxDefis: 2000, maxCbor: 4096, maxProfondeur: 8 });

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{0,20000}$/.test(s)) throw new Error('BASE64URL');
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
};
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

/* ---- CBOR minimal (types 0-5, 7), borne en taille et en profondeur ---- */
function decoderCbor(buf, L = LIMITES_ELEVATION) {
  if (!Buffer.isBuffer(buf) || buf.length > L.maxCbor) throw new Error('CBOR_TAILLE');
  let i = 0;
  const lire = (n) => { if (i + n > buf.length) throw new Error('CBOR_TRONQUE'); const r = buf.subarray(i, i + n); i += n; return r; };
  const longueur = (info) => {
    if (info < 24) return info;
    if (info === 24) return lire(1)[0];
    if (info === 25) return lire(2).readUInt16BE(0);
    if (info === 26) return lire(4).readUInt32BE(0);
    throw new Error('CBOR_LONGUEUR');
  };
  const item = (p) => {
    if (p > L.maxProfondeur) throw new Error('CBOR_PROFONDEUR');
    const o = lire(1)[0], maj = o >> 5, info = o & 31;
    switch (maj) {
      case 0: return longueur(info);
      case 1: return -1 - longueur(info);
      case 2: return Buffer.from(lire(longueur(info)));
      case 3: return lire(longueur(info)).toString('utf8');
      case 4: { const n = longueur(info); if (n > 64) throw new Error('CBOR_TABLEAU'); const a = []; for (let k = 0; k < n; k++) a.push(item(p + 1)); return a; }
      case 5: { const n = longueur(info); if (n > 64) throw new Error('CBOR_TABLE'); const m = new Map(); for (let k = 0; k < n; k++) { const c = item(p + 1); m.set(c, item(p + 1)); } return m; }
      case 7: if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; throw new Error('CBOR_SIMPLE');
      default: throw new Error('CBOR_TYPE');
    }
  };
  const v = item(0);
  return { valeur: v, fin: i };
}

/* ---- authenticatorData ---- */
function lireAuthData(ad, avecCle) {
  if (!Buffer.isBuffer(ad) || ad.length < 37) throw new Error('AUTHDATA_COURT');
  const r = { rpIdHash: ad.subarray(0, 32), flags: ad[32], compteur: ad.readUInt32BE(33) };
  if (avecCle) {
    if (!(r.flags & 0x40)) throw new Error('AUTHDATA_SANS_CLE');
    if (ad.length < 55) throw new Error('AUTHDATA_COURT');
    const n = ad.readUInt16BE(53);
    if (n < 16 || n > 1023 || ad.length < 55 + n + 1) throw new Error('AUTHDATA_ID');
    r.idCle = ad.subarray(55, 55 + n);
    const cose = decoderCbor(ad.subarray(55 + n));
    r.cose = cose.valeur;
  }
  return r;
}
/* COSE EC2 P-256 / ES256 -> JWK */
function coseVersJwk(m) {
  if (!(m instanceof Map)) throw new Error('COSE_FORMAT');
  if (m.get(1) !== 2 || m.get(3) !== -7 || m.get(-1) !== 1) throw new Error('COSE_ALGORITHME');
  const x = m.get(-2), y = m.get(-3);
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('COSE_POINT');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) };
  crypto.createPublicKey({ key: jwk, format: 'jwk' });   /* point sur la courbe, sinon exception */
  return jwk;
}

/* JARVIS_PASSKEYS = liste separee par des virgules de « b64u(JSON {id,x,y}) » */
function lirePasskeys(texte) {
  const out = new Map();
  for (const brut of String(texte || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10)) {
    try {
      const o = JSON.parse(deB64u(brut).toString('utf8'));
      if (typeof o.id !== 'string' || typeof o.x !== 'string' || typeof o.y !== 'string') continue;
      const jwk = { kty: 'EC', crv: 'P-256', x: o.x, y: o.y };
      out.set(o.id, { id: o.id, cle: crypto.createPublicKey({ key: jwk, format: 'jwk' }) });
    } catch { /* entree illisible : ignoree */ }
  }
  return out;
}

function creerElevation({ passkeys, code, rpId, origine, maintenant = () => Date.now(), limites } = {}) {
  const L = Object.freeze({ ...LIMITES_ELEVATION, ...(limites || {}) });
  const cles = lirePasskeys(passkeys);
  const codeOk = typeof code === 'string' && /^\S{6,64}$/.test(code) ? sha256(Buffer.from(code, 'utf8')) : null;
  const defis = new Map();       /* sessionId -> { defi, type, expire } */
  const echecs = new Map();      /* cle (session ou adresse) -> [horodatages] */
  const compteurs = new Map();   /* id de cle -> dernier compteur vu */

  const site = (hote) => {
    const h = String(rpId || hote || '').toLowerCase().replace(/:\d+$/, '');
    if (!/^[a-z0-9.-]{1,253}$/.test(h)) return null;
    return { rpId: h, origine: origine || ('https://' + h) };
  };
  const purger = () => { const t = maintenant(); for (const [k, v] of defis) if (v.expire < t) defis.delete(k); };
  const bloque = (...cs) => { const t = maintenant(); return cs.some(c => (echecs.get(c) || []).filter(x => t - x < L.fenetreEchecsMs).length >= L.echecsMax); };
  const echec = (motif, ...cs) => { const t = maintenant(); for (const c of cs) { const l = (echecs.get(c) || []).filter(x => t - x < L.fenetreEchecsMs); l.push(t); echecs.set(c, l.slice(-20)); } return Object.freeze({ ok: false, motif }); };
  const prendreDefi = (sessionId, type) => {
    const d = defis.get(sessionId); defis.delete(sessionId);          /* usage unique, meme en cas d'echec */
    if (!d || d.type !== type || d.expire < maintenant()) return null;
    return d.defi;
  };
  const lireClientData = (b64, type, attendu, s) => {
    const brut = deB64u(b64); if (brut.length > 2048) throw new Error('CLIENTDATA_TAILLE');
    const c = JSON.parse(brut.toString('utf8'));
    if (c.type !== type) throw new Error('CLIENTDATA_TYPE');
    if (typeof c.challenge !== 'string' || !attendu || c.challenge.length !== attendu.length
        || !crypto.timingSafeEqual(Buffer.from(c.challenge), Buffer.from(attendu))) throw new Error('DEFI');
    if (c.origin !== s.origine) throw new Error('ORIGINE');
    if (c.crossOrigin === true) throw new Error('ORIGINE_CROISEE');
    return brut;
  };
  const nouveauDefi = (sessionId, type) => {
    purger();
    if (defis.size >= L.maxDefis) return null;
    const defi = b64u(crypto.randomBytes(32));
    defis.set(sessionId, { defi, type, expire: maintenant() + L.defiMs });
    return defi;
  };

  return Object.freeze({
    actif: cles.size > 0 || !!codeOk, faceId: cles.size > 0, codeSecours: !!codeOk, dureeMs: L.dureeMs,

    /* ---- enregistrement d'une cle (sa cle publique sera collee dans Render) ---- */
    defiCreation(sessionId, hote) {
      const s = site(hote); if (!s) return Object.freeze({ ok: false, motif: 'SITE_INVALIDE' });
      const defi = nouveauDefi(String(sessionId), 'creation'); if (!defi) return Object.freeze({ ok: false, motif: 'TROP_DE_DEFIS' });
      return Object.freeze({ ok: true, options: {
        challenge: defi, rp: { name: 'JARVIS', id: s.rpId },
        user: { id: b64u(crypto.randomBytes(16)), name: 'jarvis', displayName: 'JARVIS' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000, attestation: 'none',
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        excludeCredentials: [...cles.keys()].map(id => ({ type: 'public-key', id })) } });
    },
    verifierCreation(sessionId, hote, r) {
      const s = site(hote); if (!s) return Object.freeze({ ok: false, motif: 'SITE_INVALIDE' });
      try {
        const attendu = prendreDefi(String(sessionId), 'creation');
        lireClientData(r && r.clientDataJSON, 'webauthn.create', attendu, s);
        const att = decoderCbor(deB64u(r.attestationObject)).valeur;
        if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new Error('ATTESTATION');
        const ad = lireAuthData(att.get('authData'), true);
        if (!crypto.timingSafeEqual(ad.rpIdHash, sha256(Buffer.from(s.rpId)))) throw new Error('RPID');
        if (!(ad.flags & 0x01) || !(ad.flags & 0x04)) throw new Error('UV');
        const jwk = coseVersJwk(ad.cose);
        const id = b64u(ad.idCle);
        if (typeof r.id === 'string' && r.id !== id) throw new Error('ID');
        return Object.freeze({ ok: true, identifiant: b64u(JSON.stringify({ id, x: jwk.x, y: jwk.y })) });
      } catch (e) { return Object.freeze({ ok: false, motif: 'ENREGISTREMENT_REFUSE_' + String(e && e.message || 'ERREUR').slice(0, 30) }); }
    },

    /* ---- Face ID : prouver la presence de la personne ---- */
    defiAssertion(sessionId, hote, adresse) {
      if (!cles.size) return Object.freeze({ ok: false, motif: 'FACE_ID_NON_CONFIGURE' });
      if (bloque('s:' + sessionId, 'a:' + adresse)) return Object.freeze({ ok: false, motif: 'TROP_D_ECHECS' });
      const s = site(hote); if (!s) return Object.freeze({ ok: false, motif: 'SITE_INVALIDE' });
      const defi = nouveauDefi(String(sessionId), 'assertion'); if (!defi) return Object.freeze({ ok: false, motif: 'TROP_DE_DEFIS' });
      return Object.freeze({ ok: true, options: { challenge: defi, rpId: s.rpId, timeout: 60000, userVerification: 'required',
        allowCredentials: [...cles.keys()].map(id => ({ type: 'public-key', id })) } });
    },
    verifierAssertion(sessionId, hote, adresse, r) {
      const ks = ['s:' + sessionId, 'a:' + adresse];
      if (bloque(...ks)) return Object.freeze({ ok: false, motif: 'TROP_D_ECHECS' });
      const s = site(hote); if (!s) return echec('SITE_INVALIDE', ...ks);
      try {
        const attendu = prendreDefi(String(sessionId), 'assertion');
        const c = cles.get(r && r.id); if (!c) throw new Error('CLE_INCONNUE');
        const brut = lireClientData(r.clientDataJSON, 'webauthn.get', attendu, s);
        const adBrut = deB64u(r.authenticatorData); const ad = lireAuthData(adBrut, false);
        if (!crypto.timingSafeEqual(ad.rpIdHash, sha256(Buffer.from(s.rpId)))) throw new Error('RPID');
        if (!(ad.flags & 0x01) || !(ad.flags & 0x04)) throw new Error('UV');
        const signe = crypto.verify('sha256', Buffer.concat([adBrut, sha256(brut)]), { key: c.cle, dsaEncoding: 'der' }, deB64u(r.signature));
        if (!signe) throw new Error('SIGNATURE');
        const avant = compteurs.get(c.id) || 0;
        if ((ad.compteur !== 0 || avant !== 0) && ad.compteur <= avant) throw new Error('COMPTEUR');
        compteurs.set(c.id, ad.compteur);
        return Object.freeze({ ok: true, mode: 'FACE_ID' });
      } catch (e) { return echec('FACE_ID_REFUSE_' + String(e && e.message || 'ERREUR').slice(0, 30), ...ks); }
    },

    /* ---- code de secours ---- */
    verifierCode(sessionId, adresse, saisi) {
      const ks = ['s:' + sessionId, 'a:' + adresse];
      if (!codeOk) return Object.freeze({ ok: false, motif: 'CODE_NON_CONFIGURE' });
      if (bloque(...ks)) return Object.freeze({ ok: false, motif: 'TROP_D_ECHECS' });
      if (typeof saisi !== 'string' || saisi.length > 64) return echec('CODE_REFUSE', ...ks);
      if (!crypto.timingSafeEqual(sha256(Buffer.from(saisi, 'utf8')), codeOk)) return echec('CODE_REFUSE', ...ks);
      return Object.freeze({ ok: true, mode: 'CODE' });
    }
  });
}

module.exports = { creerElevation, decoderCbor, lireAuthData, coseVersJwk, lirePasskeys, b64u, deB64u, LIMITES_ELEVATION, VERSION: '1.0' };
