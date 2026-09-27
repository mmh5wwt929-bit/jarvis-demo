# JARVIS v4.10.2 — à faire sur l'iPhone

## 1. Mise en ligne
1. Appli GitHub → PR « v4.10.2 » → attendre la coche verte (tests 22 et 24) → **Fusionner**.
2. Safari → `/health` des deux services : `passerelle` = `v4.10.2`, `manifeste` = `conforme`, `empreinte` = **`e7fc4ec67cbf`**.
3. Render : rien à changer (`JARVIS_AGENDA_ICAL` = ton lien iCloud, `JARVIS_CONFIG_ATTENDUE` inchangée).

## 2. Tests en ligne (Dianinou)
1. **Le scénario du 27 sept** : « Qu'est-ce que j'ai à gérer ? » → « Préparer une réponse » sur une conversation (pastille rouge) → tape un message quelconque (ex. « merci ») → « Qu'est-ce que j'ai à gérer ? » à nouveau.
   Attendu : agenda et mails lus, **sans** « CONTEXTE_NON_DECLARE » et **sans** « Repartir au vert ». La pastille reste rouge (normal : un contenu externe a été lu).
2. Dans la même session : « Voir la conversation », « Vérifier dans mon agenda » sur un rendez-vous proposé, une 2e « Préparer une réponse » → tout marche.
3. **Compteurs** : quand il n'y a rien, « Agenda (0) » (avant : « (1) »).
4. **Agenda réel** : « Vérifier dans mon agenda » sur un créneau qui tombe sur un entraînement créé par JARVIS → « Déjà pris » + l'entraînement.

## 3. Ce qui n'est pas testable à la main (couvert par tests-v4102.js)
- Agenda JARVIS en panne mais iCloud lu : « L'agenda JARVIS n'a pas pu être lu : ce qui suit ne le compte pas » ; « Vérifier dans mon agenda » refuse au lieu de dire « Tu es libre ».
- Agenda et boîte en panne : résumé « lecture incomplète : rien n'est garanti », carte orange (avant : « rien d'urgent », carte verte).
- Un échec n'est plus gardé 60 s : le « à gérer » suivant relit.

## 4. Reste pour après le compte rendu de samedi
- Réponse qui fixe une heure (« je confirme samedi 11h ») sans rappel de « Horaires différents » dans la carte.
- Après une réponse qui confirme ou propose un créneau : proposer « Ajouter à l'agenda » juste sous « Envoyé ».
- Titre du rappel : la promesse elle-même, pas seulement l'objet (« Rappel : Match samedi »).
- « J'ai quoi le … ? » : liste affichée par le serveur (le modèle reformule aujourd'hui, ex. « titre pas clair »).
