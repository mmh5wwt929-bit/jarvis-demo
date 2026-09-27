# JARVIS v4.9.1 — progression, mise en ligne, tests

Base : Racine v4.9.0 (empreinte `458afd8d005f`). Branche `claude/v491`, un commit par étape.
Empreinte v4.9.1 attendue dans `/health` : **`4f7656f77dd2`** (celle de `MANIFESTE.json`).

## 1. Ce qui change

| Étape | Changement |
|---|---|
| 0 | `CLAUDE.md` : état, rôle des fichiers, règles de sécurité, méthode, style. |
| 1 | Pages publiques `/confidentialite` et `/conditions` (exigées par Google pour publier), liens en bas de page. |
| 2 | Demande double : JARVIS dit ce qui n'est **pas** fait. Un vrai e-mail = **1** échange dans l'historique (texte gardé). Fenêtre : 12 échanges (avant 8). Jamais « tu ne m'as pas dit ». Brouillon : rien d'ajouté, un seul registre (alerte sinon). Offres d'agir à ta place retirées. |
| 3 | Boutons « Annuler » / « Confirmer » masqués après l'envoi. Client OAuth en `…_CLIENT_ID` + `…_CLIENT_SECRET`, collage d'iPhone toléré, motifs précis. Paiement : « Confirmer » → « Payé (simulation) ». |
| 4 | « Ouvrir dans Mail » (mailto:), démo comprise. |
| 5 | Réveil de Render : « JARVIS se réveille (≈30 s, parfois plus) » ; page d'attente de Render reconnue. |

### Changements de comportement à connaître
- **Adresse hors liste tapée par toi** (ex. `pirate@exemple.com`) : plus de refus `HORS_LISTE`, mais une carte « Ouvrir dans Mail ». Le compte d'essai n'envoie toujours **que** vers `JARVIS_MAIL_AUTORISES`.
- **Adresse de ta liste** : la carte Gmail (retaper + Face ID) propose aussi « Ouvrir dans Mail » ; le toucher ferme la carte Gmail (pas de double envoi).
- **Démo** : « envoie un **mail/message** à X … » → « Ouvrir dans Mail ». « envoie **les factures** à X » (un fichier) → simulation gouvernée, inchangée.
- **Brouillon** : vouvoiement par défaut ; écris « en le tutoyant » pour changer.
- **Réveil** : Render affiche déjà sa propre page d'attente au premier chargement (doc Render) → **pas de page GitHub Pages**.

## 2. Mise en ligne
1. PR `claude/v491` → `Racine` : CI verte (Node 22 et 24), puis **tu fusionnes**.
2. Render redéploie les deux services seul (« After CI Checks Pass »).
3. `/health` des deux services : `passerelle` = `v4.9.1`, `manifeste` = `conforme`, `empreinte` = `4f7656f77dd2`.

## 3. Render (Dianinou) — facultatif
- Pour simplifier le collage : remplacer `JARVIS_GMAIL_CLIENT` (le JSON) par **`JARVIS_GMAIL_CLIENT_ID`** + **`JARVIS_GMAIL_CLIENT_SECRET`**. Garder **une seule** forme : si les deux sont là avec des valeurs différentes → `CLIENT_EN_DOUBLE`, envoi et lecture coupés.
- Même chose pour un 2e client de lecture : `JARVIS_GMAIL_CLIENT_LECTURE_ID` + `…_SECRET`.
- `JARVIS_HISTORIQUE` (défaut 24 messages = 12 échanges) : ne rien mettre.
- `JARVIS_CONFIG_ATTENDUE` : inchangé. Démo : rien.

## 4. Google en Production (étape 1 — après le déploiement)
Source vérifiée : doc Google OAuth (mise à jour du 26 mai 2026) — la limite de 7 jours ne touche que le statut « Testing ».
1. Vérifier que `https://jarvis-demo-24y8.onrender.com/confidentialite` et `/conditions` s'ouvrent.
2. Google Auth Platform → **Branding** :
   - Nom : `JARVIS` ; e-mail d'assistance et contact développeur : le compte d'essai ;
   - **Logo : aucun** (sinon vérification par Google) ;
   - Page d'accueil : `https://jarvis-demo-24y8.onrender.com/`
   - Règles de confidentialité : `https://jarvis-demo-24y8.onrender.com/confidentialite`
   - Conditions d'utilisation : `https://jarvis-demo-24y8.onrender.com/conditions`
   - Domaine autorisé : `jarvis-demo-24y8.onrender.com` (onrender.com est un suffixe public : ce sous-domaine compte comme le tien) ;
   - Enregistrer. Si Google exige une **vérification du domaine** (Search Console) : capture → il faudra une balise dans la page (petite version).
