'use strict';
/* ============================================================================
 * JARVIS — tests des outils v4.6 : elevation (Face ID / code) et ecriture
 * Google (agenda dedie).     node tests-outils.js
 * Face ID : un FAUX APPAREIL (vraie paire de cles P-256, authenticatorData et
 * CBOR construits octet par octet). Google : un faux service qui imite l'API.
 * ========================================================================== */
const crypto = require('crypto');
const EL = require('./jarvis-elevation.js');
const EC = require('./jarvis-ecriture.js');

const R = [];
const t = async (id, nom, f) => { let r; try { r = await f(); } catch (e) { r = { ok: false, info: 'EXCEPTION ' + e.message }; } R.push({ id, nom, ok: !!r.ok, info: r.info }); };
const b64u = EL.b64u;
const sha = (b) => crypto.createHash('sha256').update(b).digest();

/* ---- mini encodeur CBOR pour le faux appareil ---- */
function cbor(v) {
  const tete = (maj, n) => n < 24 ? Buffer.from([maj << 5 | n]) : n < 256 ? Buffer.from([maj << 5 | 24, n]) : Buffer.from([maj << 5 | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([tete(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([tete(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
}
function appareil() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  return { privateKey, cose, idCle: crypto.randomBytes(32) };
}
const authData = (rpId, flags, compteur, cred) => {
  const base = Buffer.concat([sha(Buffer.from(rpId)), Buffer.from([flags]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(compteur); return b; })()]);
  if (!cred) return base;
  const n = Buffer.alloc(2); n.writeUInt16BE(cred.idCle.length);
  return Buffer.concat([base, Buffer.alloc(16), n, cred.idCle, cbor(cred.cose)]);
};
const clientData = (type, challenge, origin) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
const RP = 'dianinou.onrender.com', ORIG = 'https://dianinou.onrender.com';

(async () => {
  /* ============================ ELEVATION ============================ */
  let now = Date.parse('2026-09-24T10:00:00Z');
  const ap = appareil();
  const reg = EL.creerElevation({ maintenant: () => now });
  const dc = reg.defiCreation('s1', RP);
  const attObj = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(RP, 0x45, 0, ap)]]));
  const vc = reg.verifierCreation('s1', RP, { id: b64u(ap.idCle), clientDataJSON: b64u(clientData('webauthn.create', dc.options.challenge, ORIG)), attestationObject: b64u(attObj) });
  await t('F1', "enregistrement Face ID : la cle publique extraite est prete a coller dans Render", async () =>
    ({ ok: vc.ok && typeof vc.identifiant === 'string' && EL.lirePasskeys(vc.identifiant).size === 1, info: vc.ok ? 'identifiant de ' + vc.identifiant.length + ' caracteres' : vc.motif }));
  const el = EL.creerElevation({ passkeys: vc.identifiant, code: '482913576104', maintenant: () => now });
  let compteur = 0;
  const assertion = (o = {}) => {
    const d = o.defi !== undefined ? { options: { challenge: o.defi } } : el.defiAssertion(o.session || 's1', RP, '1.2.3.4');
    const cd = clientData(o.type || 'webauthn.get', d.options ? d.options.challenge : 'x', o.origin || ORIG);
    const ad = authData(o.rp || RP, o.flags === undefined ? 0x05 : o.flags, o.compteur === undefined ? ++compteur : o.compteur);
    const sig = crypto.sign('sha256', Buffer.concat([ad, sha(o.cdSignee || cd)]), ap.privateKey);
    return { id: o.id || b64u(ap.idCle), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(o.sig || sig) };
  };
  await t('F2', 'Face ID valide : elevation accordee', async () => { const r = el.verifierAssertion('s1', RP, '1.2.3.4', assertion()); return { ok: r.ok && r.mode === 'FACE_ID', info: r.ok ? r.mode : r.motif }; });
  /* Les cles d'acces synchronisees par iCloud renvoient un compteur TOUJOURS a 0 :
   * sur iPhone, seul le defi a usage unique empeche le rejeu. On le prouve ainsi. */
  const elZ = EL.creerElevation({ passkeys: vc.identifiant, maintenant: () => now });
  const dZ = elZ.defiAssertion('sZ', RP, '1.2.3.4');
  const a1 = assertion({ defi: dZ.options.challenge, compteur: 0 });
  const premier = elZ.verifierAssertion('sZ', RP, '1.2.3.4', a1);
  await t('F3', "reponse rejouee avec un compteur a 0 (comme un iPhone) : refusee par le defi a usage unique", async () => {
    const r = elZ.verifierAssertion('sZ', RP, '1.2.3.4', a1);
    return { ok: premier.ok && !r.ok && r.motif === 'FACE_ID_REFUSE_DEFI', info: 'premier ' + premier.ok + ' ; rejeu ' + r.motif };
  });
  const attaques = [
    ['mauvais defi', { defi: b64u(crypto.randomBytes(32)) }],
    ['mauvaise origine (site piege)', { origin: 'https://evil.example' }],
    ['mauvais site (rpId)', { rp: 'evil.example' }],
    ['presence sans verification (UV absent)', { flags: 0x01 }],
    ['signature d\'autre chose', { cdSignee: Buffer.from('autre chose') }],
    ['cle inconnue', { id: b64u(crypto.randomBytes(32)) }],
    ['type « create » au lieu de « get »', { type: 'webauthn.create' }]];
  const resA = [];
  for (const [nom, o] of attaques) { const e2 = EL.creerElevation({ passkeys: vc.identifiant, maintenant: () => now }); const d = e2.defiAssertion('s9', RP, '9.9.9.9');
    const x = assertion({ ...o, defi: o.defi || d.options.challenge }); resA.push([nom, e2.verifierAssertion('s9', RP, '9.9.9.9', x)]); }
  await t('F4', "7 attaques sur la reponse Face ID : toutes refusees", async () => ({ ok: resA.every(([, r]) => !r.ok), info: resA.map(([n, r]) => r.ok ? 'PASSE:' + n : r.motif.replace('FACE_ID_REFUSE_', '')).join(' ') }));
  await t('F5', 'defi expire (plus de 2 min) : refuse', async () => {
    const d = el.defiAssertion('s2', RP, '1.2.3.4'); now += 3 * 60 * 1000;
    const r = el.verifierAssertion('s2', RP, '1.2.3.4', assertion({ defi: d.options.challenge })); now -= 3 * 60 * 1000;
    return { ok: !r.ok, info: r.motif };
  });
  await t('F6', 'compteur de signatures qui recule (appareil clone) : refuse', async () => {
    const r1 = el.verifierAssertion('s3', RP, '1.2.3.4', assertion({ session: 's3', compteur: 50 }));
    const r2 = el.verifierAssertion('s3', RP, '1.2.3.4', assertion({ session: 's3', compteur: 49 }));
    return { ok: r1.ok && !r2.ok, info: (r1.ok ? 'OK' : r1.motif) + ' puis ' + r2.motif };
  });
  await t('F7', '5 echecs en 15 min : blocage, meme une vraie reponse est refusee ensuite', async () => {
    const e3 = EL.creerElevation({ passkeys: vc.identifiant, maintenant: () => now });
    for (let i = 0; i < 5; i++) { const d = e3.defiAssertion('s4', RP, '5.5.5.5'); e3.verifierAssertion('s4', RP, '5.5.5.5', assertion({ defi: d.options.challenge, origin: 'https://evil.example' })); }
    const d = e3.defiAssertion('s4', RP, '5.5.5.5');
    return { ok: !d.ok && d.motif === 'TROP_D_ECHECS', info: d.motif || 'defi accorde' };
  });
  await t('F8', "enregistrement refuse : Face ID non verifie, ou algorithme autre que P-256", async () => {
    const e4 = EL.creerElevation({ maintenant: () => now });
    const d1 = e4.defiCreation('s5', RP);
    const r1 = e4.verifierCreation('s5', RP, { clientDataJSON: b64u(clientData('webauthn.create', d1.options.challenge, ORIG)),
      attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(RP, 0x41, 0, ap)]]))) });
    const d2 = e4.defiCreation('s5', RP); const rsa = { ...ap, cose: new Map([[1, 3], [3, -257], [-1, Buffer.alloc(256)], [-2, Buffer.from([1, 0, 1])]]) };
    const r2 = e4.verifierCreation('s5', RP, { clientDataJSON: b64u(clientData('webauthn.create', d2.options.challenge, ORIG)),
      attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(RP, 0x45, 0, rsa)]]))) });
    return { ok: !r1.ok && !r2.ok, info: r1.motif + ' / ' + r2.motif };
  });
  await t('F9', 'CBOR piege (imbrication profonde, longueur geante) : refuse sans plantage', async () => {
    let profond = Buffer.from([0x81]); for (let i = 0; i < 30; i++) profond = Buffer.concat([Buffer.from([0x81]), profond]);
    const geant = Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff]);
    const r = [profond, geant].map(b => { try { EL.decoderCbor(b); return 'ACCEPTE'; } catch (e) { return e.message; } });
    return { ok: r.every(x => x !== 'ACCEPTE'), info: r.join(' ') };
  });
  await t('F10', 'code de secours : bon code accepte ; faux codes bloques a 5 ; code trop court non configure', async () => {
    const ok = el.verifierCode('s6', '6.6.6.6', '482913576104').ok;
    for (let i = 0; i < 5; i++) el.verifierCode('s7', '7.7.7.7', '000000');
    const bloque = el.verifierCode('s7', '7.7.7.7', '482913576104');
    const court = EL.creerElevation({ code: '123' }).codeSecours;
    return { ok: ok && !bloque.ok && bloque.motif === 'TROP_D_ECHECS' && court === false, info: 'bon ' + ok + ', apres 5 faux : ' + bloque.motif + ', code court configure : ' + court };
  });
  await t('F11', 'JARVIS_PASSKEYS avec des entrees illisibles : ignorees, les bonnes gardees', async () =>
    ({ ok: EL.lirePasskeys('xxx,' + vc.identifiant + ',{{{,').size === 1, info: EL.lirePasskeys('xxx,' + vc.identifiant + ',{{{,').size + ' cle(s)' }));

  /* ============================ ECRITURE ============================ */
  const { privateKey: cleRsa, publicKey: pubRsa } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const COMPTE = JSON.stringify({ type: 'service_account', client_email: 'jarvis@projet.iam.gserviceaccount.com', private_key_id: 'kid123',
    private_key: cleRsa.export({ type: 'pkcs8', format: 'pem' }) });
  const AGENDA = 'c_abc123secret@group.calendar.google.com';
  const NOW = Date.parse('2026-09-24T10:00:00Z');
  function fauxGoogle() {
    const evts = new Map(), appels = [];
    const transport = async (methode, url, entetes, corps) => {
      appels.push({ methode, url, entetes, corps });
      const u = new URL(url);
      if (u.hostname === 'oauth2.googleapis.com') return { ok: true, status: 200, texte: JSON.stringify({ access_token: 'ya29.JETON-SECRET', expires_in: 3600 }) };
      if (entetes.Authorization !== 'Bearer ya29.JETON-SECRET') return { ok: true, status: 401, texte: '{}' };
      const m = /\/events(?:\/([^/?]+))?/.exec(u.pathname); const id = m && m[1];
      if (methode === 'POST') { const b = JSON.parse(corps); if (evts.has(b.id)) return { ok: true, status: 409, texte: '{}' }; evts.set(b.id, { ...b, status: 'confirmed' }); return { ok: true, status: 200, texte: JSON.stringify(evts.get(b.id)) }; }
      if (methode === 'GET') { const e = evts.get(id); if (!e) return { ok: true, status: 404, texte: '{}' }; return { ok: true, status: 200, texte: JSON.stringify(e) }; }
      if (methode === 'DELETE') { const e = evts.get(id); if (!e || e.status === 'cancelled') return { ok: true, status: 410, texte: '' }; e.status = 'cancelled'; return { ok: true, status: 204, texte: '' }; }
      return { ok: true, status: 400, texte: '{}' };
    };
    return { evts, appels, transport };
  }
  const tx = () => 'tx_' + crypto.randomUUID();
  const action = (cible, o = {}) => ({ action: 'CREATE', resource: 'AGENDA_JARVIS', target: cible, transactionId: o.tx || tx(), ...o });
  const tous = [];
  const garde = (r) => { tous.push(r); return r; };

  await t('W1', 'cibles admises, canonisees ; cibles refusees (date impossible, duree, passe, trop loin, titre vide)', async () => {
    const e = EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA, maintenant: () => NOW, transport: fauxGoogle().transport });
    const bon = e.validerCible('2026-09-25T18:30|90|Entraînement U18');
    const refus = ['2026-02-30T10:00|60|x', '2026-09-25T18:30|0|x', '2026-09-25T18:30|2000|x', '2026-09-20T10:00|60|x', '2028-01-01T10:00|60|x',
      '2026-09-25T18:30|60|   ', '2026-09-25T25:00|60|x', 'demain 18h|60|x', '2026-09-25T18:30|60|\u0007\u202E'].filter(x => e.validerCible(x) !== null);
    return { ok: bon && bon.cle === '2026-09-25T18:30|90|Entraînement U18' && bon.debutLocal === '2026-09-25T18:30:00' && bon.finLocal === '2026-09-25T20:00:00' && refus.length === 0,
             info: (bon && bon.lisible) + (refus.length ? ' ; ACCEPTEES : ' + refus.join(', ') : ' ; 9/9 refusees') };
  });
  const G = fauxGoogle();
  const ecr = EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA, maintenant: () => NOW, transport: G.transport });
  const a1c = action('2026-09-25T18:30|90|Entraînement U18');
  const c1 = garde(await ecr.creer(ecr.permis(a1c)));
  const post = G.appels.find(x => x.methode === 'POST' && /events/.test(x.url)); const corps = JSON.parse(post.corps);
  await t('W2', "creation : aucun invite, aucune notification, identifiant derive de la transaction, marque JARVIS", async () =>
    ({ ok: c1.ok && !('attendees' in corps) && /sendUpdates=none/.test(post.url) && corps.id === EC.idEvenement(a1c.transactionId)
        && corps.extendedProperties.private.jarvisTx === a1c.transactionId && corps.start.timeZone === 'Europe/Paris' && corps.guestsCanInviteOthers === false,
       info: c1.code + ' ; id ' + corps.id.slice(0, 12) + '… ; invites : ' + ('attendees' in corps ? 'OUI' : 'aucun') }));
  await t('W3', "jeton d'acces : JWT RS256 verifiable, portee « calendar.events » seulement", async () => {
    const tok = G.appels.find(x => /oauth2/.test(x.url)); const jw = decodeURIComponent(/assertion=([^&]+)/.exec(tok.corps)[1]).split('.');
    const claims = JSON.parse(Buffer.from(jw[1], 'base64url')); const valide = crypto.verify('RSA-SHA256', Buffer.from(jw[0] + '.' + jw[1]), pubRsa, Buffer.from(jw[2], 'base64url'));
    return { ok: valide && claims.scope === 'https://www.googleapis.com/auth/calendar.events' && claims.aud === 'https://oauth2.googleapis.com/token' && claims.exp - claims.iat === 3600, info: 'signature ' + valide + ', portee ' + claims.scope.split('/').pop() };
  });
  await t('W4', "idempotence : la meme transaction recreee -> Google refuse le doublon, reconnu comme « deja cree »", async () => {
    const r = garde(await ecr.creer(ecr.permis({ ...a1c })));
    return { ok: r.ok && r.code === 'DEJA_CREE' && G.evts.size === 1, info: r.code + ', evenements : ' + G.evts.size };
  });
  await t('W5', "identifiant deja pris par un evenement SANS la marque JARVIS : conflit, rien n'est ecrase", async () => {
    const a = action('2026-09-26T10:00|30|Test'); G.evts.set(EC.idEvenement(a.transactionId), { id: 'x', status: 'confirmed', summary: 'a moi' });
    const r = garde(await ecr.creer(ecr.permis(a)));
    return { ok: !r.ok && r.code === 'CONFLIT_IDENTIFIANT' && G.evts.get(EC.idEvenement(a.transactionId)).summary === 'a moi', info: r.code };
  });
  await t('W6', "permis : autre action, autre ressource, cible non canonique, transaction invalide -> refuses ; usage unique ; objet imite", async () => {
    const essais = [{ ...a1c, action: 'DELETE' }, { ...a1c, resource: 'AGENDA' }, { ...a1c, target: '2026-09-25T18:30 | 90 | Entraînement U18' }, { ...a1c, transactionId: '../x' }];
    const acceptes = essais.filter(x => { try { ecr.permis(x); return true; } catch { return false; } });
    const p = ecr.permis(action('2026-09-27T09:00|45|Réunion')); await ecr.creer(p); const bis = await ecr.creer(p); const imite = await ecr.creer({ ...p });
    return { ok: acceptes.length === 0 && bis.code === 'PERMIS_DEJA_UTILISE' && imite.code === 'PERMIS_INCONNU', info: (4 - acceptes.length) + '/4 refuses ; ' + bis.code + ' ; ' + imite.code };
  });
  await t('W7', "suppression : verifie la marque, supprime, puis PROUVE la disparition ; deja supprime = verifie aussi", async () => {
    const r1 = garde(await ecr.supprimer({ action: 'CREATE', resource: 'AGENDA_JARVIS', transactionId: a1c.transactionId }));
    const r2 = garde(await ecr.supprimer({ action: 'CREATE', resource: 'AGENDA_JARVIS', transactionId: a1c.transactionId }));
    return { ok: r1.verifie === true && r1.code === 'SUPPRIME' && r2.verifie === true && r2.code === 'DEJA_SUPPRIME', info: r1.code + ' puis ' + r2.code };
  });
  await t('W8', "impossible de supprimer un evenement qui n'est pas de JARVIS (marque absente ou d'une autre transaction)", async () => {
    const a = action('2026-09-28T09:00|45|x'); G.evts.set(EC.idEvenement(a.transactionId), { status: 'confirmed', extendedProperties: { private: { jarvisTx: 'tx_autre' } } });
    const r = garde(await ecr.supprimer({ action: 'CREATE', resource: 'AGENDA_JARVIS', transactionId: a.transactionId }));
    const r2 = garde(await ecr.supprimer({ action: 'DELETE', resource: 'AGENDA', transactionId: a.transactionId }));
    return { ok: !r.verifie && r.code === 'PAS_UN_EVENEMENT_JARVIS' && !r2.verifie, info: r.code + ' ; ' + r2.code };
  });
  await t('W9', "agenda non partage (403) et Google qui refuse le jeton : codes clairs, rien de cree", async () => {
    const t403 = async (m, url) => /oauth2/.test(url) ? { ok: true, status: 200, texte: '{"access_token":"x","expires_in":3600}' } : { ok: true, status: 403, texte: '{}' };
    const t400 = async () => ({ ok: true, status: 400, texte: '{"error":"invalid_grant"}' });
    const r1 = garde(await EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA, maintenant: () => NOW, transport: t403 }).creer((e => e.permis(action('2026-09-25T18:30|60|x')))(EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA, maintenant: () => NOW, transport: t403 }))));
    const e2 = EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA, maintenant: () => NOW, transport: t400 });
    const r2 = garde(await e2.creer(e2.permis(action('2026-09-25T18:30|60|x'))));
    const e1 = EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA, maintenant: () => NOW, transport: t403 });
    const r3 = garde(await e1.creer(e1.permis(action('2026-09-25T18:30|60|x'))));
    return { ok: r3.code === 'AGENDA_INACCESSIBLE' && r2.code === 'AUTH_GOOGLE_REFUSEE', info: r3.code + ' ; ' + r2.code + ' ; ' + r1.code };
  });
  await t('W10', 'plafond : 20 creations par jour, la 21e est refusee', async () => {
    const g = fauxGoogle(); const e = EC.creerEcriture({ compte: COMPTE, agendaId: AGENDA, maintenant: () => NOW, transport: g.transport });
    let dernier; for (let i = 0; i < 21; i++) dernier = await e.creer(e.permis(action('2026-09-25T18:30|60|n' + i)));
    return { ok: !dernier.ok && dernier.code === 'PLAFOND_JOURNALIER' && g.evts.size === 20, info: dernier.code + ', crees ' + g.evts.size };
  });
  await t('W11', "un seul jeton d'acces pour plusieurs creations (cache), et seuls les deux hotes Google sont appeles", async () => {
    const hotes = [...new Set(G.appels.map(x => new URL(x.url).hostname))];
    return { ok: G.appels.filter(x => /oauth2/.test(x.url)).length === 1 && hotes.every(h => EC.HOTES.has(h)), info: 'jetons demandes : ' + G.appels.filter(x => /oauth2/.test(x.url)).length + ' ; hotes : ' + hotes.join(', ') };
  });
  await t('W12', "aucun secret dans les resultats : cle privee, jeton d'acces, identifiant d'agenda", async () => {
    const j = JSON.stringify(tous);
    const fuites = ['BEGIN PRIVATE KEY', 'JETON-SECRET', 'abc123secret', 'kid123'].filter(x => j.includes(x));
    return { ok: tous.length >= 8 && fuites.length === 0, info: tous.length + ' resultats, fuites : ' + (fuites.join(' ') || 'aucune') };
  });
  await t('W13', 'compte de service invalide ou identifiant d\'agenda douteux : outil inactif', async () => {
    const a = EC.creerEcriture({ compte: '{"type":"user"}', agendaId: AGENDA }).actif, b = EC.creerEcriture({ compte: COMPTE, agendaId: '../../x y' }).actif;
    const c = EC.creerEcriture({ compte: Buffer.from(COMPTE).toString('base64'), agendaId: AGENDA }).actif;
    return { ok: a === false && b === false && c === true, info: 'compte faux ' + a + ', agenda douteux ' + b + ', base64 accepte ' + c };
  });

  console.log('JARVIS — outils v4.6 : elevation ' + EL.VERSION + ', ecriture ' + EC.VERSION + '\n');
  for (const x of R) console.log((x.ok ? 'OK    ' : 'ECHEC ') + x.id.padEnd(5) + x.nom + '  [' + x.info + ']');
  const ko = R.filter(x => !x.ok).length;
  console.log('\n>>> ' + (R.length - ko) + '/' + R.length + ' tests passent');
  process.exit(ko ? 1 : 0);
})();
