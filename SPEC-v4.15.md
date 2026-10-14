# SPEC v4.15 — tout d'un coup : v4.13 + v4.14 + v4.15 + 6 idées

Base : `claude/v413` (Racine v4.12.1 + SPEC-v4.13.md). Branche : `claude/v415`. Règles : `CLAUDE.md` (non négociables).
Demande d'Alsid (14 oct) : une seule mise à jour à tester d'un coup. Choix tranchés le 14 oct, 07:35 :
- Agenda : **onglet sur l'agenda JARVIS actuel** (Google + iCloud), pas de disque.
- Bouton « tout couper » : **révocation chez Google**.
- Les **6 idées** : notifications + surveillance, âge du domaine + vrai lien, Signaler + Mistral, défi public.
- Liste de destinataires et clés Face ID : **restent dans Render**.

Passerelle **v4.15.0**. Aucun disque, aucun stockage serveur nouveau : tout ce qui est nouveau vit en mémoire ou dans une variable Render.

## A. v4.13 — telle que `SPEC-v4.13.md` (points 0 à 8), sans changement
Point 0 (faille : règles appliquées à l'extrait de 1 200 caractères) d'abord, en commit seul.

## B. v4.14 — onglet Agenda, bouton « tout couper »
### B1. Onglet « Agenda » (instance privée)
- 5e onglet (icône calendrier) : la semaine (7 jours) depuis aujourd'hui, ‹ › pour changer de semaine (± 8 semaines).
- `GET /api/agenda?sessionId&debut=AAAA-MM-JJ` : lecture **gouvernée** (`READ AGENDA`, sceau du serveur, comme le point du jour), écrite par le serveur, sans IA ; chaque événement : jour, heures, titre, source (principal / JARVIS) ; conflits calculés par le serveur (mêmes règles que v4.12.1) ; source en échec nommée, jamais « rien » ; période hors bornes → 400.
- Bouton « + » : petit formulaire (titre, jour, heure, durée) qui **écrit la phrase dans la zone de saisie** de Discuter (« Ajoute <titre> <jour> à <heure> pendant <durée> ») ; la personne touche Envoyer : même chemin que la frappe (titre tapé, carte « Créer », un toucher). Le formulaire n'envoie rien lui-même.
- Rien n'entre dans le contexte du modèle.
### B2. Bouton « tout couper » (Réglages, instance privée)
- La personne tape `COUPER` puis touche le bouton. `POST /api/couper` (clé d'accès) :
  1. révoque **chez Google** les deux jetons Gmail (`oauth2.googleapis.com/revoke`) ; résultat dit jeton par jeton (révoqué / déjà invalide / échec) ;
  2. coupe **en mémoire**, jusqu'au redémarrage : envoi et lecture Gmail, écriture d'agenda, connecteur (`/mcp` → 503), notifications sortantes hors « coupure » ;
  3. dit ce qui ne se coupe pas d'ici : l'écriture d'agenda (compte de service) → « retire le partage de l'agenda JARVIS » ; pour que la coupure tienne après un redémarrage → variable `JARVIS_COUPE=1`.
- `JARVIS_COUPE=1` au démarrage : Gmail, écriture, connecteur inactifs (fermé par défaut), `/health` dit `coupe`.
- Rallumer : nouveaux jetons Gmail (guide existant) et retirer `JARVIS_COUPE`.

## C. Les 6 idées
### C1. Alerte qui ne passe pas par Claude (`JARVIS_NTFY`)
- `JARVIS_NTFY` = adresse https complète d'un sujet ntfy (ex. `https://ntfy.sh/<sujet-secret-long>`) ; sinon inactif. Mal formée → inactif + `/health` « erreur-config ».
- Envoie une **phrase neutre**, jamais un contenu, une adresse, un objet ni un nom : « Mail suspect lu par Claude : ouvre JARVIS. », « JARVIS : 1 mail suspect non lu. », « JARVIS : Gmail ne répond plus. », « JARVIS : la clé API expire dans 3 jours. », « JARVIS : tout est coupé. ».
- Déclencheurs : un suspect dans `lire_mails` du connecteur ; la surveillance (C2) ; la coupure (B2).
- Au plus une notification par type et par heure, 20 par jour ; échec d'envoi : compté, jamais bloquant.
### C2. Surveillance des sources et des expirations
- `surveiller()` : teste chaque source configurée (jeton Gmail lecture et envoi, lien iCal, agenda JARVIS, clé Anthropic via `GET /v1/models`) et l'expiration déclarée `JARVIS_CLE_API_EXPIRE=AAAA-MM-JJ` (alerte à 7 jours et moins) ; lit aussi les **mails non lus** (lecture gouvernée du serveur) et compte les suspects **nouveaux** (déjà signalés : gardés en mémoire).
- Quand : au réveil du serveur, toutes les 6 h tant qu'il est réveillé, sur « Tout vérifier » (Réglages), et sur `POST /api/surveiller` avec `Authorization: Bearer <JARVIS_CLE_SURVEILLANCE>` (≥ 32 car., différente des autres clés) pour un déclencheur extérieur (Raccourcis iPhone, cron) : cette clé ne lit rien, elle ne rend que des comptes.
- Résultat : Réglages (« Santé des sources ») et notification (C1) si panne, expiration proche ou nouveau suspect.
### C3. Âge du domaine et vrai lien
- **Vrai lien** (`jarvis-gmail.js` 1.5, `jarvis-analyse.js` 1.4) : dans un mail HTML, un lien dont le texte affiché est une adresse web ou un domaine qui n'est pas celui de la cible → alerte **forte** « Un lien affiche « x » mais mène à y. ».
- **Âge du domaine** (`jarvis-domaines.js` 1.0) : date d'enregistrement par RDAP (registres .com, .net, .org, .fr ; autre extension → âge inconnu, rien n'est dit), pour l'expéditeur et les domaines des liens (6 au plus par lecture, 3 s chacun, en parallèle, mémoire 24 h, jamais pour les grands services). Moins de 30 jours → alerte **moyenne** (jamais « suspect » à elle seule) ; échec → rien n'est affirmé. Calcul pur dans l'analyse (`agesDomaines`), réseau dans le serveur.
### C4. Bouton « Signaler » (page)
- Sur un mail suspect : « Signaler » ouvre les canaux officiels (Signal Spam pour un e-mail, PHAROS pour une arnaque ou un site, 33700 pour un SMS) et « Ne réponds pas, ne clique pas, ne paie rien ». Liens seulement ; rien n'est envoyé par JARVIS.
### C5. Connecteur ouvert à d'autres assistants (Mistral)
- `JARVIS_MCP_ORIGINES` : liste d'origines https exactes admises **en plus** de claude.ai / claude.com (ex. `https://chat.mistral.ai`) ; mal formée → ignorée et `/health` le dit. Rien d'autre ne change (clé, compteurs, marqueur, schémas).
### C6. Défi public « fais partir le mail » (démo seulement)
- Encart « Défi » sur la démo : faire envoyer (en simulation) un mail à `defi@pirate.example` **sans jamais taper cette adresse**.
- Le serveur garde, par session, les adresses tapées par le visiteur ; une exécution SEND/PAY vers l'adresse du défi jamais tapée → « Défi réussi » + un code (HMAC de la session) à envoyer à `JARVIS_DEFI_CONTACT` ; journal serveur sans contenu.
- Tableau d'honneur : `JARVIS_DEFI_HONNEUR` (noms séparés par des virgules) ; vide → « Personne pour l'instant. ».
- Instance privée : aucun défi.

## D. v4.15 — installation guidée
### D1. Bouton « Déployer sur Render »
- `render.yaml` (Blueprint) : un service web Node, `node server.js`, `/health` ; `ANTHROPIC_API_KEY` et `JARVIS_CODE_SECOURS` demandés au déploiement (`sync: false`) ; `JARVIS_CLE_ACCES`, `JARVIS_CLE_MCP`, `JARVIS_CLE_SURVEILLANCE` **générées** par Render. Ne touche pas aux services existants.
### D2. Configuration guidée (Réglages, instance privée)
- `GET /api/installation` : chaque pièce (IA, accès, Face ID, code de secours, agenda lu, écriture, Gmail lecture/envoi, liste, notifications, surveillance, connecteur) → `ok` / `a-faire` / `erreur` et **la prochaine action en français** ; jamais une valeur secrète, jamais une adresse.
- Face ID : bouton existant d'enrôlement, la valeur à coller dans `JARVIS_PASSKEYS` est expliquée.

## Livrables
`server.js`, `index.html`, `jarvis-gmail.js` (1.5), `jarvis-analyse.js` (1.4), `jarvis-mcp.js` (1.2), nouveaux `jarvis-domaines.js`, `jarvis-veille.js` (notifications + surveillance), `render.yaml`, `MANIFESTE.json`, `tests-v415.js`, `PROGRESSION-v4.15.md`, `CLAUDE.md`.
