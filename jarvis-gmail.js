'use strict';
/* ============================================================================
 * JARVIS — gmail 1.1 : envoyer (vers une liste fermee) et lire, sur le compte
 * d'essai JARVIS, avec deux droits SEPARES                    [S68] [S69] v4.9
 * 1.1 (v4.9.1) : client OAuth en JSON OU en ID + SECRET, colle tolere depuis
 *   un iPhone, motifs precis [S77] ; mailto() et verification sans liste
 *   fermee pour « Ouvrir dans Mail » [S75]
 * 1.2 (v4.10) : les CONVERSATIONS (lireFils) [S80] ; la REPONSE dans une
 *   conversation, hors liste fermee mais verifiee contre le fil avant l'envoi,
 *   puis dans les Envoyes apres (permisReponse, envoyerReponse) [S81]
 * 1.3 (v4.10.1) : [S86] l'authentification lue par GMAIL : le PREMIER en-tete
 *   Authentication-Results seulement (Gmail l'ajoute en tete a la reception ;
 *   ceux d'en dessous viennent de l'expediteur, falsifiables), et seulement
 *   s'il est signe « mx.google.com » ; [S85] References gardees (identifiants
 *   <…> valides) : avant, nettoyer() les rendait illisibles et la reponse ne
 *   portait que In-Reply-To ; [S91] lireFils lit 4 conversations a la fois.
 * ----------------------------------------------------------------------------
 * MOINDRE PRIVILEGE, PAR CONSTRUCTION
 *  - Deux jetons OAuth (refresh tokens) du compte d'essai, obtenus a part :
 *      JARVIS_GMAIL_ENVOI   : portee gmail.send SEULE (envoyer, rien lire) ;
 *      JARVIS_GMAIL_LECTURE : portee gmail.readonly SEULE (lire, rien envoyer).
 *    La portee reellement accordee est VERIFIEE a chaque jeton d'acces (champ
 *    « scope » de Google) : une portee en plus ou en moins = refus. Le meme
 *    jeton pour les deux = refus (les droits ne se melangent pas). Si Google
 *    fusionne les droits d'un meme client (autorisation « incrementale »), le
 *    2e jeton sort avec les deux portees : il est refuse, et un 2e client
 *    OAuth pour lire (JARVIS_GMAIL_CLIENT_LECTURE, facultatif) les separe.
 *  - Destinataires : UNIQUEMENT JARVIS_MAIL_AUTORISES (10 adresses au plus).
 *    Toute autre adresse est refusee ici, quel que soit ce qui a ete confirme
 *    avant (Face ID compris). Une liste illisible desactive l'envoi.
 *  - Contenu : texte brut seulement (jamais de piece jointe, jamais de HTML) ;
 *    tout lien doit figurer dans les mots TAPES par la personne (sinon refus :
 *    un lien venu d'un contenu lu ne part jamais) ; ni caractere de controle,
 *    ni caractere invisible ou d'inversion de sens d'ecriture ; objet encode
 *    (RFC 2047) : aucune injection d'en-tete possible.
 *  - Permis d'envoi a usage unique (30 s), ne DANS l'effet de la transaction
 *    autorisee (T6) ; il porte l'empreinte du contenu (spec.tool de la couche,
 *    donc du defi Face ID) : le texte envoye est celui qui a ete confirme.
 *  - Plafond d'envois par jour (JARVIS_MAIL_PLAFOND, 5 par defaut, 1 a 20),
 *    compte a la TENTATIVE. Jamais de nouvel essai automatique : une reponse
 *    perdue = RESULTAT_INCERTAIN (verifier les Envoyes), pas un doublon.
 *  - Preuve : l'identifiant du message renvoye par Google.
 *  - Deux hotes, en https : oauth2.googleapis.com, gmail.googleapis.com.
 *  - Aucun secret (client, jetons) dans une erreur, un resultat ou un journal.
 * LECTURE
 *  - 5 messages au plus de la boite de reception (recents ou non lus), texte
 *    nettoye et borne (1 200 caracteres par message) : un CONTENU EXTERNE,
 *    remis au serveur qui le declare a la couche avant tout modele.
 * ========================================================================== */
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const VERSION = '1.3';
const LIMITES_MAIL = Object.freeze({ delaiMs: 12000, maxOctets: 1024 * 1024, permisMs: 30 * 1000,
  objetMax: 150, texteMax: 3000, autorisesMax: 10, plafondDefaut: 5, plafondMax: 20,
  lusMax: 5, extraitMax: 1200, diagnosticMs: 20000, lectureTotaleMs: 20000,
  filsMax: 15, messagesParFil: 10, texteFil: 2500, joursFils: 14,   /* [S80] v4.10 les conversations */
  lecturesParallele: 4 });   /* [S91] v4.10.1 */
const HOTES = new Set(['oauth2.googleapis.com', 'gmail.googleapis.com']);
const PORTEE_ENVOI = 'https://www.googleapis.com/auth/gmail.send';
const PORTEE_LECTURE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FILTRES = Object.freeze({ recents: 'labelIds=INBOX', 'non-lus': 'labelIds=INBOX&q=' + encodeURIComponent('is:unread') });

/* ---- adresses : ASCII, nom@domaine.tld (meme contrat que server.js [S36]) ---- */
function adresseValide(x) {
  if (typeof x !== 'string' || x.length > 254) return false;
  const m = /^([A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*)@([A-Za-z0-9.-]+)$/.exec(x);
  if (!m || m[1].length > 64) return false;
  const e = m[2].split('.');
  if (e.length < 2 || !e.every(x => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(x))) return false;
  return /^(?:[A-Za-z]{2,24}|xn--[A-Za-z0-9-]{1,59})$/.test(e[e.length - 1]);
}
const cleAdresse = (a) => String(a).toLowerCase();

/* ---- configuration : dit POURQUOI elle est refusee, jamais son contenu ---- */
/* [S77] v4.9.1 — colle depuis un iPhone (editeur de variables de Render) :
 * guillemets courbes “ ” ou « » (ponctuation « intelligente »), espaces,
 * retours a la ligne ou « / » en trop. On retire ce qui ne peut PAS faire
 * partie de la valeur (un ID ou un secret n'a ni blanc, ni guillemet, ni « / »
 * au bord) ; le reste est verifie tel quel. Deux formes : le JSON du client
 * (JARVIS_GMAIL_CLIENT), ou ID + SECRET a part (…_CLIENT_ID, …_CLIENT_SECRET).
 * Le motif dit CE QUI cloche (JSON, ID ou SECRET), jamais la valeur. */
const droitsGuillemets = (t) => String(t == null ? '' : t).replace(/«[\s\u00A0\u202F]*/g, '"').replace(/[\s\u00A0\u202F]*»/g, '"')
  .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"').replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'");
