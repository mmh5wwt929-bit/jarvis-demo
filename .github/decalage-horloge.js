/*
 * JARVIS — décalage d'horloge pour les tests (jamais en production)      1.0
 *
 * Fait tourner les suites « comme si on était » à une autre date, pour
 * trouver les tests piégés par la date (« 1er » du mois, date fixe passée,
 * changement d'heure, nouvel an…) AVANT qu'ils cassent la CI de Racine.
 *
 *   JARVIS_DECALAGE_MS=$((7*86400000)) NODE_OPTIONS="--require $PWD/.github/decalage-horloge.js" node tests-v48.js
 *
 * Décale Date (new Date(), Date.now()) de JARVIS_DECALAGE_MS, et transmet le
 * décalage :
 *   - aux processus enfants (serveurs lancés par les suites), même quand une
 *     suite leur donne un environnement vidé ;
 *   - aux pages simulées par jsdom (leur Date vient d'un autre contexte vm).
 * Les minuteries (setTimeout, performance.now) ne sont pas touchées.
 */
'use strict';
const D = Number(process.env.JARVIS_DECALAGE_MS) || 0;

if (D) {
  /* Les suites remplacent parfois Date.now (temps simulé) : ce remplacement est
   * gardé à part et rendu tel quel ; notre horloge reste l'originale + D. */
  const source = `(function (D) {
    const Vrai = Date, base = Vrai.now.bind(Vrai), maintenant = () => base() + D;
    let nowPerso = null;
    globalThis.Date = new Proxy(Vrai, {
      construct: (c, a, nt) => Reflect.construct(c, a.length ? a : [maintenant()], nt),
      apply: () => new Vrai(maintenant()).toString(),
      get: (c, p, r) => (p === 'now' ? (nowPerso || maintenant) : Reflect.get(c, p, r)),
      set: (c, p, v, r) => (p === 'now' ? ((nowPerso = v), true) : Reflect.set(c, p, v, r)),
    });
  })`;
  const vm = require('vm');
  // eslint-disable-next-line no-eval
  (0, eval)(source)(D);

  const creer = vm.createContext;
  vm.createContext = function (...a) {
    const ctx = creer.apply(this, a);
    try { vm.runInContext(source, ctx)(D); } catch { /* contexte sans globalThis modifiable */ }
    return ctx;
  };

  const cp = require('child_process');
  const ajout = { JARVIS_DECALAGE_MS: String(D), NODE_OPTIONS: '--require ' + __filename };
  const avecEnv = (o) => (o && o.env ? { ...o, env: { ...o.env, ...ajout } } : o);
  for (const nom of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
    const orig = cp[nom];
    cp[nom] = function (cmd, args, opts, ...reste) {
      if (Array.isArray(args)) return orig.call(this, cmd, args, avecEnv(opts), ...reste);
      return orig.call(this, cmd, avecEnv(args), opts, ...reste);
    };
  }
}
