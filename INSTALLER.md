# Installer ton JARVIS (≈ 10 minutes)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mmh5wwt929-bit/jarvis-demo)

1. **Touche le bouton** ci-dessus, connecte-toi à Render (avec GitHub), puis « Apply ».
2. Render demande **ANTHROPIC_API_KEY** : crée une clé sur console.anthropic.com → *API keys*, colle-la. Fixe un plafond de dépense chez Anthropic.
3. Attends la fin du déploiement, puis ouvre l'adresse du service (`https://<nom>.onrender.com`).
4. Dans Render → ton service → **Environment**, copie la valeur de **JARVIS_CLE_ACCES** (générée par Render) et colle-la dans la page : c'est ta clé d'accès. Garde-la dans ton gestionnaire de mots de passe.
5. Dans JARVIS → **Réglages → Installation** : chaque brique dit son état (« actif », « à ajouter », « à corriger »), le **nom exact** de la variable Render à créer et quoi y mettre. Jamais une valeur n'y est affichée.

Ce que le bouton crée : un service web **gratuit** (il s'endort après 15 min sans visite ; le premier accès le réveille en quelques secondes). Les clés `JARVIS_CLE_ACCES`, `JARVIS_CLE_MCP` et `JARVIS_CLE_VEILLE` sont **générées par Render** : rien de secret n'est dans ce dépôt.

Ensuite, dans l'ordre conseillé (tout est décrit dans Réglages → Installation) :
- **Face ID** et un **code de secours** (avant toute action réelle) ;
- l'**agenda** (lien secret iCal), puis l'agenda **JARVIS** (écriture, compte de service Google) ;
- **Gmail** (deux jetons séparés : envoyer seul, lire seul) et la **liste des destinataires** ;
- les **notifications** (appli ntfy) et la **surveillance** (une tâche planifiée gratuite qui appelle `/veille` **toutes les 30 min**, pas plus souvent : les 750 heures gratuites par mois de Render sont partagées entre tous tes services).

Limites : instance gratuite (mémoire effacée quand elle s'endort ; « Tout couper » ne tient durablement que pour Gmail), une seule personne par instance.