const BLANCS = /[\s\u00A0\u202F\u200B-\u200D\u2060\uFEFF]+/g;
const valeurPropre = (v) => droitsGuillemets(v).replace(BLANCS, '').replace(/^["'\/]+|["'\/]+$/g, '');
const jetonPropre = (v) => v == null ? '' : droitsGuillemets(v).replace(BLANCS, '').replace(/^["']+|["']+$/g, '');   /* un jeton commence par « 1// » */
const RE_CLIENT_ID = /^[A-Za-z0-9._-]{8,200}\.apps\.googleusercontent\.com$/, RE_CLIENT_SECRET = /^[A-Za-z0-9._~+\/=-]{8,200}$/;
const present = (v) => v != null && String(v).trim() !== '';
function paireClient(id, secret, prefixe) {
  if (!id) return { motif: prefixe + '_ID_ABSENT' };
  if (!secret) return { motif: prefixe + '_SECRET_ABSENT' };
  if (!RE_CLIENT_ID.test(id)) return { motif: prefixe + '_ID_ILLISIBLE' };
  if (!RE_CLIENT_SECRET.test(secret)) return { motif: prefixe + '_SECRET_ILLISIBLE' };
  return { client: Object.freeze({ id, secret }) };
}
function lireClient(texte, id, secret, prefixe = 'CLIENT') {
  const aJson = present(texte), aPaire = present(id) || present(secret);
  if (!aJson && !aPaire) return { motif: prefixe + '_ABSENT' };
  let parJson = null;
  if (aJson) {
    const brut = droitsGuillemets(texte).trim();
    let o = null;
    for (const essai of [brut, (() => { try { return Buffer.from(brut, 'base64').toString('utf8'); } catch { return ''; } })()]) {
      try { o = JSON.parse(essai); break; } catch { /* essai suivant */ }
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { motif: prefixe + '_JSON_ILLISIBLE' };
    const c = o.web && typeof o.web === 'object' ? o.web : o.installed && typeof o.installed === 'object' ? o.installed : o;
    parJson = paireClient(typeof c.client_id === 'string' ? valeurPropre(c.client_id) : '', typeof c.client_secret === 'string' ? valeurPropre(c.client_secret) : '', prefixe);
    if (!aPaire) return parJson;
  }
  const parPaire = paireClient(valeurPropre(id), valeurPropre(secret), prefixe);
  if (!aJson) return parPaire;
  /* les deux formes a la fois : acceptees seulement si elles disent la meme chose */
  return parJson.client && parPaire.client && parJson.client.id === parPaire.client.id && parJson.client.secret === parPaire.client.secret
    ? parPaire : { motif: prefixe + '_EN_DOUBLE' };
}
const JETON_OK = /^[A-Za-z0-9._~+\/=-]{20,2048}$/;
function lireAutorises(texte) {
  const brut = droitsGuillemets(texte).split(/[\s,;]+/).map(x => x.trim().replace(/^["']+|["']+$/g, '')).filter(Boolean);
  if (!brut.length) return { motif: 'LISTE_VIDE' };
  if (brut.length > LIMITES_MAIL.autorisesMax || !brut.every(adresseValide)) return { motif: 'LISTE_ILLISIBLE' };
  return { liste: Object.freeze([...new Set(brut.map(cleAdresse))]) };
}
function lirePlafond(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { plafond: LIMITES_MAIL.plafondDefaut };
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= LIMITES_MAIL.plafondMax ? { plafond: n } : { motif: 'PLAFOND_ILLISIBLE' };
}

/* ---- le contenu : ce qui part, verifie ---- */
const INTERDITS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
/* les liens d'un texte : adresses web et noms de domaine (un client de
 * messagerie les rend cliquables) ; les adresses e-mail n'en sont pas */
function liensDe(texte) {
  const t = String(texte == null ? '' : texte).replace(/[^\s<>()«»"',;]+@[^\s<>()«»"',;]+/g, ' ');
  const out = new Set();
  for (const m of t.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'«»]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]+)(?::\d+)?(?:\/[^\s<>"'«»]*)?/gi))
    out.add(m[0].replace(/[.,;:!?)\]]+$/, '').toLowerCase());
  return [...out].filter(Boolean);
}
const empreinteContenu = (a, objet, texte) => crypto.createHash('sha256').update(JSON.stringify(['jarvis-mail-1', cleAdresse(a), objet, texte])).digest('hex');
/* ce que la personne a tape donne les liens permis ; rien d'autre */
/* [S75] listeFermee: false pour « Ouvrir dans Mail » : la personne envoie
 * elle-meme depuis son application, a l'adresse qu'elle a tapee ; tout le
 * reste (liens tapes seulement, caracteres, longueurs) est verifie pareil. */
function verifierContenu({ a, objet, texte, liensPermis }, autorises, { listeFermee = true } = {}) {
  if (!adresseValide(a)) return { ok: false, code: 'ADRESSE_INVALIDE' };
  if (listeFermee && !(Array.isArray(autorises) && autorises.includes(cleAdresse(a)))) return { ok: false, code: 'HORS_LISTE' };
  if (typeof objet !== 'string' || typeof texte !== 'string') return { ok: false, code: 'CONTENU_ILLISIBLE' };
  const o = objet.trim(), x = texte.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!o || o.length > LIMITES_MAIL.objetMax || /[\r\n\t]/.test(o) || INTERDITS.test(o)) return { ok: false, code: 'OBJET_INVALIDE' };
  if (!x || x.length > LIMITES_MAIL.texteMax || INTERDITS.test(x)) return { ok: false, code: 'TEXTE_INVALIDE' };
  const permis = new Set((Array.isArray(liensPermis) ? liensPermis : []).map(l => String(l).toLowerCase()));
  const etranger = liensDe(o + '\n' + x).find(l => !permis.has(l));
  if (etranger) return { ok: false, code: 'LIEN_NON_TAPE', lien: etranger.slice(0, 80) };
  const empreinte = empreinteContenu(a, o, x);
  return { ok: true, brouillon: Object.freeze({ a, objet: o, texte: x, liensPermis: Object.freeze([...permis]),
    empreinte, outil: 'GMAIL:' + empreinte.slice(0, 40) }) };
}

/* [S75] « OUVRIR DANS MAIL » : le lien mailto: d'un brouillon VERIFIE, construit
 * ICI (RFC 6068). Tout est encode par encodeURIComponent (? & # % + et sauts de
 * ligne compris, en %0D%0A) ; seul « @ » reste lisible dans l'adresse. Rien
 * n'est envoye : la personne relit dans son application et envoie elle-meme. */
function mailto(b) {
  if (!b || typeof b !== 'object' || !adresseValide(b.a) || typeof b.objet !== 'string' || typeof b.texte !== 'string') return null;
  return 'mailto:' + encodeURIComponent(b.a).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(b.objet)
    + '&body=' + encodeURIComponent(b.texte.replace(/\r?\n/g, '\r\n'));
}

/* ---- le message brut (RFC 5322), construit ICI, jamais par le modele ---- */
function motEncode(objet) {
  const morceaux = []; let cur = '';
  for (const ch of objet) {
    if (Buffer.byteLength(cur + ch) > 45) { morceaux.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) morceaux.push(cur);
  return morceaux.map(m => '=?UTF-8?B?' + Buffer.from(m, 'utf8').toString('base64') + '?=').join('\r\n ');
}
function messageBrut(b, transactionId) {
  const corps = Buffer.from(b.texte.replace(/\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  /* [S81] une REPONSE porte In-Reply-To et References (verifies : <…> sans blanc) : Gmail la range dans la conversation */
  const fil = b.inReplyTo && RE_MESSAGE_ID.test(b.inReplyTo) ? ['In-Reply-To: ' + b.inReplyTo,
    'References: ' + String(b.references || b.inReplyTo).split(/\s+/).filter(x => RE_MESSAGE_ID.test(x)).slice(-10).join(' ')] : [];
  return ['To: ' + b.a, 'Subject: ' + motEncode(b.objet), ...fil, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', 'X-JARVIS-Transaction: ' + transactionId, '', corps].join('\r\n');
}
const RE_MESSAGE_ID = /^<[^<>\s"]{3,300}>$/;
const RE_FIL = /^[0-9a-fA-F]{6,40}$/;
/* [S81] une REPONSE : le contenu verifie comme un e-mail (sans liste fermee : la
 * personne repond a l'expediteur d'une conversation, verifie par le module au
 * moment d'envoyer), plus la conversation et le message auxquels elle repond,
 * dans l'empreinte : le permis ne vaut que pour CETTE reponse, dans CE fil. */
function verifierReponse({ a, objet, texte, liensPermis, filId, inReplyTo, references }) {
  if (!RE_FIL.test(String(filId || '')) || !RE_MESSAGE_ID.test(String(inReplyTo || ''))) return { ok: false, code: 'FIL_INVALIDE' };
  const v = verifierContenu({ a, objet, texte, liensPermis }, [], { listeFermee: false });
  if (!v.ok) return v;
  const refs = String(references || '').split(/\s+/).filter(x => RE_MESSAGE_ID.test(x)).slice(-9);
  if (!refs.includes(inReplyTo)) refs.push(inReplyTo);
  const empreinte = crypto.createHash('sha256').update(JSON.stringify(['jarvis-reponse-1', cleAdresse(a), v.brouillon.objet, v.brouillon.texte, filId, inReplyTo])).digest('hex');
  return { ok: true, brouillon: Object.freeze({ ...v.brouillon, filId, inReplyTo, references: refs.join(' '), empreinte, outil: 'GMAIL-REP:' + empreinte.slice(0, 40) }) };
}

/* ---- [S80] v4.10 LES CONVERSATIONS : en-tetes, pieces jointes, partie nouvelle ---- */
/* « =?UTF-8?B?…?= » et « =?UTF-8?Q?…?= » (RFC 2047), au cas ou Google les laisse */
function decoderEntete(v) {
  return String(v == null ? '' : v).replace(/=\?([\w-]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, x) => {
    try {
      const octets = /b/i.test(enc) ? Buffer.from(x, 'base64') : Buffer.from(x.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (z, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return /utf-?8/i.test(cs) ? octets.toString('utf8') : octets.toString('latin1');
    } catch { return m; }
  });
}
/* « Luc Martin <luc@club.fr>, "X, Y" <x@y.fr>, z@w.fr » -> [{ nom, adresse }] (adresses valables seulement) */
function adressesDe(v) {
  const t = decoderEntete(v), out = [];
  const re = /(?:"([^"]*)"|([^,<>"]*?))\s*<([^<>\s]+@[^<>\s]+)>|([^\s,;<>"]+@[^\s,;<>"]+)/g;
  let m;
  while ((m = re.exec(t)) && out.length < 20) {
    const adresse = cleAdresse(m[3] || m[4] || ''), nom = String(m[1] || m[2] || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (adresseValide(adresse)) out.push({ nom, adresse });
  }
  return out;
}
function piecesDe(payload) {
  const out = [];
  const visiter = (p, prof) => {
    if (!p || typeof p !== 'object' || prof > 8 || out.length >= 10) return;
    if (p.filename) { out.push({ nom: nettoyer(p.filename, 80), type: nettoyer(p.mimeType || '', 60), taille: Number(p.body && p.body.size) || 0 }); return; }
    if (Array.isArray(p.parts)) for (const x of p.parts.slice(0, 30)) visiter(x, prof + 1);
  };
  visiter(payload, 0);
  return out;
}
/* la partie NOUVELLE d'un message : sans l'historique cite (« Le … a ecrit : », lignes « > », message d'origine) */
function partieNouvelle(texte) {
  const lignes = String(texte || '').replace(/\r\n?/g, '\n').split('\n'), garde = [];
  for (const l of lignes) {
    if (/^\s*(le|on)\s.{3,160}(a écrit|a ecrit|wrote)\s*:?\s*$/i.test(l) || /^\s*-{2,}\s*(original message|message d'origine|forwarded message|message transféré|message transfere)/i.test(l)
        || /^\s*_{5,}\s*$/.test(l)) break;
    if (/^\s*>/.test(l)) continue;
    garde.push(l);
  }
  return garde.join('\n');
}
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---- la lecture : un contenu EXTERNE, nettoye et borne ---- */
const b64uDecode = (s) => { try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; } };
const nettoyer = (v, max) => String(v == null ? '' : v)
  .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ')
  .replace(/</g, '‹').replace(/>/g, '›').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
function texteDe(payload) {
  let plain = null, html = null, pj = 0;
  const visiter = (p, prof) => {
    if (!p || typeof p !== 'object' || prof > 8) return;
    if (p.filename) { pj++; return; }
    const t = String(p.mimeType || '').toLowerCase();
    if (t === 'text/plain' && plain === null && p.body && p.body.data) plain = b64uDecode(p.body.data);
    else if (t === 'text/html' && html === null && p.body && p.body.data) html = b64uDecode(p.body.data);
    if (Array.isArray(p.parts)) for (const x of p.parts.slice(0, 30)) visiter(x, prof + 1);
  };
  visiter(payload, 0);
  const brut = plain !== null ? plain : html !== null ? html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
  return { texte: brut, piecesJointes: pj };
}
const entete = (m, nom) => { const h = ((m.payload || {}).headers || []).find(x => x && String(x.name).toLowerCase() === nom); return h ? String(h.value || '') : ''; };

/* ---- transport https garde (le meme principe que ecriture 1.x) ---- */
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
    let fini = false, req = null, parti = false;
    const finir = (r) => { if (fini) return; fini = true; clearTimeout(minuteur); if (!r.ok && req) { try { req.destroy(); } catch { /* ferme */ } } resolve({ ...r, parti }); };
    const minuteur = setTimeout(() => finir({ ok: false, code: 'DELAI_DEPASSE' }), L.delaiMs);
    try {
      req = https.request(url, { method: methode, headers: entetes, rejectUnauthorized: true }, (res) => {
        parti = true;
        const morceaux = []; let taille = 0, termine = false;
        res.on('data', (c) => { if (fini) return; taille += c.length; if (taille > L.maxOctets) return finir({ ok: false, code: 'TROP_VOLUMINEUX' }); morceaux.push(c); });
        res.on('end', () => { termine = true; finir({ ok: true, status: res.statusCode, texte: Buffer.concat(morceaux).toString('utf8') }); });
        res.on('close', () => { if (!termine) finir({ ok: false, code: 'REPONSE_INCOMPLETE' }); });
        res.on('error', () => finir({ ok: false, code: 'REPONSE_INCOMPLETE' }));
      });
      req.on('error', (e) => finir({ ok: false, code: codeReseau(e) }));
      if (corps != null) req.write(corps);
      req.end(); parti = true;
    } catch { finir({ ok: false, code: 'RESEAU' }); }
  });
}

/* Google : des motifs fixes, jamais son texte */
function erreurGmail(status, json) {
  const e = json && typeof json === 'object' && json.error && typeof json.error === 'object' ? json.error : {};
  const raisons = [...(Array.isArray(e.errors) ? e.errors : []), ...(Array.isArray(e.details) ? e.details : [])].map(x => String(x && x.reason || '')).join(' ');
  const message = String(e.message || '');
  if (status === 403 && (/accessNotConfigured|SERVICE_DISABLED/.test(raisons) || /has not been used|is disabled/i.test(message))) return 'API_GMAIL_NON_ACTIVEE';
  if (status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(raisons + ' ' + message)) return 'PORTEE_INSUFFISANTE';
  if (status === 401) return 'JETON_REFUSE';
  if (status === 429 || (status === 403 && /rateLimit|userRateLimit|dailyLimit/i.test(raisons))) return 'GOOGLE_LIMITE';
  if (status === 400) return 'MESSAGE_REFUSE_PAR_GOOGLE';
  if (status === 404) return 'INTROUVABLE';
  return 'GOOGLE_HTTP_' + status;
}
function erreurJeton(json) {
  const d = String(json && json.error || '') + ' ' + String(json && json.error_description || '');
  if (/invalid_client|unauthorized_client/i.test(d)) return 'CLIENT_REFUSE';
  if (/invalid_grant/i.test(d)) return 'JETON_REVOQUE_OU_EXPIRE';
  return 'AUTH_GOOGLE_REFUSEE';
}

function creerMail({ client, clientId, clientSecret, clientLecture, clientLectureId, clientLectureSecret, envoi, lecture, autorises, plafond,
  zone = 'Europe/Paris', transport = transportHttps, maintenant = () => Date.now(), limites } = {}) {
  const L = Object.freeze({ ...LIMITES_MAIL, ...(limites || {}) });
  const cl = lireClient(client, clientId, clientSecret, 'CLIENT');   /* [S77] JSON, ou ID + SECRET */
  /* un 2e client OAuth pour lire, s'il est donne ; sinon le meme */
  const clL = [clientLecture, clientLectureId, clientLectureSecret].some(present) ? lireClient(clientLecture, clientLectureId, clientLectureSecret, 'CLIENT_LECTURE') : cl;
  const jE = jetonPropre(envoi) || null;
  const jL = jetonPropre(lecture) || null;
  /* ---- ce qui est actif, et sinon pourquoi (un motif fixe) ---- */
  let motifEnvoi = null, motifLecture = null;
  const listeR = lireAutorises(autorises), plafondR = lirePlafond(plafond);
  if (!cl.client) motifEnvoi = cl.motif;
  if (!clL.client) motifLecture = clL.motif;   /* [S77] precis : CLIENT_LECTURE_ID_ILLISIBLE… */
  if (jE && jL && jE === jL) motifEnvoi = motifLecture = 'MEME_JETON_POUR_LIRE_ET_ENVOYER';
  if (!motifEnvoi) motifEnvoi = !jE ? (autorises != null && String(autorises).trim() ? 'JETON_ENVOI_ABSENT' : 'ENVOI_NON_CONFIGURE')
    : !JETON_OK.test(jE) ? 'JETON_ENVOI_ILLISIBLE' : listeR.motif || plafondR.motif || null;
  if (!motifLecture) motifLecture = !jL ? 'LECTURE_NON_CONFIGUREE' : !JETON_OK.test(jL) ? 'JETON_LECTURE_ILLISIBLE' : null;
  const envoiActif = !motifEnvoi, lectureActive = !motifLecture;
  const liste = listeR.liste || Object.freeze([]);
  const plafondJour = plafondR.plafond || L.plafondDefaut;

  const acces = { envoi: null, lecture: null };      /* { jeton, expire } */
  const envois = new Map();                          /* jour local -> tentatives */
  const permisEmis = new WeakMap();
  const jourLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(maintenant()));

  async function appeler(methode, url, corps, jetonAcces, type) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOTES.has(u.hostname)) return { ok: false, code: 'HOTE_INTERDIT' };
    const entetes = { 'User-Agent': 'JARVIS-gmail/' + VERSION, Accept: 'application/json' };
    if (jetonAcces) entetes.Authorization = 'Bearer ' + jetonAcces;
    let charge = null;
    if (corps != null) {
      charge = type === 'form' ? corps : JSON.stringify(corps);
      entetes['Content-Type'] = type === 'form' ? 'application/x-www-form-urlencoded' : 'application/json';
      entetes['Content-Length'] = Buffer.byteLength(charge);
    }
    const r = await transport(methode, u.href, entetes, charge, L);
    if (!r.ok) return r;
    let json = null; try { json = r.texte ? JSON.parse(r.texte) : null; } catch { json = null; }
    return { ok: true, status: r.status, json, parti: r.parti };
  }
  /* un jeton d'acces, et la portee VERIFIEE : exactement celle attendue */
  async function jeton(quel) {
    const a = acces[quel];
    if (a && maintenant() < a.expire) return { ok: true, jeton: a.jeton };
    const rt = quel === 'envoi' ? jE : jL, attendue = quel === 'envoi' ? PORTEE_ENVOI : PORTEE_LECTURE;
    const c = (quel === 'envoi' ? cl : clL).client;
    const r = await appeler('POST', 'https://oauth2.googleapis.com/token', 'grant_type=refresh_token&client_id=' + encodeURIComponent(c.id)
      + '&client_secret=' + encodeURIComponent(c.secret) + '&refresh_token=' + encodeURIComponent(rt), null, 'form');
    if (!r.ok) return r;
    if (r.status !== 200 || !r.json || typeof r.json.access_token !== 'string') return { ok: false, code: erreurJeton(r.json) };
    if (typeof r.json.scope !== 'string') return { ok: false, code: 'PORTEE_INCONNUE' };
    const recues = new Set(r.json.scope.split(/\s+/).filter(Boolean));
    if (!recues.has(attendue)) return { ok: false, code: quel === 'envoi' ? 'PORTEE_ENVOI_ABSENTE' : 'PORTEE_LECTURE_ABSENTE' };
    if (recues.size !== 1) return { ok: false, code: quel === 'envoi' ? 'PORTEE_ENVOI_TROP_LARGE' : 'PORTEE_LECTURE_TROP_LARGE' };
    acces[quel] = { jeton: r.json.access_token, expire: maintenant() + Math.max(60, Math.min(3600, Number(r.json.expires_in) || 3600) - 60) * 1000 };
    return { ok: true, jeton: acces[quel].jeton };
  }
  const restants = () => Math.max(0, plafondJour - (envois.get(jourLocal()) || 0));
  /* [S80] l'adresse du compte (« moi »), lue une fois chez Google (profil, gmail.readonly) */
  let moiCache = null;
  async function adresseMoi(jetonLecture) {
    if (moiCache) return moiCache;
    const p = await appeler('GET', API + '/profile', null, jetonLecture);
    const a = p.ok && p.status === 200 && p.json && typeof p.json.emailAddress === 'string' ? cleAdresse(p.json.emailAddress) : null;
    if (a && adresseValide(a)) moiCache = a;
    return moiCache;
  }

  /* ---- diagnostic : jetons, portees, compte lu ; RIEN n'est envoye ---- */
  let dernierDiag = null;
  async function diagnostic() {
    if (dernierDiag && maintenant() - dernierDiag.ts < L.diagnosticMs) return { ...dernierDiag.r, recent: true };
    const etapes = [];
    if (envoiActif) { const j = await jeton('envoi'); etapes.push(Object.freeze({ etape: 'ENVOI', ok: j.ok, code: j.ok ? 'PORTEE_GMAIL_SEND_SEULE' : j.code })); }
    else etapes.push(Object.freeze({ etape: 'ENVOI', ok: false, code: motifEnvoi }));
    let compte = null;
    if (lectureActive) {
      const j = await jeton('lecture');
      if (!j.ok) etapes.push(Object.freeze({ etape: 'LECTURE', ok: false, code: j.code }));
      else {
        const p = await appeler('GET', API + '/profile', null, j.jeton);
        const ok = p.ok && p.status === 200 && p.json && typeof p.json.emailAddress === 'string';
        compte = ok && adresseValide(p.json.emailAddress) ? p.json.emailAddress : null;
        etapes.push(Object.freeze({ etape: 'LECTURE', ok: !!compte, code: compte ? 'PORTEE_GMAIL_READONLY_SEULE' : (p.ok ? erreurGmail(p.status, p.json) : p.code) }));
      }
    } else etapes.push(Object.freeze({ etape: 'LECTURE', ok: false, code: motifLecture }));
    const r = Object.freeze({ ok: etapes.every(e => e.ok || e.code === 'ENVOI_NON_CONFIGURE' || e.code === 'LECTURE_NON_CONFIGUREE'),
      compte, autorises: liste.length, plafond: plafondJour, restants: restants(), etapes: Object.freeze(etapes) });
    dernierDiag = { ts: maintenant(), r };
    return r;
  }

  return Object.freeze({
    VERSION, envoiActif, lectureActive, motifEnvoi, motifLecture, plafond: plafondJour, diagnostic,
    nbAutorises: liste.length,
    autorise: (a) => envoiActif && adresseValide(a) && liste.includes(cleAdresse(a)),
    restants,
    liensDe,
    /* le brouillon verifie, pret a etre montre en entier sur la carte */
    verifier: (c) => (envoiActif ? verifierContenu(c || {}, liste) : { ok: false, code: motifEnvoi }),
    /* Appele DANS l'effet d'une transaction autorisee (T6) : SEND vers une
     * adresse autorisee, avec l'empreinte du contenu dans spec.tool */
    permisEnvoi(action) {
      if (!envoiActif) throw new Error('ENVOI_INACTIF');
      if (!action || action.action !== 'SEND' || action.resource !== 'EMAIL') throw new Error('PERMIS_REFUSE');
      if (!adresseValide(action.target) || !liste.includes(cleAdresse(action.target))) throw new Error('HORS_LISTE');
      if (typeof action.tool !== 'string' || !/^GMAIL:[0-9a-f]{40}$/.test(action.tool)) throw new Error('CONTENU_NON_LIE');
      const tx = String(action.transactionId || '');
      if (!/^tx_[0-9a-f-]{36}$/.test(tx)) throw new Error('TRANSACTION_INVALIDE');
      const p = Object.freeze({ a: action.target, outil: action.tool, transactionId: tx });
      permisEmis.set(p, { expire: maintenant() + L.permisMs, utilise: false });
      return p;
    },
    async envoyer(permis, brouillon) {
      const e = (permis && typeof permis === 'object') ? permisEmis.get(permis) : undefined;
      if (!e) return { ok: false, code: 'PERMIS_INCONNU' };
      if (e.utilise) return { ok: false, code: 'PERMIS_DEJA_UTILISE' };
      e.utilise = true;
      if (maintenant() > e.expire) return { ok: false, code: 'PERMIS_EXPIRE' };
      /* le contenu est REVERIFIE ici, et doit etre celui que le permis porte */
      const v = verifierContenu(brouillon || {}, liste);
      if (!v.ok) return { ok: false, code: v.code };
      if (v.brouillon.outil !== permis.outil || cleAdresse(v.brouillon.a) !== cleAdresse(permis.a)) return { ok: false, code: 'CONTENU_DIFFERENT' };
      const jour = jourLocal();
      if ((envois.get(jour) || 0) >= plafondJour) return { ok: false, code: 'PLAFOND_JOURNALIER' };
      const j = await jeton('envoi'); if (!j.ok) return { ok: false, code: j.code };
      envois.set(jour, (envois.get(jour) || 0) + 1);   /* compte a la TENTATIVE */
      for (const k of envois.keys()) if (k !== jour) envois.delete(k);
      const r = await appeler('POST', API + '/messages/send', { raw: b64u(messageBrut(v.brouillon, permis.transactionId)) }, j.jeton);
      if (!r.ok) return { ok: false, code: ['DELAI_DEPASSE', 'CONNEXION_COUPEE', 'REPONSE_INCOMPLETE'].includes(r.code) ? 'RESULTAT_INCERTAIN' : r.code, detail: r.code };
      if (r.status === 200 && r.json && typeof r.json.id === 'string' && /^[0-9a-fA-F]{6,40}$/.test(r.json.id))
        return { ok: true, code: 'ENVOYE', preuve: r.json.id, fil: typeof r.json.threadId === 'string' ? r.json.threadId.slice(0, 40) : null };
      if (r.status === 200) return { ok: false, code: 'RESULTAT_INCERTAIN', detail: 'REPONSE_SANS_IDENTIFIANT' };
      return { ok: false, code: erreurGmail(r.status, r.json) };
    },
    /* Appele DANS l'effet d'un READ MAIL autorise (T6) */
    permisLecture(action) {
      if (!lectureActive) throw new Error('LECTURE_INACTIVE');
      if (!action || action.action !== 'READ' || action.resource !== 'MAIL') throw new Error('PERMIS_REFUSE');
      const fils = action.target === 'fils' || /^fil:[0-9a-fA-F]{6,40}$/.test(String(action.target));   /* [S80] */
      if (!fils && !Object.prototype.hasOwnProperty.call(FILTRES, action.target)) throw new Error('FILTRE_INVALIDE');
      const p = Object.freeze({ filtre: action.target, transactionId: String(action.transactionId || '') });
      permisEmis.set(p, { expire: maintenant() + L.permisMs, utilise: false });
      return p;
    },
    async lire(permis) {
      const e = (permis && typeof permis === 'object') ? permisEmis.get(permis) : undefined;
      if (!e || !Object.prototype.hasOwnProperty.call(FILTRES, permis.filtre)) return { ok: false, code: 'PERMIS_INCONNU' };
      if (e.utilise) return { ok: false, code: 'PERMIS_DEJA_UTILISE' };
      e.utilise = true;
      if (maintenant() > e.expire) return { ok: false, code: 'PERMIS_EXPIRE' };
      const j = await jeton('lecture'); if (!j.ok) return { ok: false, code: j.code };
      const l = await appeler('GET', API + '/messages?maxResults=' + L.lusMax + '&' + FILTRES[permis.filtre], null, j.jeton);
      if (!l.ok) return { ok: false, code: l.code };
      if (l.status !== 200 || !l.json) return { ok: false, code: erreurGmail(l.status, l.json) };
      const ids = (Array.isArray(l.json.messages) ? l.json.messages : []).map(m => m && m.id).filter(id => typeof id === 'string' && /^[0-9a-fA-F]{6,40}$/.test(id)).slice(0, L.lusMax);
      const mails = [], debut = maintenant();
      for (const id of ids) {
        /* un budget TOTAL : 1 liste + 5 messages ne tiennent jamais la page plus de 20 s */
        if (maintenant() - debut > L.lectureTotaleMs) { mails.push(Object.freeze({ id, illisible: true, code: 'DELAI_DEPASSE' })); continue; }
        const m = await appeler('GET', API + '/messages/' + id + '?format=full', null, j.jeton);
        if (!m.ok || m.status !== 200 || !m.json) { mails.push(Object.freeze({ id, illisible: true, code: m.ok ? erreurGmail(m.status, m.json) : m.code })); continue; }
        const t = texteDe(m.json.payload);
        const brut = nettoyer(t.texte, L.extraitMax + 1);
        mails.push(Object.freeze({ id, de: nettoyer(entete(m.json, 'from'), 150), objet: nettoyer(entete(m.json, 'subject'), 200), date: nettoyer(entete(m.json, 'date'), 60),
          texte: brut.slice(0, L.extraitMax), coupe: brut.length > L.extraitMax, piecesJointes: t.piecesJointes,
          nonLu: Array.isArray(m.json.labelIds) && m.json.labelIds.includes('UNREAD') }));
      }
      return { ok: true, filtre: permis.filtre, mails: Object.freeze(mails), tronque: typeof l.json.nextPageToken === 'string' };
    },
    /* [S80] v4.10 LES CONVERSATIONS (gmail.readonly) : « fils » = les conversations
     * des 14 derniers jours (15 au plus, sans promotions ni reseaux sociaux),
     * « fil:<id> » = une seule. Chaque message : expediteur, destinataires,
     * adresse de reponse, date, partie nouvelle du texte, pieces jointes
     * (nom, type, taille : jamais lues), et « moi » (libelle SENT, ou expediteur
     * = l'adresse du compte). Un CONTENU EXTERNE, nettoye et borne. */
    async lireFils(permis) {
      const e = (permis && typeof permis === 'object') ? permisEmis.get(permis) : undefined;
      if (!e || !(permis.filtre === 'fils' || /^fil:[0-9a-fA-F]{6,40}$/.test(String(permis.filtre)))) return { ok: false, code: 'PERMIS_INCONNU' };
      if (e.utilise) return { ok: false, code: 'PERMIS_DEJA_UTILISE' };
      e.utilise = true;
      if (maintenant() > e.expire) return { ok: false, code: 'PERMIS_EXPIRE' };
      const j = await jeton('lecture'); if (!j.ok) return { ok: false, code: j.code };
      const moi = await adresseMoi(j.jeton);
      let ids = [], tronque = false;
      if (permis.filtre === 'fils') {
        const q = 'newer_than:' + L.joursFils + 'd -category:promotions -category:social -category:forums -in:chats';
        const l = await appeler('GET', API + '/threads?maxResults=' + L.filsMax + '&q=' + encodeURIComponent(q), null, j.jeton);
        if (!l.ok) return { ok: false, code: l.code };
        if (l.status !== 200 || !l.json) return { ok: false, code: erreurGmail(l.status, l.json) };
        ids = (Array.isArray(l.json.threads) ? l.json.threads : []).map(x => x && x.id).filter(x => typeof x === 'string' && RE_FIL.test(x)).slice(0, L.filsMax);
        tronque = typeof l.json.nextPageToken === 'string';
      } else ids = [String(permis.filtre).slice(4)];
      /* [S91] v4.10.1 4 conversations a la fois (avant : une par une, 15 aller-retours
       * a la suite) ; l'ordre de la liste est garde ; le budget TOTAL reste 20 s */
      const fils = new Array(ids.length), debut = maintenant();
      let suivant = 0;
      const lecteur = async () => {
        for (let k = suivant++; k < ids.length; k = suivant++) {
          const id = ids[k];
          if (maintenant() - debut > L.lectureTotaleMs) { fils[k] = Object.freeze({ id, illisible: true, code: 'DELAI_DEPASSE' }); continue; }
          const f = await appeler('GET', API + '/threads/' + id + '?format=full', null, j.jeton);
          fils[k] = (!f.ok || f.status !== 200 || !f.json || !Array.isArray(f.json.messages))
            ? Object.freeze({ id, illisible: true, code: f.ok ? erreurGmail(f.status, f.json) : f.code }) : convertirFil(id, f.json, moi);
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(Number(L.lecturesParallele) || 1, 8, ids.length)) }, lecteur));
      return { ok: true, filtre: permis.filtre, moi, fils: Object.freeze(fils), tronque };
    },
    verifierReponse: (c) => (envoiActif ? verifierReponse(c || {}) : { ok: false, code: motifEnvoi }),
    /* [S81] Appele DANS l'effet d'une transaction autorisee (T6) : une REPONSE,
     * hors liste fermee, mais verifiee contre la conversation elle-meme */
    permisReponse(action) {
      if (!envoiActif) throw new Error('ENVOI_INACTIF');
      if (!lectureActive) throw new Error('LECTURE_REQUISE_POUR_VERIFIER');
      if (!action || action.action !== 'SEND' || action.resource !== 'EMAIL') throw new Error('PERMIS_REFUSE');
      if (!adresseValide(action.target)) throw new Error('ADRESSE_INVALIDE');
      if (typeof action.tool !== 'string' || !/^GMAIL-REP:[0-9a-f]{40}$/.test(action.tool)) throw new Error('CONTENU_NON_LIE');
      const tx = String(action.transactionId || '');
      if (!/^tx_[0-9a-f-]{36}$/.test(tx)) throw new Error('TRANSACTION_INVALIDE');
      const p = Object.freeze({ a: action.target, outil: action.tool, transactionId: tx, reponse: true });
      permisEmis.set(p, { expire: maintenant() + L.permisMs, utilise: false });
      return p;
    },
    /* [S81] envoyer la reponse, puis VERIFIER : (1) avant, la conversation existe
     * et le message auquel on repond vient bien de CETTE adresse (pas de moi) ;
     * (2) apres, le message envoye est dans les Envoyes, dans la meme
     * conversation, au bon destinataire. Jamais de nouvel essai automatique. */
    async envoyerReponse(permis, brouillon) {
      const e = (permis && typeof permis === 'object' && permis.reponse) ? permisEmis.get(permis) : undefined;
      if (!e) return { ok: false, code: 'PERMIS_INCONNU' };
      if (e.utilise) return { ok: false, code: 'PERMIS_DEJA_UTILISE' };
      e.utilise = true;
      if (maintenant() > e.expire) return { ok: false, code: 'PERMIS_EXPIRE' };
      const v = verifierReponse(brouillon || {});
      if (!v.ok) return { ok: false, code: v.code };
      if (v.brouillon.outil !== permis.outil || cleAdresse(v.brouillon.a) !== cleAdresse(permis.a)) return { ok: false, code: 'CONTENU_DIFFERENT' };
      const jour = jourLocal();
      if ((envois.get(jour) || 0) >= plafondJour) return { ok: false, code: 'PLAFOND_JOURNALIER' };
      const jl = await jeton('lecture'); if (!jl.ok) return { ok: false, code: jl.code };
      const moi = await adresseMoi(jl.jeton);
      const f = await appeler('GET', API + '/threads/' + v.brouillon.filId + '?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID', null, jl.jeton);
      if (!f.ok || f.status !== 200 || !f.json || !Array.isArray(f.json.messages)) return { ok: false, code: f.ok ? (f.status === 404 ? 'FIL_INTROUVABLE' : erreurGmail(f.status, f.json)) : f.code };
      const vise = f.json.messages.find(m => entete(m, 'message-id').trim() === v.brouillon.inReplyTo);
      const deVise = vise ? (adressesDe(entete(vise, 'from'))[0] || {}).adresse : null;
      if (!vise || !deVise || deVise !== cleAdresse(v.brouillon.a) || (moi && deVise === cleAdresse(moi))) return { ok: false, code: 'FIL_NE_CORRESPOND_PAS' };
      const je = await jeton('envoi'); if (!je.ok) return { ok: false, code: je.code };
      envois.set(jour, (envois.get(jour) || 0) + 1);   /* compte a la TENTATIVE */
      for (const k of envois.keys()) if (k !== jour) envois.delete(k);
      const r = await appeler('POST', API + '/messages/send', { raw: b64u(messageBrut(v.brouillon, permis.transactionId)), threadId: v.brouillon.filId }, je.jeton);
      if (!r.ok) return { ok: false, code: ['DELAI_DEPASSE', 'CONNEXION_COUPEE', 'REPONSE_INCOMPLETE'].includes(r.code) ? 'RESULTAT_INCERTAIN' : r.code, detail: r.code };
      if (!(r.status === 200 && r.json && typeof r.json.id === 'string' && /^[0-9a-fA-F]{6,40}$/.test(r.json.id)))
        return r.status === 200 ? { ok: false, code: 'RESULTAT_INCERTAIN', detail: 'REPONSE_SANS_IDENTIFIANT' } : { ok: false, code: erreurGmail(r.status, r.json) };
      const id = r.json.id;
      /* la verification, par le jeton de LECTURE : ce que Google a vraiment range */
      const c = await appeler('GET', API + '/messages/' + id + '?format=metadata&metadataHeaders=To', null, jl.jeton);
      const labels = c.ok && c.json && Array.isArray(c.json.labelIds) ? c.json.labelIds : [];
      const verification = Object.freeze({ envoyes: labels.includes('SENT'), memeFil: !!(c.ok && c.json && c.json.threadId === v.brouillon.filId),
        destinataire: !!(c.ok && c.json && (adressesDe(entete(c.json, 'to'))[0] || {}).adresse === cleAdresse(v.brouillon.a)) });
      return { ok: true, code: 'ENVOYE', preuve: id, fil: v.brouillon.filId, verifie: verification.envoyes && verification.memeFil && verification.destinataire, verification };
    }
  });
}

