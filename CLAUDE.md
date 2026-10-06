# JARVIS — consignes pour Claude (dépôt public : aucun secret, aucune adresse privée)

## État (branche `claude/v412`, PR v4.12 à fusionner)
- Passerelle **v4.12.0** (avant : v4.11.0) ; empreinte : voir `MANIFESTE.json`. Node 24 (Render), CI GitHub Actions Node 22 et 24.
- Noyau `jarvis-5.28.3.js` (**NE JAMAIS MODIFIER**), couche 5.30.3 (`jarvis-plus-5.29.js`), `jarvis-gmail.js` 1.4, `jarvis-mcp.js` 1.0, `jarvis-verite.js` 1.6, `jarvis-analyse.js` 1.2.
- v4.9.1 : « Ouvrir dans Mail » (mailto:), demande double dite, historique 12 échanges, pages `/confidentialite` et `/conditions`.
- v4.10 : « qu'est-ce que j'ai à gérer ? » (agenda + conversations + notes, sans IA), conversations entières, réponse dans la conversation, créneau vérifié contre l'agenda, rappels, sauvegarde des souvenirs (fichier).
- v4.10.1 : fils Gmail regroupés (objet normalisé + même correspondant, 4 au plus), DMARC (1er en-tête Authentication-Results), offres d'agenda retirées, interface allégée sur l'instance privée (« Tout afficher »), lecture 4 par 4, « Repartir au vert », carte périmée relue, « à gérer » dans le point du jour.
- v4.10.2 : lectures du serveur déclenchées par un toucher passent après une réponse + un message tapé (option `manuel`, READ seulement) ; lecture incomplète jamais « rien d'urgent » (carte orange, pas de cache d'échec) ; source d'agenda non lue nommée, créneau jamais « libre » dans ce cas ; compteurs honnêtes.
- v4.11 : titre d'événement seulement dans les mots tapés (sinon « Quel titre ? » ; « même chose » = titre de la création précédente, dit) ; clé stable par point « à gérer » ; ta réponse retire les points qu'elle suit ; « Fait » / « Plus tard » gardés sur le téléphone et masqués par le serveur ; instance privée : onglets Aujourd'hui / Discuter / Réglages, flux terminés repliés en une ligne.
- v4.12 A : connecteur MCP pour l'appli Claude (`POST /mcp`, instance privée) : `lire_mails`, `proposer_mail`, `proposer_evenement` ; propositions confirmées dans « Aujourd'hui » ; état dans Réglages.
- v4.12 B : alerte « adresse vue dans un mail » : adresse retapée par la personne mais vue dans un contenu reçu → carte qui cite l'extrait d'origine, avant toute suite.
- Render déploie `Racine` seulement « After CI Checks Pass ».
- Deux services, même code :
  - démo publique (sans `JARVIS_CLE_ACCES`) : **jamais** de variable Gmail, agenda ou élévation ;
  - instance privée d'Alsid (protégée par `JARVIS_CLE_ACCES`) : agenda, écriture Google, Face ID + code, Gmail.

