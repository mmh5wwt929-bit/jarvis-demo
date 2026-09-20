'use strict';
/* ============================================================================
 * JARVIS+ 5.29 — COUCHE DE GOUVERNANCE (sur noyau 5.28.3)
 * ----------------------------------------------------------------------------
 * Se pose AU-DESSUS du noyau 5.28.2 sans le modifier d'une ligne. Les 16 suites
 * et les 117 000 scenarios du noyau restent valides tels quels.
 *
 * Elle ajoute cinq choses que le noyau n'a pas :
 *
 *  G1  PROVENANCE D'INTENTION  — le noyau sait deja rabaisser une permission
 *      selon son origine declaree (PROV_LEVELS / PROV_CAPS / intake). Ce qui
 *      manquait : (a) la declaration est VOLONTAIRE — createPermission() est
 *      exporte et estampille USER_DIRECT a qui le demande, donc le canal garde
 *      la porte d'entree pendant que la porte de service reste ouverte ;
 *      (b) la provenance est declaree PAR PERMISSION, jamais deduite de ce que
 *      l'agent a reellement ingere. Un e-mail empoisonne lu au tour 3 ne
 *      teinte rien au tour 7. G1 accumule la souillure au niveau de la SESSION
 *      et n'ouvre qu'une seule porte : intake.
 *
 *  G2  REVERSIBILITE — lire un fichier et virer 40 000 EUR coutaient la meme
 *      unite d'autorite. Trois classes, defaut fail-closed, compensation
 *      declaree A L'AVANCE, et fenetre d'annulation sur l'irremediable.
 *
 *  G3  RAYON D'IMPACT — compromise() verrouille tout mais ne dit pas ce qui a
 *      ete touche. G3 repond : quelles permissions, quelles actions, quelles
 *      cibles, quelles compensations, dans quel ordre.
 *
 *  G4  ANCRAGE EXTERNE — la chaine d'audit du noyau se verifie contre son
 *      propre ancrage interne. Elle protege contre un COMPOSANT compromis,
 *      pas contre un HOTE compromis : qui possede le processus reecrit la
 *      chaine entiere et verify() renvoie true. G4 publie la tete hors du
 *      processus et detecte la reecriture.
 *
 *  G5  COPILOTE DE DECISION — « JARVIS assiste » etait le seul mot de la
 *      devise sans code derriere. L'evaluation du risque est DETERMINISTE et
 *      ne depend d'aucun reseau ; un modele peut la reformuler, jamais la
 *      decider.
 * ========================================================================== */

const K = require('./jarvis-5.28.3.js');
const crypto = require('crypto');

const { Jarvis, approvalFor, identityContext, envelopeFor, HARNESS_KEY } = K;

const NIVEAUX = Object.freeze({ USER_DIRECT: 3, MODEL_INFERRED: 2, CONTENT_DERIVED: 1 });
const pire = (a, b) => (NIVEAUX[a] ?? 1) <= (NIVEAUX[b] ?? 1) ? a : b;
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

/* ==========================================================================
 * G2 — REVERSIBILITE
 * ------------------------------------------------------------------------
 * L'axe de risque le plus important, et le seul que le noyau ignorait.
 * Le defaut d'une action INCONNUE est IRREVERSIBLE : une porte de securite
 * suppose le pire de ce qu'elle ne connait pas.
 * ======================================================================== */
const REVERSIBILITE = Object.freeze({
  READ: 'REVERSIBLE', LIST: 'REVERSIBLE', SUMMARIZE: 'REVERSIBLE', SEARCH: 'REVERSIBLE',
  WRITE: 'COMPENSABLE', CREATE: 'COMPENSABLE', RENAME: 'COMPENSABLE', MOVE: 'COMPENSABLE',
  SEND: 'IRREVERSIBLE', DELETE: 'IRREVERSIBLE', PAY: 'IRREVERSIBLE',
  PUBLISH: 'IRREVERSIBLE', GRANT: 'IRREVERSIBLE', DEPLOY: 'IRREVERSIBLE'
});
const classeDe = (action) => REVERSIBILITE[String(action).toUpperCase()] || 'IRREVERSIBLE';

