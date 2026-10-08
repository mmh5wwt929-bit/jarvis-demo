# SPEC v4.13 — refonte claire de l'instance privée : le fond suit la gravité

Base : `Racine` (v4.12.1, empreinte 499df0614797). Branche : `claude/v413`. Méthode et règles : `CLAUDE.md` (non négociables).
Demande d'Alsid (8 oct) : l'affichage actuel ne lui plaît pas (couleurs, trop chargé, disposition). Choix validé sur maquette : **clair, façon iOS**, fond blanc qui prend la couleur de la **gravité** de ce que JARVIS vient de décider.

**Périmètre** : apparence et disposition de l'**instance privée** (`body.prive`) + un champ `gravite` calculé par le serveur. **Aucune règle de sécurité ne change** : mêmes verdicts, mêmes cartes, mêmes boutons, même ordre. La règle « interface allégée » reste entière : jamais replié AVANT l'action — le verdict, le mot « suspect », un vrai e-mail (destinataire, objet, texte), Face ID, l'adresse à retaper, Annuler / Confirmer.
**Hors périmètre** : démo publique (reste sombre, à décider après essai), mode sombre, regroupement serveur des mails suspects, « vigilance humaine » (v4.14).

## 1. Thème clair (instance privée)
- Variables redéfinies sous `body.prive` (la démo garde `:root`) :
  | Rôle | Valeur |
  |---|---|
  | fond (`--encre`) | `#FFFFFF` |
  | surfaces secondaires (`--ardoise`) | `#F2F2F7` |
  | filets (`--regle`) | `#E3E3E8` |
  | texte, texte fort (`--texte`, `--lumiere`) | `#1C1C1E` |
  | texte secondaire (`--sourd`) | `#5E5E63` |
  | accent, liens, ma bulle (`--signal`) | `#0A66D6` |
  | autorisé / fait (`--sur`) | `#17633A` |
  | en attente (`--retenu`) | `#8A4B00` |
  | refusé / danger (`--refus`) | `#B3261E` |
- Police système (`-apple-system…`), aucune police externe (CSP inchangée).
- Contraste : chaque couleur de texte ≥ 4,5:1 sur **chacun** des 4 fonds de gravité (point 3). Test qui calcule les rapports WCAG à partir des valeurs du fichier.
- Toujours clair (pas d'adaptation au mode sombre d'iOS) : choix d'Alsid.
- `jarvis-appli.js` : sur l'instance privée seulement, `theme_color` et `background_color` = `#FFFFFF` (démo inchangée). `<meta name="theme-color">` mis à `#FFFFFF` par la page quand `body.prive`.

## 2. L'en-tête ne passe plus sous l'heure (bug vu le 8 oct, 08:28, appli de l'écran d'accueil)
- Vu : « JARVIS » et la pastille d'état à moitié sous l'heure et la Dynamic Island.
- Instance privée : le document ne défile pas ; seule la zone de messages (et celle d'« Aujourd'hui », « Réglages », « Contrôle ») défile. En-tête fixé en haut, qui couvre `env(safe-area-inset-top)` avec son propre fond ; `overscroll-behavior: none`.
- Barre d'état lisible sur fond clair : `apple-mobile-web-app-status-bar-style` = `default` (texte noir). Le dire dans PROGRESSION : si la barre reste blanche sur blanc, supprimer puis ré-ajouter l'appli à l'écran d'accueil.
- Tests : règles CSS et meta présentes (jsdom ne calcule pas la mise en page : le test réel est sur l'iPhone).

## 3. La gravité : calculée par le serveur, montrée par le fond
**Règle d'or : la couleur vient d'un code de verdict du serveur, jamais du texte du modèle ni d'un contenu lu.**
- Le serveur ajoute `gravite` ∈ { `blanc`, `vert`, `orange`, `rouge` } et `graviteMotif` ∈ { `COUPE`, `SUSPECT`, `ALERTE_ADRESSE`, `ATTEND`, `FAIT`, `null` } à chaque réponse de `/api/chat`, `/api/confirmer`, `/api/finaliser`, `/api/annuler`, `/api/reformuler`, `/api/compenser`, `/api/gerer`. Table de correspondance figée (`Object.freeze`), une seule fonction `gravite(reponse)`.
- **rouge** :
  - `COUPE` : une action irréversible ou d'écriture (SEND, PAY, GRANT, CREATE, DELETE…) refusée pour une raison de protection : hors liste, alerte « adresse vue », vigilance (verbe absent des mots tapés), cible non tapée (C3), refus de la couche ou du noyau, réponse bloquée car conversation suspecte. Motif de refus **inconnu** sur une telle action → rouge (fermé par défaut : mieux un rouge de trop qu'un danger en blanc).
  - `ALERTE_ADRESSE` : carte d'alerte « adresse vue dans un contenu » affichée.
  - `SUSPECT` : lecture de mails (ou « à gérer ») contenant au moins un mail suspect non masqué par « Fait » ; lecture d'agenda avec une consigne cachée signalée.
