# JARVIS v4.11 — à faire sur l'iPhone

## 1. Mise en ligne
1. Appli GitHub → PR « v4.11 » → attendre la coche verte (tests 22 et 24) → **Fusionner**.
2. Safari → `/health` des deux services : `passerelle` = `v4.11.0`, `manifeste` = `conforme`, `empreinte` = **`325112b1cf76`**.
3. Render : rien à changer.

## 2. Tests en ligne (Dianinou, l'appli de l'écran d'accueil)
1. **Ouverture** : onglet « Aujourd'hui » : l'agenda d'aujourd'hui et de demain, puis « À traiter · N » (5 points au plus). En bas : Aujourd'hui / Discuter / Réglages.
2. **Toucher le texte d'un point** → passe à « Discuter » et ouvre la conversation.
3. **« Fait »** sur un point → il disparaît, « ✓ Fait : … Annuler » en haut, le compteur baisse. « Annuler » → il revient.
4. **« Plus tard »** → masqué jusqu'à demain 6 h.
5. **Répondre** dans une conversation (vrai envoi, Face ID), puis revenir sur « Aujourd'hui » : « répondre », « rendez-vous proposé » et « à vérifier » de cette conversation ont disparu. Dans « Discuter » : l'e-mail envoyé tient sur UNE ligne « ✓ Envoyé à … — « objet » » (toucher pour le revoir).
6. **« Rappel »** (ou « Me le rappeler ») → carte « Créer » : le titre en gros. « Créer » → la carte devient « ✓ Créé : … » et le point est traité tout seul.
7. **Titres** : tape « Ajoute l'événement à mon agenda pour mercredi 30 » → « À quelle heure ? Et quel titre ? ». Réponds « 14h RDV Luc » → carte « RDV Luc ». Jamais « hand ».
8. Après une série « Hand », tape « Ajoute même chose tous les vendredis de 18h à 22h jusqu'au 18 décembre » → carte « Hand », avec « même titre que ta création précédente ».
9. **Réglages** : « Affichage », « Points marqués « fait » » (+ « Tout réafficher »), souvenirs, Face ID, Google, Gmail ; « Imposer l'action à la main » est dans Affichage.
10. **Démo publique** : rien ne change (deux colonnes, pas d'onglets).

## 3. Reste pour le compte rendu de samedi
- Réponse qui fixe une heure (« je confirme samedi 11h ») : rappeler dans la carte les horaires différents de la conversation.
- Après une réponse qui confirme ou propose un créneau : « Ajouter à l'agenda » juste sous « Envoyé ».
- « J'ai quoi le … ? » : liste affichée par le serveur, le modèle ne fait que commenter.
