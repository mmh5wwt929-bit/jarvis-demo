#!/usr/bin/env node
/*
 * JARVIS — contrôle de fin de tour (hook « Stop » de Claude Code)      1.0
 *
 * But : Claude ne peut pas terminer une étape avec du code JARVIS qui casse
 * une suite de tests ou le manifeste. Tourne dans la session (conteneur),
 * pas sur le quota : aucun appel au modèle.
 *
 * Quand il ne fait RIEN (pour ne pas ralentir une simple réponse) :
 *   - aucun fichier .js/.html/.json n'a changé depuis origin/Racine
 *     (Racine est déjà verte : CI obligatoire) ;
 *   - ou le code est identique au dernier état vérifié vert (.git/jarvis-vert).
 * Sinon : manifeste (--verifier) + toutes les suites tests-*.js, UNE PAR UNE
 * (comme la CI) : plusieurs suites démarrent server.js sur des ports fixes
 * (3971 partagé…) ; en parallèle, une suite peut interroger le serveur d'une
 * autre et passer à tort. Pas de parallèle tant que les ports ne sont pas isolés.
 *
 * Rouge  → code 2 : Claude reçoit l'extrait des échecs et continue.
 * 3 blocages de suite dans le même tour → on le laisse finir, avec un
 * avertissement visible (pas de boucle infinie).
 *
 * À la main : node .claude/verifier-tests.js --forcer   (0 = vert, 1 = rouge)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const RACINE_DEPOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..');
const FORCER = process.argv.includes('--forcer');
const DELAI_SUITE_MS = 300000;           // même plafond que la CI
const ESSAIS_MAX = 3;
const EXTRAIT_LIGNES = 25;
const MESSAGE_MAX = 6000;                // limite ce que Claude relit (quota)

const git = (...a) => spawnSync('git', a, { cwd: RACINE_DEPOT, encoding: 'utf8' });

function dossierEtat() {
  const r = git('rev-parse', '--git-dir');
  if (r.status === 0 && r.stdout.trim()) return path.resolve(RACINE_DEPOT, r.stdout.trim());
  return os.tmpdir();
}
const ETAT = dossierEtat();
const F_VERT = path.join(ETAT, 'jarvis-vert');
const F_ESSAIS = path.join(ETAT, 'jarvis-essais');

const lire = (f, d) => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
const ecrire = (f, t) => { try { fs.writeFileSync(f, t); } catch { /* état facultatif */ } };

function entree() {
  if (process.stdin.isTTY) return {};
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

/* Fichiers de code à la racine du dépôt (tout JARVIS y est). */
function fichiersCode() {
  return fs.readdirSync(RACINE_DEPOT)
    .filter((f) => /\.(js|html|json)$/.test(f) && f !== 'package-lock.json')
    .sort();
}
function empreinteCode() {
  const h = crypto.createHash('sha256');
  for (const f of fichiersCode()) h.update(f + '\0' + fs.readFileSync(path.join(RACINE_DEPOT, f)) + '\0');
  return h.digest('hex');
}

/* Vrai seulement si l'on est SÛR que le code est celui de Racine. */
function identiqueARacine() {
  if (git('rev-parse', '--verify', '--quiet', 'origin/Racine').status !== 0) return false;
  const specs = ['--', ':(glob)*.js', ':(glob)*.html', ':(glob)*.json'];
  if (git('diff', '--quiet', 'origin/Racine', ...specs).status !== 0) return false;
  const nouveaux = git('ls-files', '--others', '--exclude-standard', ...specs);
  return nouveaux.status === 0 && nouveaux.stdout.trim() === '';
}

function extrait(texte) {
  const t = texte.trim();
  if (!t) return '    (aucune sortie)';
  return t.split('\n').slice(-EXTRAIT_LIGNES).map((l) => '    ' + l).join('\n');
}

/* Une suite de Racine qui disparaît = rouge (on ne passe pas en supprimant). */
function suitesDisparues() {
  const r = git('ls-tree', '--name-only', 'origin/Racine');
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter((f) => /^tests-.*\.js$/.test(f))
    .filter((f) => !fs.existsSync(path.join(RACINE_DEPOT, f)));
}

function lancer(fichier) {
  return new Promise((resolve) => {
    const debut = Date.now();
    const p = spawn(process.execPath, [fichier], { cwd: RACINE_DEPOT, env: process.env });
    let sortie = '';
    const garder = (b) => { sortie = (sortie + b).slice(-20000); };
    p.stdout.on('data', garder);
    p.stderr.on('data', garder);
    const minuterie = setTimeout(() => { sortie += '\n[délai de 300 s dépassé]'; p.kill('SIGKILL'); }, DELAI_SUITE_MS);
    p.on('close', (code) => {
      clearTimeout(minuterie);
      resolve({ fichier, code, ms: Date.now() - debut, sortie });
    });
  });
}

async function toutesLesSuites() {
  const suites = fs.readdirSync(RACINE_DEPOT).filter((f) => /^tests-.*\.js$/.test(f)).sort();
  const echecs = [];
  for (const f of suites) {
    const r = await lancer(f);
    if (r.code !== 0) echecs.push(r);
  }
  return { nombre: suites.length, echecs };
}

function jsdomPresent() {
  try { require.resolve('jsdom', { paths: [RACINE_DEPOT] }); return true; } catch { /* absent */ }
  const r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', 'jsdom'],
    { cwd: RACINE_DEPOT, encoding: 'utf8', timeout: 180000 });
  return r.status === 0;
}