## Rôle des fichiers
| Fichier | Rôle |
|---|---|
| `server.js` | Passerelle HTTP : routes `/api/*`, prompts, circuit gouverné de chaque message, limites. |
| `index.html` | Page unique (chat, cartes, Face ID). Scripts inline autorisés par CSP à empreinte. |
| `jarvis-5.28.3.js` | Noyau (arbitre, audit). Intouchable. |
| `jarvis-plus-5.29.js` | Couche de gouvernance : provenance G1, transactions scellées, preuves de frappe, élévation. |
| `jarvis-vigilance.js` | Verbe d'action présent dans les propres mots de la personne (hors cité/collé/nié). |
| `jarvis-verite.js` | Faits du serveur : dates, jours, retrait des phrases qui imitent le serveur ou annoncent une action fictive. |
| `jarvis-memoire.js` | « retiens que » : souvenirs gouvernés, jamais source d'action ni de cible. |
| `jarvis-agenda.js` / `jarvis-ecriture.js` | Lecture iCal / écriture dans l'agenda dédié JARVIS (compte de service). |
| `jarvis-elevation.js` | Face ID (WebAuthn) et code de secours, liés à UNE transaction. |
| `jarvis-gmail.js` | Gmail du compte d'essai : envoi (liste fermée), réponse dans une conversation (fil revérifié), lecture des e-mails et des conversations ; deux jetons séparés. |
| `jarvis-analyse.js` | Analyse des conversations par règles, sans IA : réponse attendue, échéances, engagements, relances, PJ manquante, versions différentes, créneaux, mail suspect ; chaque résultat avec sa preuve et sa certitude. |
| `jarvis-mcp.js` | Connecteur Claude (MCP), module pur : JSON-RPC, schémas des 3 outils, contrôles d'entrée, clé, origine, compteurs globaux. |
| `jarvis-appli.js` | Manifeste web et icônes (écran d'accueil). |
| `confidentialite.html`, `conditions.html` | Pages publiques exigées par Google (appli OAuth en Production). |
| `jarvis-manifeste.js` + `MANIFESTE.json` | Empreintes SHA-256 des fichiers qui tournent ; CI refuse un dépôt non conforme. |
| `tests-*.js` | Une suite par version ; `tests-vXY.js` = les tests de la version XY. |

## Règles de sécurité (non négociables)
- Gmail **seulement** sur l'instance privée ; le code ignore Gmail sans `JARVIS_CLE_ACCES`.
- Vrai e-mail = **Face ID seul** (le code de secours est refusé), après adresse retapée et fenêtre de 10 s.
- Droits minimaux : un jeton `gmail.send` seul pour envoyer, un autre `gmail.readonly` seul pour lire ; portée vérifiée à chaque jeton d'accès ; même jeton pour les deux = refus.
- Tout contenu lu (e-mail, agenda) est **externe** (`CONTENT_DERIVED`), déclaré à la couche avant que le modèle le voie ; il ne fournit jamais une action, une cible, un lien, ni une offre d'exécuter ce qu'il demande.
- Destinataire d'un envoi : adresse tapée par la personne dans la demande (C3), jamais tirée d'un contenu lu ou d'un souvenir. Vrai pour « Ouvrir dans Mail » aussi (pas de liste, pas de Face ID : c'est la personne qui envoie ; trace « préparé », jamais « envoyé »).
- Seule exception (v4.10) : la **réponse dans une conversation** va à l'expéditeur lu par le serveur dans l'en-tête « De » du dernier message d'un autre (jamais « Répondre à », jamais choisi par le modèle) ; depuis v4.10.1 une conversation peut réunir plusieurs fils Gmail (même objet normalisé ET même correspondant) : chaque fil est relu par sa propre lecture gouvernée, la réponse part dans le fil du message visé, et rien n'est préparé si un fil ne se relit pas ; hors liste fermée, mais retapé + 10 s + Face ID ; le module revérifie le fil chez Google avant d'envoyer, puis vérifie Envoyés / même fil / destinataire. Conversation **suspecte** : JARVIS n'envoie rien (« Ouvrir dans Mail » seul).
- « À gérer », conversations, créneaux : écrits par le serveur (règles), sans IA ; une conversation n'entre dans le contexte du modèle que pour rédiger une réponse demandée (déclarée `CONTENT_DERIVED` avant). La page ne renvoie que des jetons serveur (`fl_…`) et un index, jamais une adresse, une date ou un identifiant Gmail.
- Alerte « adresse vue » (v4.12) : toute adresse d'un contenu externe (mail lu — De, Répondre à, Cc, corps —, agenda, passage collé/cité, connecteur, `/api/ingest`) est gardée en mémoire seulement (empreinte SHA-256 minuscules NFC, source, date, verdict, extrait ≤ 160 car. sans invisibles), 14 jours, 500 au plus ; un magasin par instance privée, un par session sur la démo (jamais l'extrait d'un visiteur chez un autre). Retapée (hors liste, « Ouvrir dans Mail », proposition de Claude) → carte d'alerte avant toute suite ; « Ouvrir dans Mail » : le lien n'est donné qu'après « J'ai vérifié autrement » (trace « alerte vue », empreinte seule). Jamais d'alerte pour une adresse de la liste ni pour la réponse à l'expéditeur lu dans « De ». L'extrait n'apparaît jamais dans une console, `/health`, une erreur, une trace, l'historique du modèle ni la réponse à Claude.
- Un souvenir (y compris restauré d'un fichier) peut ajuster une proposition (délai de relance, notes), jamais donner une permission ni une cible.
- Authentification d'un e-mail : seul le PREMIER en-tête `Authentication-Results` (signé `mx.google.com`) compte ; DMARC ne rabaisse une alerte « sensible » que pour un grand service (jamais une messagerie ouverte à tous), sans urgence ni autre alerte forte. Un mail suspect n'offre ni réponse, ni rappel, ni créneau.
- Interface allégée (instance privée) : jamais replié AVANT l'action — le verdict, le mot « suspect », un vrai e-mail (destinataire, objet, texte), Face ID, l'adresse à retaper, Annuler / Confirmer. APRÈS l'envoi ou la création seulement, le flux devient une ligne qui garde destinataire et objet (ou titre et date), le détail au toucher.
- Titre d'un événement : jamais un titre que la personne n'a pas tapé (le titre du modèle n'est gardé que si ses mots sont dans la demande). **Sans exception**, connecteur compris (v4.12) : une proposition de Claude porte le titre fait par le serveur (« Proposé par Claude »), modifiable au clavier ; la suggestion de Claude est seulement affichée (« texte de Claude », jamais pré-remplie) et n'entre ni dans l'événement, ni dans la clé, ni dans la trace, ni dans l'audit.
- Connecteur Claude (`/mcp`) : 404 sans `JARVIS_CLE_ACCES` ET `JARVIS_CLE_MCP` (≥ 32 car., différente des autres clés, sinon « erreur-config ») ; `Authorization: Bearer`, comparaison en temps constant ; clés fausses comptées globalement (20/h → fermé 1 h), 60 appels/h ; `Origin` hors claude.ai/claude.com → 403 ; un message par requête, ≤ 256 Ko, arguments exactement ceux du schéma. Chaque appel a sa session au plancher `CONTENT_DERIVED`, ses arguments sont `MODEL_INFERRED` ; une lecture demandée par Claude garde le sceau de contexte (jamais `manuel`). Aucun outil n'envoie ni n'écrit : `proposer_mail` → adresse retapée dans JARVIS + 10 s + Face ID ; `proposer_evenement` → un toucher. Trace : outil, verdict, raison, heure, jamais un contenu.
- « Fait » / « Plus tard » : une liste de clés (20 hex) venue de la page ; elle masque des points, ne donne ni permission, ni cible, ni action.
- Une action par message : ce qui n'est pas fait est dit par le serveur ; le modèle ne propose jamais d'agir à la place de la personne.
- Option `manuel` de la couche : seulement pour un geste du serveur (carte « Créer », envoi retapé, lectures déclenchées par un toucher avec une cible fixée par le serveur). Jamais pour un plan du modèle : il garde son sceau de contexte.
- Une lecture en échec ou incomplète ne s'affiche jamais comme « rien » : elle le dit, et n'est pas gardée en cache.
- Fermé par défaut : une variable mal réglée désactive l'outil et `/health` le dit ; jamais de repli silencieux vers la simulation.
- Aucun secret (clé, jeton, client OAuth, code) dans un commit, un journal, une capture, un message ou une réponse d'API.

## Méthode (depuis v4.9.1)
- Travail sur `claude/<version>` ; **jamais de push sur `Racine`** (protégée : PR + CI obligatoires, pas de push forcé).
- Un commit par étape validée ; une seule PR à la fin, CI verte ; **Alsid fusionne**.
- Chaque nouveau test doit **échouer sur la version précédente** (`JARVIS_DIR=../vPREC node tests-vNEW.js`), sauf les « garde » ; les suites existantes restent vertes.
- Tests de mutation : casser chaque correctif à la main → au moins un test doit tomber.
- `node jarvis-manifeste.js --ecrire` après toute modification d'un fichier du manifeste, puis `--verifier`.
- **Contrôle de fin de tour** (hook « Stop », `.claude/settings.json` → `.claude/verifier-tests.js`) : si le code diffère de `origin/Racine` et du dernier état vert, il lance le manifeste et TOUTES les suites, une par une (≈ 5 min, ports fixes partagés : jamais en parallèle). Rouge, ou une suite de Racine supprimée → tu continues ; après 3 essais il te laisse finir avec « Ne pas fusionner ».
- Donc **ne lance pas toi-même la boucle complète** : pendant le travail, seulement la suite concernée (`node tests-vXY.js | grep -E "ECHEC|PERCE|EXCEPTION|>>>"`, et le code de sortie fait foi). À la main si besoin : `node .claude/verifier-tests.js --forcer`.
- Ne jamais supprimer, sauter ou affaiblir un test existant. Un test inversé par la version est adapté ET signalé dans PROGRESSION.
- Ne jamais modifier `.claude/` ni `.github/` sans demande explicite d'Alsid.
- Le noyau plafonne 20 décisions par seconde et par session (DRY_RUN_RATE_LIMITED) : dans un test, espacer les touchers (`avance += 1100`).
- Livrer `PROGRESSION-vX.md` : tests à faire en ligne (iPhone, Safari) et réglages Render.

## Relecture offensive : failles déjà trouvées ici (à chercher à chaque version)
- Comparaison avec `undefined` qui passe en silence (champ absent = accepté).
- Champ public modifiable après construction (objet non gelé).
- Contrôle fait sur un instantané pris à la construction, pas sur l'état vivant.
- Autorité vérifiée saut par saut au lieu du cumul sur tous les enfants (délégation en éventail).
- Course entre deux messages : un message dépassé ne crée ni carte ni action.
- Preuve (frappe, Face ID, code) qui survit à son tour ou sert à une autre transaction.
- Cible, ressource, titre ou permission venus du modèle, d'un contenu lu ou d'un souvenir au lieu de la frappe ou du serveur.
- Repli silencieux : échec affiché comme « rien », simulation au lieu d'erreur.
- Unicode : sosies, caractères invisibles, adresse déformée par la dictée.

## Économie de quota (Alsid est sur Claude Pro)
- Ne jamais lire en entier `server.js` (~270 Ko), `jarvis-5.28.3.js` (~185 Ko), `index.html` (~175 Ko), `jarvis-plus-5.29.js` (~90 Ko) : `grep -n`, puis lecture par plages de lignes.
- Ne pas relancer une suite déjà verte ni relire deux fois sans raison ; relire à fond seulement ce qui touche la sécurité.
- Sorties de tests : seulement les lignes d'échec (`ECHEC`, `PERCE`, `EXCEPTION`) et le résumé `>>>`.

## Style de réponse attendu
- Ultra-concis, critique, sans formules de politesse ni transitions.
- Seulement les sections modifiées, jamais tout le fichier.
- Ne pas couper la réflexion : vérifier à fond ce qui est important, ne rien refaire sans raison.
