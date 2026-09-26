'use strict';
/* ============================================================================
 * JARVIS — MANIFESTE DES FICHIERS QUI TOURNENT                    [S34] 1.0
 * ----------------------------------------------------------------------------
 * Vu en vrai les 23 et 24 sept : des depots d'anciens telechargements
 * (v4.5.2 au lieu de v4.5.4), des fichiers renommes par l'iPad (« server 2.js »,
 * « jarvis-plus-5_29.js »). /health ne le voyait qu'a moitie (S33 : une seule
 * version lue).
 *
 * - MANIFESTE.json, livre avec chaque version, donne l'empreinte SHA-256
 *   attendue de chaque fichier qui tourne.
 * - Au demarrage, le serveur calcule les empreintes reelles, UNE fois : elles
 *   decrivent le code charge. /health dit « conforme », « non conforme : ... »
 *   (noms seulement) ou « absent », et une empreinte globale courte a comparer
 *   avec celle du manifeste.
 * - En ligne de commande (GitHub, tests.yml) : node jarvis-manifeste.js
 *   --verifier sort en erreur si un fichier differe : le mauvais depot ne part
 *   jamais en ligne (Render « After CI Checks Pass »).
 *
 * Le manifeste est une DONNEE : on ne lit jamais un chemin qu'il indique, on
 * ne compare que la liste fixe ci-dessous. Un module local requis mais absent
 * de cette liste est signale (« hors manifeste »).
 *
 * Limite assumee : protege des ERREURS de depot, pas d'un attaquant qui a la
 * main sur le depot (il modifierait aussi le manifeste).
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.0';
const NOM = 'MANIFESTE.json';
const FICHIERS = Object.freeze([
  'server.js', 'index.html', 'package.json',
  'jarvis-5.28.3.js', 'jarvis-plus-5.29.js', 'jarvis-vigilance.js', 'jarvis-memoire.js',
  'jarvis-agenda.js', 'jarvis-ecriture.js', 'jarvis-elevation.js', 'jarvis-manifeste.js', 'jarvis-verite.js'   /* [S49] v4.6.7 */
]);

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function empreintes(dir) {
  const o = Object.create(null);
  for (const f of FICHIERS) {
    try { o[f] = sha(fs.readFileSync(path.join(dir, f))); } catch { o[f] = null; }
  }
  return o;
}

const globale = (e) => sha(FICHIERS.map((f) => f + ':' + (e[f] || '-')).join('\n')).slice(0, 12);

/* Modules locaux requis par les fichiers de la liste : tout ce qui tourne
 * doit y figurer. Lecture du texte, le meme en ligne et dans GitHub. */
function horsManifeste(dir) {
  const hors = new Set();
  for (const f of FICHIERS) {
    if (!f.endsWith('.js')) continue;
    let t = '';
    try { t = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const m of t.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)) {
      const nom = m[1].endsWith('.js') || m[1].endsWith('.json') ? m[1] : m[1] + '.js';
      if (!FICHIERS.includes(nom)) hors.add(nom);
    }
  }
  return [...hors].sort();
}

function verifier(dir) {
  const reel = empreintes(dir);
  const r = { etat: 'conforme', empreinte: globale(reel), differents: [], manquants: [], hors: horsManifeste(dir) };
  let attendu;
  try { attendu = JSON.parse(fs.readFileSync(path.join(dir, NOM), 'utf8')); }
  catch (e) { r.etat = e && e.code === 'ENOENT' ? 'absent' : 'illisible'; return r; }
  const liste = attendu !== null && typeof attendu === 'object' && !Array.isArray(attendu) ? attendu.fichiers : null;
  if (liste === null || typeof liste !== 'object' || Array.isArray(liste)) { r.etat = 'illisible'; return r; }
  for (const f of FICHIERS) {
    const a = Object.prototype.hasOwnProperty.call(liste, f) ? liste[f] : undefined;
    if (reel[f] === null) r.manquants.push(f);
    else if (typeof a !== 'string' || a !== reel[f]) r.differents.push(f);
  }
  if (r.differents.length || r.manquants.length || r.hors.length) r.etat = 'non conforme';
  return r;
}

/* Une ligne lisible sur un telephone, pour /health. */
function resume(r) {
  if (!r || typeof r !== 'object') return 'inconnu';
  const d = [].concat(r.differents.map((f) => f + ' (différent)'), r.manquants.map((f) => f + ' (manquant)'),
    r.hors.map((f) => f + ' (hors manifeste)'));
  return r.etat === 'conforme' ? 'conforme' : r.etat + (d.length ? ' : ' + d.join(', ') : '');
}

function contenu(dir) {
  const e = empreintes(dir);
  const m = /passerelle:\s*'(v[0-9.]+)'/.exec((() => { try { return fs.readFileSync(path.join(dir, 'server.js'), 'utf8'); } catch { return ''; } })());
  const fichiers = {};
  for (const f of FICHIERS) if (e[f]) fichiers[f] = e[f];
  return JSON.stringify({ format: 1, passerelle: m ? m[1] : 'inconnue', empreinte: globale(e), fichiers }, null, 2) + '\n';
}

module.exports = Object.freeze({ VERSION, NOM, FICHIERS, empreintes, verifier, resume, contenu });

/* node jarvis-manifeste.js --ecrire   : (re)genere MANIFESTE.json
 * node jarvis-manifeste.js --verifier : 0 si conforme, 1 sinon (GitHub) */
if (require.main === module) {
  const dir = path.resolve(process.argv[3] || __dirname);
  if (process.argv[2] === '--ecrire') {
    fs.writeFileSync(path.join(dir, NOM), contenu(dir));
    console.log(NOM + ' ecrit : ' + verifier(dir).empreinte);
  } else {
    const r = verifier(dir);
    console.log('Manifeste : ' + resume(r) + ' — empreinte ' + r.empreinte);
    process.exit(r.etat === 'conforme' ? 0 : 1);
  }
}
