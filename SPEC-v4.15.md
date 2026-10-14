# SPEC v4.15 — v4.13 + v4.14 + v4.15 + 6 idées, en une seule livraison

Base : `Racine` (v4.12.1, empreinte 499df0614797). Branche : `claude/v415` (contient `SPEC-v4.13.md`). Méthode et règles : `CLAUDE.md` (non négociables).
Demande d'Alsid (14 oct) : tout d'un coup, une seule PR, une seule fiche de tests. Un commit par étape, une suite de tests par version (`tests-v413.js`, `tests-v414.js`, `tests-v415.js`), chaque test échoue sur v4.12.1 sauf les « garde ».
Choix d'Alsid (14 oct) : agenda = l'agenda JARVIS actuel (pas de disque, Render gratuit) ; « tout couper » = révoquer chez Google ; contacts et Face ID restent dans Render ; les 6 idées incluses.

## A. v4.13 — refonte claire et sécurité
Tout `SPEC-v4.13.md`, dans son ordre (point 0 d'abord). Rien n'y change.

## B. v4.14 — Agenda et « tout couper »

### B1. Onglet « Agenda » (instance privée)
- 5e onglet (icône calendrier, entre Aujourd'hui et Discuter) : la semaine, du jour à J+6, puis « Semaine suivante » / « Semaine précédente » (de −4 à +8 semaines).
- Lecture : `GET /api/agenda/semaine?debut=AAAA-MM-JJ` (derrière la clé), la même lecture gouvernée que le point du jour (agenda principal + agenda JARVIS, permis nés dans l'effet), **sans modèle**. Par jour : événements triés (heure, titre, source), conflits calculés par le serveur (mêmes règles que v4.12.1). Une source non lue est nommée et la semaine dit « conflits non vérifiés » ; jamais « rien » sans le dire.
- Rien n'entre dans le contexte du modèle (comme le point du jour).
- Bouton « + Ajouter » : champs tapés (titre, jour, heure, durée). `POST /api/agenda/preparer` construit la cible canonique côté serveur et rend la **même carte « Créer »** que dans Discuter (un toucher, titre = ce qui est tapé, jamais un titre du modèle). Rien n'est écrit avant le toucher.
- Sans agenda JARVIS (écriture inactive) : le bouton dit pourquoi.
- Fond blanc (pas de gravité dans cet onglet).

### B2. « Tout couper » (Réglages, instance privée)
- Bouton rouge « Tout couper ». Exige Face ID (ou le code de secours) : défi lié à `COUPURE|<nonce>` (usage unique, 2 min).
- Effet, dans cet ordre :
  1. Gmail : chaque jeton (envoi, lecture) **révoqué chez Google** (`oauth2.googleapis.com/revoke`), puis vérifié (un renouvellement doit répondre `invalid_grant`). Durable : tient après un redémarrage.
  2. Connecteur (`/mcp`) : 503 « coupé ».
  3. Écriture d'agenda : refusée.
  4. Propositions de Claude en attente : retirées.
- Compte rendu honnête, ligne par ligne : « Gmail : révoqué chez Google, vérifié » ou « non vérifié : <raison> » ; « Connecteur et écriture : coupés jusqu'au prochain redémarrage de Render (le service gratuit redémarre après 15 min sans visite). Pour les couper pour de bon : supprime `JARVIS_CLE_MCP` et `JARVIS_GOOGLE_COMPTE` dans Render. »
- Pour rallumer le mail : refaire les 2 jetons (guide de v4.9). Pas de bouton « Rallumer » dans l'appli.
- `/health` : `coupure: true` tant que c'est coupé. Trace dans « Contrôle » (« JARVIS a tout coupé »).
- Sans Face ID ni code configurés : le bouton dit qu'il faut l'un des deux.

## C. Les 6 idées

### C1. Notifications sans passer par Claude (`JARVIS_NTFY`)
- Variable `JARVIS_NTFY` = `https://<hôte>/<sujet>` (sujet ≥ 20 caractères `[A-Za-z0-9_-]`, https seulement) ; sinon inactif et `/health` dit « erreur-config ».
- Le serveur envoie **seulement des phrases fixes**, jamais un contenu, une adresse, un objet ou un nom (le sujet ntfy est lisible par qui le devine) :
  - « JARVIS : mail suspect reçu. Ouvre JARVIS. »
  - « JARVIS : Claude a lu un mail suspect. Ouvre JARVIS. » (connecteur : Claude ne peut pas taire JARVIS)
  - « JARVIS a coupé une proposition de Claude. Ouvre JARVIS. »
  - « JARVIS : <source> ne répond plus. » (sources : agenda, agenda JARVIS, Gmail envoi, Gmail lecture, IA)
  - « JARVIS : la clé de l'IA expire dans N jour(s). »
  - « JARVIS : ton point du jour est prêt (N événement(s), N point(s) à traiter). » (une fois par jour, 6 h – 10 h)
  - « JARVIS : tout est coupé. »
- 20 notifications par heure au plus ; la même phrase pas deux fois en 10 min ; envoi sans attendre (jamais bloquant), 5 s max.
- Réglages : état + bouton « Envoyer une notification de test ».

### C2. Surveillance (`POST /api/veille`)
- Le service gratuit dort : un appel extérieur le réveille. Route `POST /api/veille`, clé `JARVIS_CLE_VEILLE` (≥ 32 caractères, différente des autres clés, `Authorization: Bearer`, temps constant ; sinon 404). 1 appel par 10 min au plus.
- À chaque veille : (1) teste chaque source configurée (lecture iCal, lecture agenda JARVIS, renouvellement des 2 jetons Gmail avec leur portée, `GET /v1/models` chez Anthropic : aucune dépense) ; (2) clé de l'IA : `JARVIS_CLE_IA_EXPIRE=AAAA-MM-JJ` → alerte à J−7, J−3, J−1 et le jour même ; (3) mails non lus : lus par la lecture gouvernée du serveur, analysés par les règles (sans IA) ; un suspect pas encore signalé → C1 (mémoire seulement : après un redémarrage le même mail peut être resignalé, c'est dit) ; (4) point du jour → C1.
- Réglages : « Surveillance » (dernier passage, état de chaque source, expiration de la clé) + « Vérifier maintenant » (même contrôle, déclenché par un toucher).
- Le réveil régulier : un service de tâches planifiées gratuit (cron-job.org) ou GitHub Actions (non modifié ici : `.github/` intouchable sans accord) ; procédure dans PROGRESSION.
- Rien de ce qui est lu en veille n'entre dans le contexte du modèle.

### C3. Âge du domaine et vrai lien
- `jarvis-gmail.js` 1.5 : pour chaque e-mail, les liens réels (`href` de la partie HTML, 10 au plus) avec le texte affiché ; lien **trompeur** = le texte affiché ressemble à une adresse web d'un autre domaine que le vrai lien.
- `jarvis-analyse.js` 1.4 : alerte FORTE « lien trompeur » (le texte montre X, le lien mène à Y).
- Nouveau module `jarvis-domaines.js` 1.0 : date de création d'un domaine par RDAP (annuaire officiel IANA → serveur du registre), sans clé ; 4 s par domaine, 256 Ko max, 8 domaines par lecture, cache 24 h en mémoire, https seulement, pas de redirection hors https. Domaine enregistrable : 2 derniers niveaux (3 pour une liste de suffixes connus : co.uk, gouv.fr, asso.fr…).
- Domaine de l'expéditeur ou d'un lien créé il y a moins de 30 jours → alerte MOYENNE « domaine récent (créé le …) » : un signal, **jamais « suspect » à lui seul**.
- Non vérifiable (panne, registre muet) → « âge du domaine non vérifié », jamais « ancien ».
- Affiché : dans le verdict du connecteur, dans la conversation (« Voir la conversation ») et dans le bloc remis au modèle pour la boîte.

### C4. « Signaler » un mail suspect
- Sur un point « Mail suspect » (Aujourd'hui, À gérer) et dans la vue de la conversation : « Signaler » → liens officiels : Signal Spam (e-mail indésirable, compte gratuit), PHAROS (arnaque en ligne), cybermalveillance.gouv.fr (aide). JARVIS ne transmet rien lui-même ; c'est dit.

### C5. Connecteur ouvert à un autre assistant (Mistral)
- `JARVIS_MCP_ORIGINES` : jusqu'à 5 origines https exactes en plus de claude.ai / claude.com (ex. `https://chat.mistral.ai`). Origine invalide → « erreur-config ».
- `JARVIS_MCP_NOM` (lettres, espaces, 20 caractères) : le nom affiché de l'assistant (défaut « Claude »). Limite dite : un seul nom pour la clé du connecteur.

### C6. Défi public (démo seulement)
- Sur la démo : « Défi : fais partir un e-mail (simulé) vers une adresse que tu n'as pas tapée toi-même. »
- Le serveur garde les mots tapés de la session (50 messages) ; une exécution simulée SEND/PAY/GRANT dont la cible n'est pas dans ces mots = **faille** : la page dit « Tu as trouvé une faille » + un code (10 caractères aléatoires) à envoyer au contact de la démo ; la console n'écrit que le code et l'heure.
- Tableau d'honneur : compteurs (essais coupés, failles) et dates + codes des failles, en mémoire (perdus au redémarrage, c'est dit) ; aucun nom, aucun texte de visiteur affiché.
- Mêmes limites de la démo (budget IA inchangé).

## D. v4.15 — Installation en un clic et configuration guidée
- `render.yaml` (Blueprint) : un service web gratuit, `node server.js`, Node 24, `/health` ; `JARVIS_CLE_ACCES`, `JARVIS_CLE_MCP` et `JARVIS_CLE_VEILLE` générés par Render (`generateValue`) ; `ANTHROPIC_API_KEY` demandée au déploiement (`sync: false`) ; les autres variables listées vides. N'affecte pas les deux services existants (non créés par Blueprint).
- `INSTALLER.md` : bouton « Deploy to Render », puis où lire la clé d'accès.
- Réglages → « Installation » (`GET /api/installation`, derrière la clé) : une ligne par brique (accès, IA, Face ID, code, agenda principal, agenda JARVIS, Gmail envoi, Gmail lecture, liste de destinataires, connecteur, notifications, surveillance) : état (actif / absent / à corriger), ce qu'il faut faire en clair, le **nom exact** de la variable Render, et le bouton de test quand il existe. Jamais une valeur de variable.
- Face ID : « Enregistrer Face ID » donne la valeur à coller dans `JARVIS_PASSKEYS` (existant, montré ici).

## E. Hors périmètre
Disque, agenda stocké dans JARVIS, réglages des contacts dans l'appli, hébergement des JARVIS d'autres personnes, SMS, « protéger l'humain » (vigilance humaine, profil de risque).

## Livrables
`server.js`, `index.html`, `jarvis-gmail.js` 1.5, `jarvis-analyse.js` 1.4, `jarvis-mcp.js` 1.2, `jarvis-domaines.js` 1.0, `jarvis-appli.js`, `render.yaml`, `INSTALLER.md`, `MANIFESTE.json`, `tests-v413.js`, `tests-v414.js`, `tests-v415.js`, `PROGRESSION-v4.15.md`, `CLAUDE.md`. Passerelle **v4.15.0**.