3. **Audience** → « Publier l'application » → confirmer → statut « En production ». **Ne pas** demander la validation Google (inutile en usage perso, 100 utilisateurs max).
4. **Refaire les 2 jetons** (les jetons « Testing » meurent à J+7 même après publication) — OAuth Playground :
   1. ⚙️ : « Use your own OAuth credentials » (ID + secret du client), « Access type : Offline », « Force prompt : Consent Screen ».
   2. Step 1, « Input your own scopes » : `https://www.googleapis.com/auth/gmail.send` → Authorize APIs → compte d'essai → « Google n'a pas validé cette application » : Paramètres avancés → Accéder à JARVIS → Autoriser.
   3. Step 2 → « Exchange authorization code for tokens ». Dans la réponse, `"scope"` doit valoir **exactement** `https://www.googleapis.com/auth/gmail.send`.
   4. Copier `refresh_token` → Render Dianinou → `JARVIS_GMAIL_ENVOI`.
   5. Refaire 2 à 4 avec `https://www.googleapis.com/auth/gmail.readonly` → `JARVIS_GMAIL_LECTURE`.
   6. Si ce 2e `"scope"` contient les **deux** droits (Google fusionne les droits d'un même client) : ne pas l'utiliser ; créer un 2e client OAuth (Application Web, même URI de redirection) → `JARVIS_GMAIL_CLIENT_LECTURE_ID` + `_SECRET`, et refaire le jeton de lecture avec lui.
   7. JARVIS → « Vérifier Gmail » : ✓ Envoyer (gmail.send seul), ✓ Lire (gmail.readonly seul).
   8. Captures : masquer `refresh_token`, `access_token` et le secret.
5. Ce qui peut encore couper un jeton en Production : 6 mois sans usage, **changement du mot de passe du compte d'essai**, révocation, plus de 100 jetons pour un même client.

## 5. Tests en ligne (iPhone : Safari, puis l'appli)
1. `/health` des deux services : v4.9.1, conforme, `4f7656f77dd2`.
2. `/confidentialite` et `/conditions` s'ouvrent sans clé ; liens en bas de la page.
3. Dianinou : « envoie un mail à ‹adresse de ta liste› pour lui dire que le match est samedi à 10h et ajoute-le à mon agenda » → carte du vrai e-mail **+** bulle JARVIS « Pas fait : l'ajout à l'agenda (« ajoute-le à mon agenda ») … Termine ou annule d'abord … ». Le brouillon ne parle pas d'agenda.
4. Vrai e-mail jusqu'au bout (retaper, 10 s, Face ID) → « Envoyé pour de vrai » : **Annuler / Confirmer l'envoi disparaissent**. Puis « qu'est-ce que je viens d'envoyer ? » → Claude cite le texte.
5. Une dizaine de messages plus tard : « de quoi parlait mon mail ? » → il le retrouve, ou dit « Je ne le retrouve pas dans nos derniers échanges » ; jamais « tu ne m'as pas dit ».
6. « envoie un mail à ‹liste› pour lui dire que l'entraînement est avancé à 17h » → rien d'ajouté (ni invitation, ni question), vouvoiement partout. Refaire avec « … en le tutoyant ».
7. Lire la boîte avec un mail piégé, puis « c'est quoi ce mail ? » → alerte, **aucune** proposition « dis-moi l'adresse / je peux le transférer » (si le modèle en écrit une, elle est retirée et JARVIS le dit).
8. Dianinou, adresse **hors liste** (ta vraie adresse) : « envoie un mail à ‹ton adresse› pour me rappeler d'acheter les ballons » → carte « E-mail préparé » → « Ouvrir dans Mail » → Mail s'ouvre, destinataire, objet et texte remplis (accents, sauts de ligne) ; tu envoies ou non. Rien dans les « Envoyés » du compte d'essai.
9. Démo publique : même demande → même carte « Ouvrir dans Mail ».
10. Après la lecture du mail piégé : « réponds-lui par mail pour dire non » → **aucun** bouton (adresse non tapée).
11. « paie la facture à ‹adresse› » → bouton « Confirmer » (plus « Confirmer l'envoi ») → code ou Face ID → « Payé (simulation) », boutons disparus.
12. Réveil : laisser JARVIS ouvert ≥ 20 min sans rien faire, puis « bonjour » → « JARVIS se réveille (≈30 s…) », puis la réponse ; « La session avait expiré » est normal (le serveur a redémarré).
13. Premier chargement après ≥ 20 min : page d'attente de Render, puis JARVIS.
14. Si tu passes à `…_CLIENT_ID` + `…_SECRET` : `/api/health` → `mail: actif`, « Vérifier Gmail » vert.

## 6. Tests automatiques
- `tests-v491.js` : **59 tests** ; **48 échouent sur la v4.9** (`JARVIS_DIR=../v49 node tests-v491.js` → 11/59, les 11 « garde »).
- Tests de mutation : **57/57** tuées (chaque correctif cassé à la main fait tomber au moins un test).
- Adaptés : `tests-v461.js` (liste des fichiers du manifeste), `tests-v49.js` M11 (hors liste tapée → « Ouvrir dans Mail » au lieu du refus).
- 24 suites vertes (Node 22 ici ; la CI rejoue Node 22 et 24).

## 7. Limites connues (critique)
- Demande double : détection lexicale. Une phrase du **contenu** de l'e-mail qui commence par un verbe d'agenda avec une heure (« note bien l'heure du match samedi à 10h ») peut être signalée à tort comme 2e demande.
- Offres d'agir : retrait lexical ; une tournure nouvelle peut passer. La consigne du modèle reste la première barrière.
- « Ouvrir dans Mail » : JARVIS ne sait pas si l'e-mail est parti (c'est voulu) ; aucune transaction du noyau (JARVIS n'agit pas).
- Réveil : la bulle apparaît après 3 s + 2 s de sonde (≈5 s).
- Alerte « tu/vous » : un signal sur la carte, pas un blocage.
- Pages légales : brouillon honnête, **à relire** (je ne suis pas juriste).

## 8. Rappels
- 2 espaces Anthropic, une clé chacun, **avant le 20 oct**.
- Jetons Gmail à refaire **vers le 4 oct** si la Production échoue.
- **Bilan JARVIS le 13 oct.**
- Comparer ta jauge d'utilisation avant / après cette session.