/* [S86] v4.10.1 ce que GMAIL a verifie a la reception : le PREMIER en-tete
 * « Authentication-Results » (entete() rend le premier), signe mx.google.com ;
 * dmarc=<resultat> et header.from=<domaine>. Rien d'autre n'est cru. */
function authDe(m) {
  const h = entete(m, 'authentication-results');
  if (!/^\s*mx\.google\.com\s*;/i.test(h)) return null;
  const dm = /(?:^|;)\s*dmarc\s*=\s*([a-z]+)([^;]*)/i.exec(h);
  if (!dm) return null;
  const from = /(?:^|\s)header\.from\s*=\s*([A-Za-z0-9.-]{1,253})(?=[\s;]|$)/i.exec(dm[2]);
  return Object.freeze({ dmarc: dm[1].toLowerCase(), domaine: from ? from[1].toLowerCase().replace(/\.$/, '') : null });
}
/* [S85] les identifiants de References, valides seulement (<…> sans blanc), 10 au plus */
const referencesDe = (m) => entete(m, 'references').split(/\s+/).filter(x => RE_MESSAGE_ID.test(x)).slice(-10).join(' ');

/* [S80] une conversation Gmail -> { id, objet, messages[] } (donnees, bornees) */
function convertirFil(id, json, moi) {
  const m0 = cleAdresse(moi);
  const messages = json.messages.slice().sort((a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0)).slice(-LIMITES_MAIL.messagesParFil).map((m) => {
    const de = adressesDe(entete(m, 'from'))[0] || { nom: '', adresse: '' };
    const t = texteDe(m.payload);
    const brut = nettoyer(partieNouvelle(t.texte), LIMITES_MAIL.texteFil + 1);
    const mid = entete(m, 'message-id').trim(), labels = Array.isArray(m.labelIds) ? m.labelIds : [];
    return Object.freeze({ id: String(m.id || '').slice(0, 40), de: Object.freeze({ nom: nettoyer(de.nom, 80), adresse: de.adresse }),
      a: adressesDe(entete(m, 'to')).map(x => x.adresse), cc: adressesDe(entete(m, 'cc')).map(x => x.adresse),
      repondreA: (adressesDe(entete(m, 'reply-to'))[0] || {}).adresse || null, date: Number(m.internalDate) || 0,
      objet: nettoyer(decoderEntete(entete(m, 'subject')), 200), texte: brut.slice(0, LIMITES_MAIL.texteFil), coupe: brut.length > LIMITES_MAIL.texteFil,
      piecesJointes: Object.freeze(piecesDe(m.payload)), messageId: RE_MESSAGE_ID.test(mid) ? mid : null,
      references: referencesDe(m), auth: authDe(m),   /* [S85] [S86] */
      moi: labels.includes('SENT') || (!!m0 && de.adresse === m0), nonLu: labels.includes('UNREAD') });
  });
  return Object.freeze({ id, objet: messages.length ? messages[0].objet : '', messages: Object.freeze(messages) });
}

module.exports = Object.freeze({ VERSION, creerMail, adresseValide, liensDe, verifierContenu, messageBrut, motEncode, lireClient, lireAutorises, valeurPropre, mailto,
  verifierReponse, adressesDe, decoderEntete, partieNouvelle, convertirFil,   /* [S80] [S81] v4.10 */
  authDe,   /* [S86] v4.10.1 */
  PORTEE_ENVOI, PORTEE_LECTURE, LIMITES_MAIL });
