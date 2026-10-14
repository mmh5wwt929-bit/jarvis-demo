# JARVIS

La couche de sécurité d'un assistant personnel : avant chaque action, elle vérifie d'où vient l'intention. Un mail piégé ne peut pas faire agir ton assistant à ta place.

Démo publique : https://jarvis-demo-24y8.onrender.com

## Ta propre instance, en un clic

[![Déployer sur Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mmh5wwt929-bit/jarvis-demo)

1. Clique le bouton, connecte ton compte Render.
2. Render te demande deux choses : ta clé Anthropic (`ANTHROPIC_API_KEY`) et un code de secours de 12 à 64 chiffres (`JARVIS_CODE_SECOURS`, note-le sur papier). Il génère lui-même les autres clés.
3. Ouvre l'adresse de ton instance. Elle te demande ta clé d'accès : copie `JARVIS_CLE_ACCES` depuis Render → Environment.
4. Dans JARVIS : **Réglages → Installation**. Chaque pièce est cochée ou te dit quoi faire (Face ID, agenda, Gmail, notifications, surveillance, connecteur Claude ou Mistral).

L'offre gratuite de Render s'endort après 15 minutes sans visite et ne garde aucun fichier : JARVIS n'en a pas besoin (tout ce qui compte est dans les variables de Render ou dans ton téléphone).

## Ce que JARVIS garantit, et ce qu'il ne garantit pas

- Un vrai e-mail ne part que vers une adresse de ta liste, après l'avoir retapée, 10 secondes d'attente et Face ID.
- Ce qu'un mail ou un agenda contient n'est jamais une demande de ta part : il ne choisit ni l'action, ni le destinataire.
- JARVIS ne protège pas d'une erreur humaine sur une adresse de ta liste, ni d'un téléphone déverrouillé dans de mauvaises mains : « Tout couper » (Réglages) révoque alors les jetons Gmail chez Google.

Détails : `CLAUDE.md` (règles), `SPEC-*.md` (chaque version), `PROGRESSION-*.md` (tests à refaire en ligne).