async function principal() {
  const e = entree();
  const empreinte = empreinteCode();

  if (!FORCER) {
    if (lire(F_VERT, '') === empreinte) return 0;
    if (identiqueARacine()) { ecrire(F_VERT, empreinte); return 0; }
  }

  const debut = Date.now();
  const manifeste = spawnSync(process.execPath, ['jarvis-manifeste.js', '--verifier'],
    { cwd: RACINE_DEPOT, encoding: 'utf8' });
  const jsdom = jsdomPresent();
  const disparues = suitesDisparues();
  const { nombre, echecs } = await toutesLesSuites();
  const secondes = Math.round((Date.now() - debut) / 1000);
  const vert = manifeste.status === 0 && echecs.length === 0 && disparues.length === 0;

  if (vert) {
    ecrire(F_VERT, empreinte);
    ecrire(F_ESSAIS, '0');
    const msg = `Tests JARVIS verts : ${nombre} suites, manifeste conforme (${secondes} s).`;
    if (FORCER) console.log(msg);
    else process.stdout.write(JSON.stringify({ systemMessage: '✅ ' + msg }));
    return 0;
  }

  const lignes = [`Tests JARVIS ROUGES (${secondes} s) — contrôle de fin de tour :`];
  if (manifeste.status !== 0) {
    lignes.push('- Manifeste non conforme → node jarvis-manifeste.js --ecrire, puis --verifier.');
    lignes.push(extrait(manifeste.stdout + manifeste.stderr));
  }
  if (!jsdom) lignes.push('- jsdom absent et installation impossible (tests de la page en échec).');
  if (disparues.length) lignes.push(`- Suites de Racine supprimées : ${disparues.join(', ')} (à remettre).`);
  for (const r of echecs) {
    lignes.push(`- ${r.fichier} (code ${r.code === null ? 'tué' : r.code}, ${Math.round(r.ms / 1000)} s)`);
    lignes.push(extrait(r.sortie));
  }
  lignes.push(`${echecs.length}/${nombre} suite(s) en échec. Corrige avant de terminer.`,
    'Interdit : supprimer, sauter ou affaiblir un test existant pour passer ce contrôle.',
    'Si l\'échec est voulu (ex. test inversé par la version), adapte le test ET dis-le dans PROGRESSION.');
  let message = lignes.join('\n');
  if (message.length > MESSAGE_MAX) message = message.slice(0, MESSAGE_MAX) + '\n[… tronqué]';

  if (FORCER) { console.log(message); return 1; }

  const essais = e.stop_hook_active ? Number(lire(F_ESSAIS, '0')) || 0 : 0;
  if (essais >= ESSAIS_MAX) {
    ecrire(F_ESSAIS, '0');
    process.stdout.write(JSON.stringify({
      systemMessage: `⚠️ Tests JARVIS encore rouges après ${ESSAIS_MAX} essais (${echecs.length} suite(s)`
        + `${manifeste.status !== 0 ? ', manifeste' : ''}${disparues.length ? ', suites supprimées' : ''}).`
        + ' Ne pas fusionner.',
    }));
    return 0;
  }
  ecrire(F_ESSAIS, String(essais + 1));
  process.stderr.write(message + '\n');
  return 2;
}

principal().then((c) => process.exit(c), (err) => {
  // Une panne du contrôle ne doit jamais bloquer la session : on le signale.
  process.stdout.write(JSON.stringify({ systemMessage: '⚠️ Contrôle des tests en panne : ' + String(err && err.message || err) }));
  process.exit(0);
});