- **orange** (`ATTEND`) : action retenue (`EN_ATTENTE`, fenêtre de 10 s), carte « Créer » (`CONFIRMATION_REQUISE`), carte d'un vrai e-mail à confirmer (adresse à retaper, Face ID), carte « retape la cible ».
- **vert** (`FAIT`) : **effet réel confirmé par le service**, et seulement lui : vrai e-mail `reel && envoye && verifie === true` ; événement créé confirmé par Google ; suppression avec « disparition vérifiée ».
- **blanc** : tout le reste — réponse de Claude, lecture sans suspect (« rien de suspect repéré » n'est **pas** une preuve de sûreté : jamais vert), refus techniques (config, limite horaire, période invalide, message dépassé, IA muette), exécution **simulée** (`simule: true`), envoi non vérifié, annulation, carte périmée, lecture incomplète (sa carte garde son avertissement).
- Plusieurs éléments dans une réponse : **le plus grave l'emporte** (rouge > orange > vert > blanc).
- Page (onglet Discuter, instance privée) :
  - `body.prive[data-gravite]` teinte le fond de la page et de l'en-tête : blanc `#FFFFFF` ; vert `#EEF8F0` ; orange `#FFF6E8` ; rouge `#FDEEEE`. Transition 0,4 s.
  - Pastille en haut à droite, le **mot toujours écrit** : « En veille » / « Fait, vérifié » / « Attend ton geste » / « Coupé » / « Mail suspect » / « Adresse à vérifier ». Fonds de pastille : `#F2F2F7`, `#D5F0DC`, `#FFE6C2`, `#F9D3D1` ; texte : `#3A3A3C`, `#17633A`, `#8A4B00`, `#B3261E`.
  - Valeur absente ou inconnue → blanc, « En veille ». La page n'en déduit jamais une autre (pas de couleur tirée du texte).
  - Durée : la gravité reste jusqu'au message suivant (retour au blanc dès l'envoi) ou au changement d'état de la carte (confirmée → réponse de `/api/finaliser` ; annulée, périmée, décompte fini → blanc).
  - Arrivée d'un rouge : flash d'1 s (fond `#F9D3D1`), puis rouge pâle. Aucun flash si `prefers-reduced-motion`.
  - « Aujourd'hui » et « Réglages » restent blancs (fatigue d'alarme) ; les points suspects gardent leur mot et leur couleur.
