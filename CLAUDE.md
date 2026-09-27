# JARVIS — consignes pour Claude (dépôt public : aucun secret, aucune adresse privée)

## État (branche `Racine`, après fusion de la PR v4.10.1)
- Passerelle **v4.10.1** (avant : v4.10) ; empreinte : voir `MANIFESTE.json`. Node 24 (Render), CI GitHub Actions Node 22 et 24.
- Noyau `jarvis-5.28.3.js` (**NE JAMAIS MODIFIER**), couche 5.30.3 (`jarvis-plus-5.29.js`), `jarvis-gmail.js` 1.3, `jarvis-verite.js` 1.5, `jarvis-analyse.js` 1.1.
- v4.9.1 : « Ouvrir dans Mail » (mailto:), demande double dite, historique 12 échanges, pages `/confidentialite` et `/conditions`.
- v4.10 : « qu'est-ce que j'ai à gérer ? » (agenda + conversations + notes, sans IA), conversations entières, réponse dans la conversation, créneau vérifié contre l'agenda, rappels, sauvegarde des souvenirs (fichier).
- v4.10.1 : fils Gmail regroupés (objet normalisé + même correspondant, 4 au plus), DMARC (1er en-tête Authentication-Results), offres d'agenda retirées, interface allégée sur l'instance privée (« Tout afficher »), lecture 4 par 4, « Repartir au vert », carte périmée relue, « à gérer » dans le point du jour.
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
- Un souvenir (y compris restauré d'un fichier) peut ajuster une proposition (délai de relance, notes), jamais donner une permission ni une cible.
- Authentification d'un e-mail : seul le PREMIER en-tête `Authentication-Results` (signé `mx.google.com`) compte ; DMARC ne rabaisse une alerte « sensible » que pour un grand service (jamais une messagerie ouverte à tous), sans urgence ni autre alerte forte. Un mail suspect n'offre ni réponse, ni rappel, ni créneau.
- Interface allégée (instance privée) : jamais replié — le verdict, le mot « suspect », un vrai e-mail (destinataire, objet, texte), Face ID, l'adresse à retaper, Annuler / Confirmer.
- Une action par message : ce qui n'est pas fait est dit par le serveur ; le modèle ne propose jamais d'agir à la place de la personne.
- Fermé par défaut : une variable mal réglée désactive l'outil et `/health` le dit ; jamais de repli silencieux vers la simulation.
- Aucun secret (clé, jeton, client OAuth, code) dans un commit, un journal, une capture, un message ou une réponse d'API.

## Méthode (depuis v4.9.1)
- Travail sur `claude/<version>` ; **jamais de push sur `Racine`** (protégée : PR + CI obligatoires, pas de push forcé).
- Un commit par étape validée ; une seule PR à la fin, CI verte ; **Alsid fusionne**.
- Chaque nouveau test doit **échouer sur la version précédente** (`JARVIS_DIR=../vPREC node tests-vNEW.js`), sauf les « garde » ; les suites existantes restent vertes.
- Tests de mutation : casser chaque correctif à la main → au moins un test doit tomber.
- `node jarvis-manifeste.js --ecrire` après toute modification d'un fichier du manifeste, puis `--verifier`.
- Lancer les suites : `npm install --no-save jsdom` puis `for f in tests-*.js; do node "$f" || echo "ECHEC $f"; done`.
- Livrer `PROGRESSION-vX.md` : tests à faire en ligne (iPhone, Safari) et réglages Render.

## Style de réponse attendu
- Ultra-concis, critique, sans formules de politesse ni transitions.
- Seulement les sections modifiées, jamais tout le fichier.
- Ne pas couper la réflexion : vérifier à fond ce qui est important, ne rien refaire sans raison.