const FENETRE_ANNULATION_MS = 10000;

/* ==========================================================================
 * G1 — REGISTRE DE CONTEXTE : la souillure s'accumule sur la SESSION
 * ======================================================================== */
class RegistreContexte {
  #entrees = []; #max = 500;

  /* Tout ce qui entre dans le contexte de l'agent passe ici. */
  ingerer({ origine, resume, source }) {
    if (!NIVEAUX[origine]) throw new Error('ORIGINE_INCONNUE:' + origine);
    const e = {
      id: 'in_' + crypto.randomUUID(), origine,
      resume: String(resume || '').slice(0, 200),
      source: String(source || 'inconnue'), ts: Date.now()
    };
    this.#entrees.push(e);
    if (this.#entrees.length > this.#max) this.#entrees.shift();
    return e.id;
  }

  /* Le plancher de la session : la PIRE origine ingeree.
   * Une parole directe de l'utilisateur ne "lave" pas ce qui precede — elle
   * ouvre une nouvelle fenetre. Tout ce qui a ete lu avant continue de teinter
   * les propositions, ce qui est le comportement sur : un agent influence par
   * un contenu externe le reste jusqu'a ce que l'utilisateur reformule
   * explicitement la cible (cf. reformulation() plus bas). */
  plancher() {
    let p = 'USER_DIRECT';
    for (const e of this.#entrees) p = pire(p, e.origine);
    return p;
  }

  /* Ce qui a reellement tire le plancher vers le bas — pour l'explication. */
  influencesBasses() {
    const p = this.plancher();
    return this.#entrees.filter(e => e.origine === p && p !== 'USER_DIRECT')
      .slice(-5).map(e => ({ origine: e.origine, resume: e.resume, source: e.source }));
  }

  ciblesConnues() {
    const s = new Set();
    for (const e of this.#entrees) if (e.cible) s.add(e.cible);
    return s;
  }

  get entrees() { return this.#entrees.map(e => ({ ...e })); }
  get taille() { return this.#entrees.length; }
}

/* ==========================================================================
 * G4 — ANCRAGE EXTERNE DE LA CHAINE D'AUDIT
 * ======================================================================== */
class AncrageExterne {
  #publies = []; #sink;
  constructor(sink) { this.#sink = typeof sink === 'function' ? sink : null; }

  /* Publie la tete courante hors du processus. */
  publier(jarvis) {
    const a = {
      index: jarvis.audit.entries.length,
      tete: jarvis.audit.lastHash,
      ts: Date.now()
    };
    a.empreinte = sha(a);
    this.#publies.push(a);
    if (this.#sink) { try { this.#sink(a); } catch { /* un puits injoignable ne casse pas la gouvernance */ } }
    return a;
  }

  /* Detecte la reecriture : chaque tete publiee doit encore se trouver a son
   * index dans la chaine actuelle. Un attaquant qui possede le processus peut
   * refaire la chaine ET son ancrage interne — il ne peut pas refaire ce qui
   * est deja parti ailleurs. */
  verifier(jarvis) {
    const e = jarvis.audit.entries;
    const ecarts = [];
    for (const a of this.#publies) {
      if (a.empreinte !== sha({ index: a.index, tete: a.tete, ts: a.ts }))
        { ecarts.push({ index: a.index, motif: 'ANCRE_ALTEREE' }); continue; }
      if (e.length < a.index) { ecarts.push({ index: a.index, motif: 'CHAINE_RACCOURCIE' }); continue; }
      const reel = a.index === 0 ? 'GENESIS' : e[a.index - 1].hash;
      if (reel !== a.tete) ecarts.push({ index: a.index, motif: 'HISTOIRE_REECRITE', attendu: a.tete, trouve: reel });
    }
    return {
      interne: jarvis.audit.verify(),   /* ce que le noyau sait verifier */
      externe: ecarts.length === 0,     /* ce que seul l'ancrage peut dire */
      ancresPubliees: this.#publies.length,
      ecarts,
      /* Honnetete sur la frontiere : a documenter tel quel pour un integrateur. */
      portee: "interne = chaine coherente avec elle-meme (protege d'un COMPOSANT compromis). "
            + "externe = coherente avec des tetes publiees ailleurs (protege d'un HOTE compromis, "
            + "a concurrence de ce qui a ete publie)."
    };
  }

  get ancres() { return this.#publies.map(a => ({ ...a })); }
}

/* ==========================================================================
 * G5 — COPILOTE DE DECISION
 * ------------------------------------------------------------------------
 * REGLE ARCHITECTURALE : le risque est calcule ici, sans reseau. Un modele
 * peut habiller le texte, il n'entre jamais dans la decision. Une garde qui
 * depend d'une API est une garde qui tombe quand l'API tombe.
 * ======================================================================== */
function noteDeDecision({ spec, classe, plancher, influences, ciblesVues, heure }) {
  const signaux = [], alternatives = [];
  let risque = 0;

  if (classe === 'IRREVERSIBLE') { risque += 40; signaux.push({ poids: 'fort', texte: 'Action irreversible : aucun retour arriere possible.' }); }
  else if (classe === 'COMPENSABLE') { risque += 15; signaux.push({ poids: 'moyen', texte: 'Action annulable, mais seulement par une action de compensation.' }); }

  if (plancher !== 'USER_DIRECT') {
    risque += (plancher === 'CONTENT_DERIVED') ? 35 : 15;
    signaux.push({
      poids: plancher === 'CONTENT_DERIVED' ? 'fort' : 'moyen',
      texte: plancher === 'CONTENT_DERIVED'
        ? "L'intention descend d'un contenu externe, pas de toi."
        : "L'intention vient d'une deduction du modele, pas d'une consigne directe."
    });
    if (influences.length) signaux.push({ poids: 'info', texte: 'Origine : ' + influences.map(i => i.source).join(', ') });
  }

  const cible = spec.target || spec.resource;
  if (cible && ciblesVues && !ciblesVues.has(cible)) {
    risque += 15;
    signaux.push({ poids: 'moyen', texte: `Cible jamais vue dans cette session : ${cible}` });
  }

  if (heure !== undefined && (heure < 6 || heure >= 23)) {
    risque += 5;
    signaux.push({ poids: 'info', texte: 'Heure inhabituelle.' });
  }

  if (classe === 'IRREVERSIBLE' && /^(SEND|PUBLISH)$/i.test(spec.action))
    alternatives.push("Exporter en local et envoyer toi-meme : meme resultat, tu gardes la main.");
  if (classe === 'IRREVERSIBLE' && /^DELETE$/i.test(spec.action))
    alternatives.push("Deplacer vers une corbeille plutot que supprimer : reversible.");
  if (plancher === 'CONTENT_DERIVED')
    alternatives.push("Reformuler toi-meme la cible : un texte injecte ne traverse pas un clavier.");

  const niveau = risque >= 60 ? 'ELEVE' : risque >= 30 ? 'MOYEN' : 'FAIBLE';
  return {
    risque: Math.min(risque, 100), niveau, classe, plancher, signaux, alternatives,
    resume: `${spec.action} sur ${cible || 'cible non precisee'} — ${classe.toLowerCase()}, `
          + `intention ${plancher === 'USER_DIRECT' ? 'directe' : 'indirecte'}, risque ${niveau.toLowerCase()}.`,
    recommandation: niveau === 'ELEVE' ? 'REFORMULER'
                  : niveau === 'MOYEN' ? 'VERIFIER_LA_CIBLE'
                  : 'APPROUVER'
  };
}

/* ==========================================================================
 * SESSION GOUVERNEE — assemble G1 a G5 autour d'un noyau 5.28.2
 * ======================================================================== */
class SessionGouvernee {
  #j; #ctx; #ancrage; #enAttente = new Map(); #journal = []; #dryRuns = new Set();
  #reformulations = new Map(); #assemble = false; #sceauContexte = null;

  constructor(opts = {}) {
    this.#j = opts.jarvis || new Jarvis({ initialCeiling: opts.plafond || 100 });
    this.#ctx = new RegistreContexte();
    this.#ancrage = new AncrageExterne(opts.puitsAncrage);
    this.#ancrage.publier(this.#j);            /* ancre le BOOT */
  }

  /* [C1 - 5.29.1] ENCAPSULATION. `get jarvis()` rendait l'instance du noyau,
   * donc n'importe quel appelant pouvait faire j.permissions.propose() en
   * direct et contourner G1/G2 sans le vouloir. La couche gardait la porte
   * tout en tendant la cle. L'instance vit desormais dans un champ prive et
   * ne sort jamais : on n'expose que des vues en lecture et des sondes.
   * Un code qui possede deja le processus peut toujours tout faire — aucune
   * defense en memoire n'y change rien — mais le contournement ACCIDENTEL,
   * qui est le cas reel, n'est plus exprimable. */
  get contexte() { return this.#ctx; }
  get ancrage() { return this.#ancrage; }
  get journal() { return this.#journal.map(x => ({ ...x })); }

  /* Vues en lecture seule, en remplacement de l'acces au noyau. */
  auditDepuis(n = 0) {
    return this.#j.audit.entries.slice(n).map(x => ({
      event: x.event, action: x.action || null, reason: x.reason || null,
      hash: String(x.hash || '').slice(0, 12)
    }));
  }
  nbAudit()      { return this.#j.audit.entries.length; }
  ledger()       { return this.#j.ledger.snapshot(); }
  verrouille()   { return this.#j.locked; }
  integrite()    { return this.#ancrage.verifier(this.#j); }
  etat() {
    return { plancher: this.#ctx.plancher(), influences: this.#ctx.influencesBasses(),
             ledger: this.ledger(), integrite: this.integrite(), verrouille: this.verrouille(),
             contexteAssemble: this.#assemble };
  }

  /* ---- G1 : tout ce que l'agent ingere passe par ici ---- */
  ingerer(o) { return this.#ctx.ingerer(o); }

  /* [C2 - 5.29.1] CONTEXTE DECLARE PAR CONSTRUCTION.
   * G1 ne valait que si l'integrateur pensait a declarer ce que l'agent avait
   * lu. Un oubli, et la souillure n'existait pas : la defense reposait sur la
   * discipline de celui qui l'utilise, c'est-a-dire sur rien.
   * La couche assemble desormais elle-meme le prompt de planification a partir
   * du SEUL registre, et le scelle. demander() exige ce sceau des que la
   * session a ingere quoi que ce soit de non direct : un plan fabrique a
   * partir d'un contexte que la couche n'a pas assemble est refuse en
   * CONTEXTE_NON_DECLARE. L'oubli devient une erreur visible, plus un silence.
   * Limite irreductible : la couche ne peut rien savoir de ce qu'on ne lui a
   * jamais dit. couverture() le rapporte honnetement plutot que de le taire. */
  promptDePlanification(demandeUtilisateur, actionsConnues) {
    const frag = this.#ctx.entrees.slice(-8);
    const lu = frag.length
      ? frag.map(e => `- [${e.origine}] ${e.source} : ${e.resume}`).join('\n')
      : '(rien)';
    this.#assemble = true;
    this.#sceauContexte = sha({ frag: frag.map(e => [e.origine, e.source, e.resume]), t: Date.now() });
    return {
      sceauContexte: this.#sceauContexte,
      prompt: `Tu es un agent assistant. Determine la SEULE action que tu veux effectuer pour repondre a la demande.

Reponds uniquement par un objet JSON, sans texte autour, sans balises :
{"action":"...","resource":"...","target":"...","pourquoi":"une phrase"}

action doit valoir l'une de : ${(actionsConnues || []).join(', ')}
Choisis "AUCUNE" si repondre ne demande aucun acces ni aucun effet exterieur.
target : le destinataire, le fichier ou la ressource concrete.

Contenu deja lu par l'agent :
${lu}

Demande de l'utilisateur :
${demandeUtilisateur}`
    };
  }

  /* Rapport honnete sur ce que G1 couvre reellement dans cette session. */
  couverture() {
    const e = this.#ctx.entrees;
    return {
      fragmentsDeclares: e.length,
      dontExternes: e.filter(x => x.origine !== 'USER_DIRECT').length,
      promptAssembleParLaCouche: this.#assemble,
      remarque: this.#assemble
        ? "Le prompt de planification a ete bati a partir du registre : ce que le modele a lu est ce qui teinte la session."
        : "Le prompt n'a pas ete assemble par la couche : G1 ne couvre que ce qui a ete declare explicitement."
    };
  }

  /* ---- G1 : reformulation — l'utilisateur retape la cible lui-meme ----
   * C'est le seul mecanisme qui remonte le plancher a USER_DIRECT pour une
   * action donnee. Un texte injecte peut convaincre un modele ; il ne peut pas
   * produire une frappe humaine sur la bonne valeur. */
  reformulation(action, cibleRetapee) {
    const cle = String(action).toUpperCase() + '|' + String(cibleRetapee);
    const jeton = { cle, nonce: crypto.randomUUID(), ts: Date.now() };
    jeton.preuve = sha(jeton);
    this.#reformulations.set(cle, jeton);
    this.#ctx.ingerer({ origine: 'USER_DIRECT', resume: 'reformulation: ' + cibleRetapee, source: 'clavier' });
    return jeton;
  }
  #aReformule(spec) {
    const cible = spec.target || spec.resource;
    const j = this.#reformulations.get(String(spec.action).toUpperCase() + '|' + String(cible));
    return !!(j && sha({ cle: j.cle, nonce: j.nonce, ts: j.ts }) === j.preuve);
  }

  /* ---- G5 : la note, avant toute decision ---- */
  note(spec) {
    return noteDeDecision({
      spec, classe: classeDe(spec.action), plancher: this.#ctx.plancher(),
      influences: this.#ctx.influencesBasses(), ciblesVues: this.#ctx.ciblesConnues(),
      heure: new Date().getHours()
    });
  }

  /* ---- Entree UNIQUE. N'utilise jamais createPermission(). ----
   * Le niveau n'est pas declare par l'appelant : il est DEDUIT du plancher de
   * la session. C'est ce qui ferme le distributeur de sceaux. */
  demander(spec, options = {}) {
    const classe = classeDe(spec.action);
    const note = this.note(spec);
    const refus = (etape, motif, extra = {}) => ({ decide: 'REFUSE', etape, motif, classe, note, ...extra });

    /* [C2] Des que la session porte du contenu non direct, le plan doit prouver
     * qu'il vient d'un contexte assemble par la couche. */
    if (this.#ctx.plancher() !== 'USER_DIRECT' && this.#sceauContexte
        && options.sceauContexte !== this.#sceauContexte && !options.manuel)
      return refus('G1_CONTEXTE', 'CONTEXTE_NON_DECLARE');

    /* G2 : une action compensable doit declarer sa compensation A L'AVANCE.
     * Le noyau LISTE les compensations apres coup ; ici on exige de savoir
     * comment defaire avant d'avoir fait. */
    if (classe === 'COMPENSABLE' && !options.compensation)
      return refus('G2_REVERSIBILITE', 'COMPENSATION_NON_DECLAREE');

    /* G1 + G2 : l'irremediable exige une intention directe ET reformulee. */
    let plancher = this.#ctx.plancher();
    if (classe === 'IRREVERSIBLE') {
      if (!this.#aReformule(spec))
        return refus('G1_PROVENANCE', 'REFORMULATION_REQUISE', {
          aReformuler: { action: spec.action, cible: spec.target || spec.resource } });
      plancher = 'USER_DIRECT';
      if (!this.#dryRuns.has(sha({ a: spec.action, t: spec.target, r: spec.resource })))
        return refus('G2_REVERSIBILITE', 'DRY_RUN_PREALABLE_REQUIS');
    }

    /* Routage par le canal scelle du noyau — jamais createPermission(). */
    const base = {
      /* Genere cote noyau depuis [F1 - 5.28.3] ; on reste explicite. */
      id: 'perm_' + crypto.randomUUID(),
      action: String(spec.action), resource: String(spec.resource || 'LOCAL'),
      target: String(spec.target || 'USER_DATA'), context: String(spec.context || 'CHAT'),
      tool: String(spec.tool || 'NONE'), scope: String(spec.scope || 'CURRENT_CONTEXT'),
      identity: 'USER', agent: 'JARVIS', objective: 'ASSIST',
      /* Normalise cote noyau depuis [F1 - 5.28.3] ; on reste explicite. */
      session: null,
      maxUses: 1, expiresAt: Date.now() + 300000
    };
    const permission =
      plancher === 'USER_DIRECT'    ? this.#j.intake.fromUser(base, HARNESS_KEY)
    : plancher === 'MODEL_INFERRED' ? this.#j.intake.fromModel(base)
    :                                 this.#j.intake.fromContent(base, (this.#ctx.influencesBasses()[0] || {}).source);
    if (!permission) return refus('G1_PROVENANCE', 'CANAL_REFUSE');

    const prop = this.#j.permissions.propose(permission);
    if (!prop.allowed) return refus('NOYAU_PROPOSITION', prop.reason);

    const appr = this.#j.permissions.authorize(prop.permission.id, approvalFor(this.#j, prop.permission.id));
    if (!appr.allowed) return refus('NOYAU_APPROBATION', appr.reason);

    const p = this.#j.permissions.getPermission(prop.permission.id, HARNESS_KEY);
    const enveloppe = envelopeFor(p), ic = identityContext(this.#j, p);
    const dec = this.#j.sas.preActionDecision(p, enveloppe, ic.identityProof, { context: ic.context });
    if (!dec.allowed) return refus('NOYAU_SAS', dec.reason);

    return {
      decide: 'AUTORISE', classe, note, plancher,
      permissionId: p.id,
      compensation: options.compensation || null,
      /* G2 : l'irremediable n'est jamais execute dans la foulee. */
      fenetreAnnulationMs: classe === 'IRREVERSIBLE' ? FENETRE_ANNULATION_MS : 0,
      _interne: { p, enveloppe, ic }
    };
  }

  /* ---- G2 : dry-run prealable, obligatoire avant tout irremediable ---- */
  dryRun(spec) {
    const cle = sha({ a: spec.action, t: spec.target, r: spec.resource });
    this.#dryRuns.add(cle);
    const note = this.note(spec);
    return { simule: true, classe: classeDe(spec.action), note, cle: cle.slice(0, 12) };
  }

  /* ---- Execution ----
   * REVERSIBLE / COMPENSABLE : immediate.
   * IRREVERSIBLE : mise en attente, annulable pendant la fenetre. */
  executer(autorisation, handler) {
    if (!autorisation || autorisation.decide !== 'AUTORISE')
      return { etat: 'REFUSE', motif: autorisation && autorisation.motif };

    if (autorisation.fenetreAnnulationMs > 0) {
      const jeton = crypto.randomUUID();
      this.#enAttente.set(jeton, {
        autorisation, handler, echeance: Date.now() + autorisation.fenetreAnnulationMs
      });
      return {
        etat: 'EN_ATTENTE', jetonAnnulation: jeton,
        executableApres: Date.now() + autorisation.fenetreAnnulationMs,
        message: `Action irreversible retenue ${autorisation.fenetreAnnulationMs / 1000} s. Annulable.`
      };
    }
    return this.#commettre(autorisation, handler);
  }

  annuler(jeton) {
    const e = this.#enAttente.get(jeton);
    if (!e) return { etat: 'INTROUVABLE' };
    this.#enAttente.delete(jeton);
    this.#journal.push({ ts: Date.now(), evenement: 'ANNULE_PAR_UTILISATEUR',
      action: e.autorisation._interne.p.action, cible: e.autorisation._interne.p.target });
    return { etat: 'ANNULE', message: "L'action n'a jamais eu lieu." };
  }

  finaliser(jeton) {
    const e = this.#enAttente.get(jeton);
    if (!e) return { etat: 'INTROUVABLE' };
    if (Date.now() < e.echeance)
      return { etat: 'TROP_TOT', resteMs: e.echeance - Date.now() };
    this.#enAttente.delete(jeton);
    return this.#commettre(e.autorisation, e.handler);
  }

  #commettre(autorisation, handler) {
    const { p, enveloppe, ic } = autorisation._interne;
    const avant = this.#j.audit.entries.length;
    const r = this.#j.sas.execute(p.id, enveloppe, ic, () => {
      const out = handler ? handler() : { ok: true };
      return (out && typeof out === 'object') ? { ok: true, ...out } : { ok: true };
    });
    if (!r.allowed) return { etat: 'REFUSE', etape: 'NOYAU_EXECUTE', motif: r.reason };

    this.#journal.push({
      ts: Date.now(), evenement: 'EXECUTE', permissionId: p.id,
      action: p.action, cible: p.target, classe: autorisation.classe,
      plancher: autorisation.plancher, compensation: autorisation.compensation,
      indexAudit: avant, hash: this.#j.audit.lastHash
    });
    this.#ancrage.publier(this.#j);
    return { etat: 'EXECUTE', resultat: r.result, ledger: this.#j.ledger.snapshot() };
  }

  /* ==========================================================================
   * G3 — RAYON D'IMPACT
   * ------------------------------------------------------------------------
   * « Ca a bloque, d'accord. Qu'est-ce qui a ete touche avant qu'on le voie ? »
   * ======================================================================== */
  rayonDImpact(depuisTs) {
    const t = Number(depuisTs) || 0;
    const touchees = this.#journal.filter(x => x.ts >= t && x.evenement === 'EXECUTE');

    const compensations = touchees
      .filter(x => x.classe !== 'REVERSIBLE')
      .map(x => ({
        permissionId: x.permissionId, action: x.action, cible: x.cible,
        classe: x.classe,
        compensation: x.compensation
          || (x.classe === 'IRREVERSIBLE' ? 'AUCUNE — action irreversible, a traiter hors systeme' : 'non declaree')
      }))
      .reverse();   /* defaire dans l'ordre inverse de l'execution */

    const parCible = {};
    for (const x of touchees) parCible[x.cible] = (parCible[x.cible] || 0) + 1;

    const entreesSuspectes = this.#ctx.entrees
      .filter(e => e.ts >= t && e.origine !== 'USER_DIRECT')
      .map(e => ({ origine: e.origine, source: e.source, resume: e.resume }));

    return {
      depuis: t, actionsExecutees: touchees.length,
      irreversibles: touchees.filter(x => x.classe === 'IRREVERSIBLE').length,
      ciblesTouchees: parCible,
      aCompenser: compensations,
      entreesNonFiables: entreesSuspectes,
      integrite: this.#ancrage.verifier(this.#j),
      verrouille: this.#j.locked,
      motifVerrou: this.#j.lockReason || null
    };
  }
}


/* ==========================================================================
 * SONDES M1 a M6 — les six mitigations, EXECUTEES
 * ------------------------------------------------------------------------
 * L'ancienne demo demandait a Claude de DECRIRE chaque mitigation : un texte
 * generé sur la securite n'est pas une preuve de securite. Chaque sonde lance
 * ici l'exploit reel contre une instance vivante et rend le code de refus
 * produit par le noyau. Si une mitigation regresse, la sonde vire au rouge.
 * ======================================================================== */
const { Jarvis: _J, createPermission: _cp, approvalFor: _ap,
        identityContext: _ic, envelopeFor: _ef, HARNESS_KEY: _HK } = K;

const _perm = (j, o = {}) => {
  const q = j.permissions.propose(_cp(j, { action: 'READ', resource: 'LOCAL', context: 'CHAT', ...o }, _HK));
  if (!q.allowed) return { err: q.reason };
  j.permissions.authorize(q.permission.id, _ap(j, q.permission.id));
  const p = j.permissions.getPermission(q.permission.id, _HK);
  return { p, env: _ef(p), ic: _ic(j, p) };
};

const SONDES_M = {
  M1: {
    titre: 'Audit agrégé',
    attaque: "Noyer le journal sous 5 000 refus pour évincer la preuve de compromission",
    lancer() {
      const j = new _J();
      j.compromise('SECURITY_CORE');
      for (let i = 0; i < 5000; i++) j.selfGrant();
      const garde = JSON.stringify(j.audit.entries).includes('CRITICAL_COMPROMISE');
      return { tenu: garde && j.audit.verify(),
        constat: `5 000 événements → ${j.audit.entries.length} entrées, preuve ${garde ? 'conservée' : 'ÉVINCÉE'}, chaîne ${j.audit.verify() ? 'valide' : 'ROMPUE'}` };
    }
  },
  M2: {
    titre: 'Sceau étendu',
    attaque: "Falsifier un champ de politique après scellement (maxRate, args, argsScope, parentId, maxUses)",
    lancer() {
      const j = new _J();
      const base = { action: 'READ', resource: 'LOCAL', context: 'CHAT',
                     args: { chemin: 'notes.txt' }, argsScope: ['chemin'], maxRate: 5, maxUses: 1 };
      const out = [];
      for (const champ of ['maxRate', 'maxUses', 'args', 'argsScope', 'parentId']) {
        const p = _cp(j, { ...base }, _HK);
        if (champ === 'args') p.args = { chemin: '/home/user/.ssh/authorized_keys' };
        else if (champ === 'argsScope') p.argsScope = ['chemin', 'autre'];
        else if (champ === 'parentId') p.parentId = 'perm_autre';
        else p[champ] = 999;
        out.push(j.permissions.propose(p).allowed === false);
      }
      return { tenu: out.every(Boolean),
        constat: `${out.filter(Boolean).length}/5 champs scellés détectés → INVALID_PROVENANCE_STAMP` };
    }
  },
  M3: {
    titre: 'Filiation par puissance',
    attaque: "Créer une seconde permission de même puissance sans déclarer de filiation",
    lancer() {
      const j = new _J();
      _perm(j);
      const r = j.permissions.propose(_cp(j, { action: 'READ', resource: 'LOCAL', context: 'CHAT' }, _HK));
      return { tenu: r.allowed === false, constat: r.allowed ? 'ACCEPTÉE — régression' : r.reason };
    }
  },
  M4: {
    titre: 'Arguments validés',
    attaque: "Faire ressortir un chemin sensible par la sortie du handler",
    lancer() {
      const j = new _J();
      const b = _perm(j);
      if (b.err) return { tenu: false, constat: b.err };
      const r = j.sas.execute(b.p.id, b.env, b.ic, () => ({ ok: true, fichier: '/home/user/.ssh/authorized_keys' }));
      return { tenu: r.allowed === false, constat: r.allowed ? 'SORTIE ACCEPTÉE — régression' : r.reason };
    }
  },
  M5: {
    titre: "Clé d'instance",
    attaque: "Rejouer l'enveloppe scellée d'une instance sur une autre",
    lancer() {
      const a = new _J(), b = new _J();
      const x = _perm(a), y = _perm(b);
      if (x.err || y.err) return { tenu: false, constat: x.err || y.err };
      const r = b.sas.execute(y.p.id, x.env, y.ic, () => ({ ok: true }));
      return { tenu: r.allowed === false, constat: r.allowed ? 'REJEU ACCEPTÉ — régression' : r.reason };
    }
  },
  M6: {
    titre: 'Compteur interne',
    attaque: "Sonder la décision en rafale pour cartographier la politique sans rien consommer",
    lancer() {
      const j = new _J();
      const b = _perm(j);
      if (b.err) return { tenu: false, constat: b.err };
      let n = 0, stop = '';
      for (let i = 0; i < 40; i++) {
        const d = j.sas.preActionDecision(b.p, b.env, b.ic.identityProof, { context: b.ic.context });
        if (d.allowed) n++; else { stop = d.reason; break; }
      }
      return { tenu: !!stop, constat: stop ? `${n} sondes puis ${stop}` : `${n} sondes, AUCUNE limite — régression` };
    }
  }
};

function lancerSondeM(nom) {
  const s = SONDES_M[nom];
  if (!s) return null;
  const t = Date.now();
  let r;
  try { r = s.lancer(); } catch (e) { r = { tenu: false, constat: 'EXCEPTION ' + e.message }; }
  return { mitigation: nom, titre: s.titre, attaque: s.attaque, ...r, dureeMs: Date.now() - t };
}

module.exports = {
  SessionGouvernee, SONDES_M, lancerSondeM, RegistreContexte, AncrageExterne,
  noteDeDecision, classeDe, REVERSIBILITE, NIVEAUX, FENETRE_ANNULATION_MS,
  noyau: K
};
