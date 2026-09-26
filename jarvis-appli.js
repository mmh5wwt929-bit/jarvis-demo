'use strict';
/* ============================================================================
 * JARVIS — l'appli sur l'ecran d'accueil (v4.7)          module jarvis-appli.js
 * ----------------------------------------------------------------------------
 * Le manifeste de l'appli et ses icones, DESSINES ICI au demarrage : aucun
 * fichier binaire a deposer, aucune dependance. Un « J » bleu sur le fond de
 * la page, et le point vert du plancher de confiance.
 *
 * Ni service worker ni cache hors ligne, volontairement : JARVIS n'a de sens
 * que relie a son serveur, et une page gardee en cache pourrait survivre a une
 * correction de securite. Chaque ouverture recharge la page du serveur.
 *
 * Aucune decision ici, aucun reseau, aucune donnee de la personne.
 * ========================================================================== */
const zlib = require('zlib');

const VERSION = '1.0';
const TAILLES = Object.freeze([180, 192, 512]);
const FOND = [0x0d, 0x11, 0x17];     /* --encre */
const BLEU = [0x58, 0xa6, 0xff];     /* --signal */
const VERT = [0x3f, 0xb9, 0x50];     /* --sur */

const MANIFESTE = Object.freeze({
  name: 'JARVIS',
  short_name: 'JARVIS',
  description: "Ton assistant sous contrôle : rien d'irréversible sans ton geste.",
  lang: 'fr',
  dir: 'ltr',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0d1117',
  theme_color: '#161b22',
  icons: [
    { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
});

/* ---------------------------------------------------------- le dessin -- */
/* Coordonnees en fraction du cote (0..1). Tout tient dans la zone sure d'une
 * icone « maskable » (cercle de rayon 0,4 au centre). */
const E = 0.105;                                  /* epaisseur du trait */
function couleur(x, y) {
  /* point du plancher, en bas a droite */
  if ((x - 0.712) ** 2 + (y - 0.665) ** 2 <= 0.066 ** 2) return VERT;
  /* barre du haut */
  if (x >= 0.335 && x <= 0.625 && y >= 0.245 && y <= 0.245 + E) return BLEU;
  /* fut */
  if (x >= 0.52 && x <= 0.52 + E && y >= 0.245 && y <= 0.56) return BLEU;
  /* crochet : demi-anneau sous le fut */
  const cx = 0.52 + E - 0.175, cy = 0.56, r = Math.hypot(x - cx, y - cy);
  if (y >= cy && r <= 0.175 && r >= 0.175 - E) return BLEU;
  /* bout arrondi du crochet */
  if ((x - (cx - 0.175 + E / 2)) ** 2 + (y - cy) ** 2 <= (E / 2) ** 2) return BLEU;
  return null;
}

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (const x of b) c = TABLE_CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function morceau(type, donnees) {
  const l = Buffer.alloc(4); l.writeUInt32BE(donnees.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}

/* PNG RVB 8 bits ; 4 x 4 echantillons par pixel pour des bords lisses */
function dessiner(taille) {
  const brut = Buffer.alloc((taille * 3 + 1) * taille);
  const N = 4;
  for (let py = 0; py < taille; py++) {
    const ligne = py * (taille * 3 + 1);
    brut[ligne] = 0;
    for (let px = 0; px < taille; px++) {
      let r = 0, v = 0, b = 0;
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        const c = couleur((px + (sx + 0.5) / N) / taille, (py + (sy + 0.5) / N) / taille) || FOND;
        r += c[0]; v += c[1]; b += c[2];
      }
      const o = ligne + 1 + px * 3;
      brut[o] = Math.round(r / (N * N)); brut[o + 1] = Math.round(v / (N * N)); brut[o + 2] = Math.round(b / (N * N));
    }
  }
  const tete = Buffer.alloc(13);
  tete.writeUInt32BE(taille, 0); tete.writeUInt32BE(taille, 4);
  tete[8] = 8; tete[9] = 2; tete[10] = 0; tete[11] = 0; tete[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', tete), morceau('IDAT', zlib.deflateSync(brut, { level: 9 })), morceau('IEND', Buffer.alloc(0))]);
}

const cache = new Map();
/* l'icone d'une taille connue ; null sinon (jamais une taille choisie par la requete) */
function icone(taille) {
  const t = Number(taille);
  if (!TAILLES.includes(t)) return null;
  if (!cache.has(t)) cache.set(t, dessiner(t));
  return cache.get(t);
}

/* chemin -> { type, corps } ; null si ce n'est pas un fichier de l'appli */
const ICONES = Object.freeze({ '/icone-180.png': 180, '/icone-192.png': 192, '/icone-512.png': 512,
  '/apple-touch-icon.png': 180, '/apple-touch-icon-precomposed.png': 180 });
const TEXTE_MANIFESTE = JSON.stringify(MANIFESTE);
function fichier(chemin) {
  if (chemin === '/manifest.webmanifest') return { type: 'application/manifest+json; charset=utf-8', corps: Buffer.from(TEXTE_MANIFESTE, 'utf8') };
  if (Object.prototype.hasOwnProperty.call(ICONES, chemin)) return { type: 'image/png', corps: icone(ICONES[chemin]) };
  return null;
}

module.exports = Object.freeze({ VERSION, MANIFESTE, TAILLES, icone, fichier });