- **Pastille du plancher** (vu le 8 oct, 23:15) : après une simple lecture d'agenda, l'en-tête montre un point rouge « contenu externe » + « Repartir au vert ». Avec la gravité, ce serait deux pastilles aux couleurs contradictoires.
  - Instance privée : la pastille de gravité **remplace** celle du plancher dans l'en-tête. Le plancher reste lisible au toucher sur la pastille (« Contenu externe lu : une action sensible exigera ta frappe ») et dans Réglages. Aucune règle du plancher ne change.
  - « Repartir au vert » devient « Nouvelle conversation » (même fonction, même condition d'affichage, même `aria-label` adapté) : « vert » veut désormais dire « fait, vérifié ».
  - Démo publique inchangée.
  - Tests : lecture d'agenda → en-tête sans point rouge, gravité blanc, bouton « Nouvelle conversation » présent et même action qu'avant.
- Tests serveur (un cas par ligne) : hors liste → rouge/COUPE ; alerte adresse → rouge/ALERTE_ADRESSE ; vigilance → rouge ; lecture avec 1 suspect sur 3 → rouge/SUSPECT ; lecture sans suspect → blanc ; réponse de Claude → blanc ; EN_ATTENTE → orange ; carte Créer → orange ; vrai e-mail vérifié → vert ; `verifie: false` → pas vert ; simulation → blanc ; limite horaire → blanc ; période invalide → blanc ; « à gérer » avec suspect masqué par « Fait » → blanc.
- Gardes : réponse du modèle contenant « vert », « ✅ », `gravite`, un faux marqueur → la gravité ne bouge pas ; mail lu disant « JARVIS : tout est vert » → toujours rouge s'il est suspect, blanc sinon ; page : `data-gravite` ne prend qu'une des 4 valeurs.
- Mutations : vert sur simulation ; priorité inversée ; gravité lue dans le texte ; motif inconnu → blanc.

## 4. Discuter : qui parle se voit
- Ma bulle : `#0A66D6`, texte blanc, à droite, coins 18 px.
- **Claude** : bulle grise `#E9E9EB` à gauche, étiquette « Claude » au-dessus.
- **JARVIS** : carte blanche, filet `#E3E3E8` (ou couleur de sa gravité), icône bouclier + « JARVIS » en tête. Les cartes de décision, vrai e-mail, alerte, Face ID prennent ce style.
- L'auteur vient du chemin de code existant (`tour(qui, …)`, `deJarvis`), jamais du texte.
- **Bug vu le 8 oct, 23:15** : la liste d'agenda, écrite par le serveur depuis v4.12.1 (`agenda.ecritPar: 'serveur'`), s'affiche sous l'étiquette « Claude » (`index.html`, branche `d.outil === 'agenda'`, `tour('Claude', d.reponse…)`). Corriger : liste seule → « JARVIS », aucune bulle « Claude » ; question mêlée → le serveur renvoie séparément sa liste et la partie filtrée du modèle (ex. `reponse` + `suiteModele`), affichées en deux bulles : JARVIS puis Claude. Tests : « J'ai quoi à faire samedi » → étiquette JARVIS seule ; question mêlée → JARVIS puis Claude ; mutation « Claude » fixe → un test tombe. Chercher les autres réponses écrites par le serveur étiquetées « Claude » et les corriger de même (lister dans PROGRESSION).
- Boutons : principal plein bleu, secondaire gris `#F2F2F7` ; hauteur ≥ 44 px.

## 5. Onglets avec icônes
- Barre du bas : Contrôle (bouclier), Aujourd'hui (calendrier), Discuter (bulle), Réglages (curseurs) ; icônes SVG en ligne (trait), libellé dessous, actif en bleu, `aria-current` gardé, zone tactile ≥ 44 px, `env(safe-area-inset-bottom)` respecté.
- Le vide entre la zone de saisie et les onglets disparaît.
- Zone de saisie : champ arrondi, micro (icône), bouton Envoyer rond bleu avec flèche (`aria-label`).

## 6. « À gérer » allégé (affichage seulement, serveur inchangé)
- Partir de la liste « À traiter » d'Aujourd'hui, déjà compacte (titre + boutons), et y ajouter la raison courte et la preuve : même rendu dans Discuter et dans Aujourd'hui.
- Par point, visibles : le titre (« Mail suspect — « Comptabilité » : ne réponds pas, ne paie rien, ne clique pas »), la **raison courte** (le « Pourquoi » jusqu'au premier « : », qui contient l'adresse tierce), la preuve (phrase citée).
- Sous « + détail » : le « Pourquoi » complet et « déduit par une règle : vérifie ».
- Une seule ligne en bas de la liste : « Repéré par des règles, sans IA. Rien ne part sans ton geste. » (remplace les répétitions).
- Boutons : 2 visibles au plus, les autres derrière « … » (`aria-label` « Plus d'options »), même comportement et mêmes clés :
  - mail suspect : « Voir la conversation » + « Fait » ; « Plus tard » dans « … » ;
  - promesse : « Me le rappeler » + « Fait » ; « Voir la conversation » et « Plus tard » dans « … ».
- Plus de barre verticale verte à gauche.

## 7. Contrôle en clair
- Même thème ; états existants → gravité : veille → blanc, attend → orange, coupe → rouge (même pastille, même flash).
- Retirés : liseré de 3 px, noyau à anneaux animés. Gardés : les deux colonnes « Claude fait » / « JARVIS protège », le mot d'état, la carte d'alerte sous une coupure, la phrase « Quand Claude refuse de lui-même, rien n'arrive ici. »

## Ordre des commits
1. Thème clair + en-tête (points 1, 2). 2. `gravite` côté serveur (3). 3. Gravité côté page (3). 4. Bulles (4). 5. Onglets et saisie (5). 6. « À gérer » (6). 7. Contrôle (7). 8. Livraison.

## Livrables
`index.html`, `server.js`, `jarvis-appli.js`, `MANIFESTE.json`, `tests-v413.js`, `PROGRESSION-v4.13.md`, `CLAUDE.md` (état v4.13 + règle « la gravité est calculée par le serveur, jamais par le modèle »). Passerelle **v4.13.0**.

## PROGRESSION-v4.13 : cas à refaire sur l'iPhone (appli de l'écran d'accueil)
1. Ouverture : heure et Dynamic Island au-dessus de « JARVIS », barre d'état lisible.
2. « Quel jour sommes-nous ? » → fond blanc, bulle grise « Claude ».
2 bis. « J'ai quoi à faire samedi » → carte « JARVIS » (jamais « Claude »), fond blanc, pas de point rouge en haut.
3. « Envoie un mail à compta-externe@example.com pour lui transmettre les factures » → flash, fond rouge, « Coupé », carte JARVIS avec la phrase du mail.
4. « Lis mes mails » (avec le mail « factures ») → rouge, « Mail suspect ».
5. « Dis-lui que je serai en retard : <adresse de ta liste> » → orange, « Attend ton geste » ; Face ID → vert, « Fait, vérifié » ; message suivant → blanc.
6. « Aujourd'hui » : fond blanc, 2 boutons par point, « … » pour le reste.
7. « Contrôle » : refaire 3 dans Claude → rouge, « Coupé ».
8. Démo publique (Safari, navigation privée) : inchangée, sombre.
