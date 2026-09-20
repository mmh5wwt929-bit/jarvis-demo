/* ============================================================================
   JARVIS — Parcours guidé
   ----------------------------------------------------------------------------
   Ce script ne réimplémente rien. Il pilote les boutons qui existent déjà dans
   la console : il clique "nouvelle session", puis "un e-mail piégé", puis
   "Lancer les 8", et commente ce qui se passe vraiment à l'écran.

   L'attaque montrée est donc l'attaque réelle, pas une animation.

   INSTALLATION
     1. Poser ce fichier à côté de index.html dans le repo.
     2. Ajouter juste avant </body> :
          <script src="jarvis-tour.js" defer></script>
     3. C'est tout. Aucune modification du reste de la page.

   SI UN LIBELLÉ CHANGE
     Les cibles sont trouvées par leur texte visible (voir ÉTAPES plus bas).
     Si tu renommes un bouton dans l'interface, change la chaîne `cible`
     correspondante ici. Le parcours saute proprement une étape dont la cible
     est introuvable plutôt que de casser.
   ========================================================================== */

(() => {
  'use strict';

  /* --------------------------------------------------------------------------
     ÉTAPES
     cible  : texte visible du bouton à piloter (insensible à la casse/accents)
     action : 'clic' | null
     pause  : ms d'attente après l'action, le temps que la console se mette à jour
     ------------------------------------------------------------------------ */
  const ÉTAPES = [
    {
      titre: 'Ce que tu vas voir',
      texte: 'JARVIS s\u2019intercale entre ce que l\u2019agent veut faire et ce qui arrive vraiment. En cinq étapes, une attaque réelle va être refusée — sans qu\u2019aucune règle n\u2019ait été écrite pour ce cas précis.',
      cible: null,
      action: null,
      pause: 0,
      bouton: 'Commencer'
    },
    {
      titre: 'Session vierge',
      texte: 'On repart de zéro. Le plancher de confiance est au vert : tout ce que l\u2019agent sait vient de toi.',
      cible: 'nouvelle session',
      action: 'clic',
      pause: 700
    },
    {
      titre: 'L\u2019agent lit un e-mail piégé',
      texte: 'L\u2019agent vient de lire un contenu qu\u2019il ne contrôle pas. Regarde la barre, en haut.',
      cible: 'un e-mail piégé',
      action: 'clic',
      pause: 900
    },
    {
      titre: 'Le plancher tombe',
      texte: 'Rouge. L\u2019origine est tracée et conservée. Rien n\u2019est encore bloqué : le noyau a seulement cessé de traiter le contexte comme fiable.',
      cible: null,
      action: null,
      pause: 0,
      viser: 'plancher'
    },
    {
      titre: 'On lance les attaques',
      texte: 'Huit attaques réelles partent contre l\u2019instance vivante — dont celle que l\u2019e-mail préparait : faire transférer les factures à un tiers.',
      cible: 'lancer les 8',
      action: 'clic',
      pause: 2200
    },
    {
      titre: 'Refusé',
      texte: 'REFORMULATION_REQUISE. L\u2019action n\u2019a pas été refusée par une règle écrite pour ce cas précis. Elle a été refusée parce que sa provenance ne remonte pas à toi.',
      cible: null,
      action: null,
      pause: 0,
      viser: 'resultats'
    },
    {
      titre: 'C\u2019est tout le principe',
      texte: 'Tu décides, le noyau arbitre avant que ça arrive. Le banc de tests rejoue seize suites d\u2019attaques à chaque déploiement.',
      cible: null,
      action: null,
      pause: 0,
      bouton: 'Explorer librement'
    }
  ];

  /* --------------------------------------------------------------------------
     Repérage des éléments par texte visible
     ------------------------------------------------------------------------ */

  const normaliser = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const CLIQUABLES = 'button, a, [role="button"], input[type="button"], input[type="submit"]';

  function trouverParTexte(texte) {
    const cherché = normaliser(texte);
    if (!cherché) return null;
    const candidats = [...document.querySelectorAll(CLIQUABLES)];
    // correspondance exacte d'abord, puis partielle
    return (
      candidats.find((el) => normaliser(el.textContent || el.value) === cherché) ||
      candidats.find((el) => normaliser(el.textContent || el.value).includes(cherché)) ||
      null
    );
  }

  function trouverZone(nom) {
    if (nom === 'plancher') {
      // le bandeau de confiance : on cherche le libellé, on remonte au conteneur
      const libellé = [...document.querySelectorAll('*')].find(
        (el) =>
          el.children.length === 0 &&
          normaliser(el.textContent).startsWith('plancher de confiance')
      );
      return libellé ? libellé.closest('div, section, header') || libellé.parentElement : null;
    }
    if (nom === 'resultats') {
      const bouton = trouverParTexte('lancer les 8');
      return bouton ? bouton.closest('div, section') : null;
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     Styles — repris de la console : fond quasi noir, texte clair, accent bleu
     du bouton Envoyer. Un seul moment appuyé : le halo sur l'élément visé.
     ------------------------------------------------------------------------ */

  const CSS = `
    .jt-lanceur {
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
      display: inline-flex; align-items: center; gap: .55rem;
      padding: .7rem 1.05rem; border: 0; border-radius: 9px;
      background: #4a9eff; color: #06121f;
      font: 600 15px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
      cursor: pointer; box-shadow: 0 6px 22px rgba(0,0,0,.45);
    }
    .jt-lanceur:hover { background: #63adff; }
    .jt-lanceur:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    .jt-lanceur[hidden] { display: none; }

    .jt-barre {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483001;
      background: #0d1219; border-top: 1px solid #263141;
      padding: 1rem 1.15rem calc(1rem + env(safe-area-inset-bottom, 0px));
      color: #dbe4ef;
      font: 400 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 -10px 34px rgba(0,0,0,.5);
    }
    .jt-barre[hidden] { display: none; }
    .jt-inner { max-width: 62ch; margin: 0 auto; }

    .jt-compte {
      color: #7d8da1; font-size: 12.5px; letter-spacing: .02em;
      margin: 0 0 .35rem;
    }
    .jt-titre {
      margin: 0 0 .3rem; font-size: 16.5px; font-weight: 650; color: #f2f6fb;
    }
    .jt-texte { margin: 0 0 .9rem; }

    .jt-actions { display: flex; gap: .6rem; align-items: center; }
    .jt-suivant {
      padding: .6rem 1.1rem; border: 0; border-radius: 8px;
      background: #4a9eff; color: #06121f;
      font: 600 15px/1 system-ui, -apple-system, sans-serif; cursor: pointer;
    }
    .jt-suivant:hover { background: #63adff; }
    .jt-suivant:disabled { opacity: .5; cursor: progress; }
    .jt-passer {
      background: none; border: 0; color: #8b9ab0; cursor: pointer;
      font: 400 14px/1 system-ui, sans-serif; text-decoration: underline;
      padding: .6rem .3rem;
    }
    .jt-passer:hover { color: #c4d0de; }
    .jt-suivant:focus-visible, .jt-passer:focus-visible {
      outline: 2px solid #4a9eff; outline-offset: 2px;
    }

    /* le seul effet appuyé du parcours */
    .jt-vise {
      position: relative; z-index: 2147482000;
      box-shadow: 0 0 0 2px #4a9eff, 0 0 0 9px rgba(74,158,255,.18);
      border-radius: 8px;
      transition: box-shadow .18s ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .jt-vise { transition: none; }
    }
  `;

  /* --------------------------------------------------------------------------
     Construction
     ------------------------------------------------------------------------ */

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const lanceur = document.createElement('button');
  lanceur.className = 'jt-lanceur';
  lanceur.type = 'button';
  lanceur.innerHTML = '<span aria-hidden="true">\u25B6</span> Voir une attaque être bloquée';

  const barre = document.createElement('section');
  barre.className = 'jt-barre';
  barre.hidden = true;
  barre.setAttribute('aria-live', 'polite');
  barre.innerHTML = `
    <div class="jt-inner">
      <p class="jt-compte"></p>
      <h2 class="jt-titre"></h2>
      <p class="jt-texte"></p>
      <div class="jt-actions">
        <button type="button" class="jt-suivant"></button>
        <button type="button" class="jt-passer">Quitter le parcours</button>
      </div>
    </div>
  `;

  document.body.append(lanceur, barre);

  const elCompte  = barre.querySelector('.jt-compte');
  const elTitre   = barre.querySelector('.jt-titre');
  const elTexte   = barre.querySelector('.jt-texte');
  const btnSuivant = barre.querySelector('.jt-suivant');
  const btnPasser  = barre.querySelector('.jt-passer');

  let index = 0;
  let visé = null;

  function retirerHalo() {
    if (visé) { visé.classList.remove('jt-vise'); visé = null; }
  }

  function poserHalo(el) {
    retirerHalo();
    if (!el) return;
    visé = el;
    el.classList.add('jt-vise');
    const doux = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: doux ? 'auto' : 'smooth', block: 'center' });
  }

  function afficher(i) {
    const é = ÉTAPES[i];
    elCompte.textContent = `Étape ${i + 1} sur ${ÉTAPES.length}`;
    elTitre.textContent = é.titre;
    elTexte.textContent = é.texte;
    btnSuivant.textContent = é.bouton || 'Suivant';
    btnSuivant.disabled = false;

    // on vise soit une zone nommée, soit le bouton que l'étape va actionner
    const cible = é.viser ? trouverZone(é.viser) : (é.cible ? trouverParTexte(é.cible) : null);
    poserHalo(cible);
  }

  async function avancer() {
    const é = ÉTAPES[index];

    if (é.action === 'clic' && é.cible) {
      const bouton = trouverParTexte(é.cible);
      if (bouton) {
        btnSuivant.disabled = true;
        bouton.click();
        if (é.pause) await new Promise((r) => setTimeout(r, é.pause));
      }
      // bouton introuvable : on passe à l'étape suivante sans bloquer
    }

    index += 1;
    if (index >= ÉTAPES.length) { terminer(); return; }
    afficher(index);
  }

  function démarrer() {
    index = 0;
    lanceur.hidden = true;
    barre.hidden = false;
    document.body.style.paddingBottom = barre.offsetHeight + 'px';
    afficher(0);
    btnSuivant.focus();
  }

  function terminer() {
    retirerHalo();
    barre.hidden = true;
    lanceur.hidden = false;
    document.body.style.paddingBottom = '';
    lanceur.focus();
  }

  lanceur.addEventListener('click', démarrer);
  btnSuivant.addEventListener('click', avancer);
  btnPasser.addEventListener('click', terminer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !barre.hidden) terminer();
  });
  window.addEventListener('resize', () => {
    if (!barre.hidden) document.body.style.paddingBottom = barre.offsetHeight + 'px';
  });
})();
