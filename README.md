# JARVIS — noyau de gouvernance de capacités

Un moteur d'autorisation en JavaScript, sans dépendance, qui décide si une
action assistée par IA a le droit d'être exécutée — et qui en garde une trace
infalsifiable.

Ce dépôt contient le noyau, sa suite de tests, et **le journal complet des
défauts trouvés pendant son durcissement**. Cette dernière partie est la plus
instructive : elle montre comment un système d'autorisation peut sembler
correct, passer ses propres tests, et ne garantir presque rien.

```bash
node jarvis-5.27.7.js        # exécute la suite complète (~13 s)
```

Démo dans le navigateur, noyau réel : ouvrir `index.html`
(nécessite `jarvis-browser.js` à côté).

---

## Ce que JARVIS fait

Il gouverne un cycle de permission en quatre temps :

```
propose()  →  approbation utilisateur  →  authorize()  →  SAS.execute()
 PROPOSED                                    ACTIVE          CONSUMED
```

Avec, en dessous :

- **un ledger d'autorité** — un plafond d'actions, avec un invariant de
  conservation vérifiable à tout instant ;
- **une chaîne d'audit** — chaque événement chaîné par hachage, avec une ancre,
  et bornée à 200 entrées ;
- **un miroir de gouvernance** — un hachage de l'état comparé à une référence ;
  toute dérive bloque tout ;
- **des gardiens** sur le chemin de décision, en fail-closed ;
- **des contrôleurs externes** pour les opérations privilégiées.

## Ce que JARVIS n'est pas

**Ce n'est pas une IA.** Il ne génère pas de langage et n'a aucun modèle.

**Il ne juge pas la nature des actions.** Il borne *combien* d'actions et *qui*
a approuvé, pas *lesquelles*. Vérifié : une permission
`{action:'DELETE_ALL', resource:'FILESYSTEM', maxUses:30}` est acceptée et
s'exécute trente fois avec une seule approbation. C'est cohérent — un ledger
compte des unités, il ne sait pas ce qu'est un fichier — mais ça implique
qu'une couche de restriction des actions doit exister **au-dessus**. Voir la
section « Registre d'intentions ».

**Ce n'est pas une frontière de sécurité en production.** C'est un harnais
déterministe, en un seul processus. `HARNESS_KEY` matérialise « le monde
extérieur » à l'intérieur du processus : en production, l'approbation
utilisateur et les contrôleurs vivent **hors** du processus. Limite assumée,
écrite dans l'en-tête du code.

---

## Le journal des constats — 29 étiquetés

Chacun avec son exploit vérifié et son correctif. Les neuf premiers (série C)
sont les plus instructifs sur la façon dont un système se trompe sur lui-même.

### Le cœur d'autorisation

| | Constat | Ce qui n'allait pas |
|---|---|---|
| **C1** | Plafond falsifiable sans authentification | `ledger.grant(n)` public, sans jeton — **et aucun des trois détecteurs ne le voyait** (voir l'article dédié) |
| **C2** | Approbation en libre-service | Le code qui appelait `propose()` pouvait frapper sa propre approbation. Aucun utilisateur n'intervenait jamais |
| **C7** | Approbation acceptée sans avoir été émise | Découvert par le test de non-régression écrit pour C2, qui a échoué sur la version *déjà corrigée*. Un objet littéral fait main suffisait |
| **C3** | Preuve de réplication en libre-service | Même motif que C2 |
| **C4** | Signature de balise forgeable | `sign()` public : n'importe quel code produisait un faux ALL_CLEAR authentique |
| **C5** | `authoritySource` en fail-open | `if(p.authoritySource && …)` — une permission *sans* source passait, `undefined` étant falsy |
| **C6** | Contrôleurs « externes » externes de nom | Champs publics exposant `controlTokenForHarness()` |
| **C8** | Journal d'audit décoratif et non borné | Après un cycle complet, le journal contenait **une** entrée : `BOOT`. La chaîne de hachage était parfaitement intègre et ne témoignait de rien |
| **C9** | Gardiens hors du chemin de décision | Gandalf, Diana, Pandora, King instanciés et testés isolément — `preActionDecision` ne les appelait jamais |

### Identité, temps, ressources

| | Constat | Ce qui n'allait pas |
|---|---|---|
| **E1** | Usurpation par simple lecture | `identityCore.snapshot()` rendait les preuves de session complètes |
| **E2** | Nonce énumérable en masse | La capacité d'agir était listable publiquement |
| **E3** | Sept gardiens plantaient sur contexte `null` | Et le harnais **comptait ces plantages comme des refus réussis** |
| **F1/F3** | Reculer l'horloge ressuscitait l'expiré | Garde monotone par instance |
| **F5** | Aucun plafond de TTL | Une permission d'un an était acceptée |
| **G** | Cinq entrées publiques sans borne | Croissance mémoire non contrôlée |
| **H3** | Deux mécanismes d'arrêt, un seul vérifié | |
| **J** | `validateEnvelope` trop permissif | Une permission PROPOSED passait |
| **K1** | Handler manquant absorbé en silence | Un oubli d'intégration **brûlait un usage sans rien faire**, en renvoyant un succès |
| **K2** | Handler asynchrone jamais attendu | Un handler `async` renvoyait toujours `HANDLER_REJECTED` |

### Ce que le système taisait sur lui-même

| | Constat | Ce qui n'allait pas |
|---|---|---|
| **C12** | Le harnais de fuite était cassé | `validateDataLeakage()` appelait une méthode inexistante : il levait une exception et renvoyait toujours un échec. Quiconque clonait le dépôt concluait à un noyau en panne |
| **C13** | **Les refus ne laissaient aucune trace** | 1000 tentatives d'auto-attribution d'autorité → 1000 refus corrects → **zéro entrée d'audit**. Un seul chemin de refus sur cinq écrivait quelque chose. L'attaque **réussie** était tracée, l'attaque **tentée** ne l'était pas — l'inverse de ce qu'on veut. Corrigé avec agrégation exponentielle (1000 tentatives → 9 entrées), le journal étant borné à 200 : journaliser naïvement aurait créé une primitive d'éviction |
| **C14** | Le geste qui fait taire le détecteur n'était pas tracé | `rebaselineMirror()` n'écrivait rien. On pouvait éteindre l'alarme sans que l'extinction apparaisse nulle part |
| **C18** | **Un refus après coup n'est pas un refus** | Deux exécutions concurrentes sur une permission à usage unique : la seconde est correctement refusée, **mais les deux handlers ont tourné**. Si le handler envoie un mail, il est parti deux fois — et le journal n'en montrait aucune trace. Structurel : `#prepare` réserve, **le handler tourne**, puis `#finish` vérifie. Les huit contrôles de `#finish` sont donc tous postérieurs à l'effet. Corrigé : tout refus post-handler journalise `ACTION_REFUSED_AFTER_SIDE_EFFECT` |

### Fiabilité

| | Constat | Ce qui n'allait pas |
|---|---|---|
| **C17** | Fuite de capacité sur échec d'exécution | Deux méthodes portant le même nom `release()` : celle du ledger restitue l'autorité, celle du gestionnaire de permissions supprime un marqueur interne. **Cinq chemins d'échec sur six appelaient la mauvaise.** Un handler qui plante retirait définitivement de la capacité utilisable. Quatre exploits reproduits empiriquement |
| **C15** | Test de non-régression manquant | Le ledger s'épuise à exactement 100 opérations — aucun test ne le voyait, aucun n'enchaînait 100 cycles sur la même instance |
| **C16** | Plafond initial figé en dur | Rendu configurable (défaut inchangé) |

### Deux corrections de méthode, plus embarrassantes que les failles

**I1 — les 116 000 attaques n'en étaient pas 116 000.** C'étaient **dix formes
identiques rejouées 11 600 fois chacune** : un multiplicateur, pas une
couverture. Les entrées sont désormais fuzzées par un PRNG déterministe, et le
rapport distingue explicitement `distinctAttackShapes: 10` de
`executionsPerShape: 11600`. **Lisez ces deux chiffres séparément** — c'est le
sens même de la correction.

**I2 — le prédicat d'altération d'audit ne touchait jamais au journal.** Il
dupliquait le test d'`authorityGain`. La chaîne n'était donc jamais vérifiée
par l'attaquant adaptatif.

---

## Registre d'intentions — la couche au-dessus

`intent-registry.js` répond au problème signalé plus haut : JARVIS ne juge pas
la nature des actions. Si un modèle rédige lui-même les permissions, un texte
piégé produit `DELETE_ALL`.

Le principe : **le modèle ne rédige jamais une permission, il choisit dans un
menu fermé.** Le gabarit appartient au code.

```
modèle  →  {intent:'save_note', params:{…}}     choix dans le menu
code    →  construit la permission depuis SON gabarit
humain  →  approuve ce que le code a construit
JARVIS  →  gouverne
```

Testé contre huit tentatives d'injection. Les cas les plus parlants sont ceux
qui « passent » : quand le modèle glisse `action:'DELETE_ALL'` ou
`maxUses:999` dans sa sortie, la proposition aboutit — **et ces champs
n'existent nulle part dans la permission construite**. Ils ne sont pas refusés,
ils n'ont jamais eu d'existence.

---

## Ce qui reste, et qui est assumé

**Composants décoratifs, signalés et non corrigés.** `Loki.allAttempts()`
renvoie un objet constant tout-à-false. `Gollum.redTeam()` n'appelle que deux
stubs qui échouent inconditionnellement : son verdict est invariant. `FerNes`,
`CapabilityClosure.register()`, `Shield.enabled` et `Thanos.locked` sont
instanciés ou écrits mais jamais lus par une décision. **Ils gonflent la
surface apparente sans rien garantir.** À câbler ou à retirer.

**Déni de service par avance d'horloge.** Le recul est bloqué, l'avance ne
l'est pas.

**`identityProof.signature` est exposée.** Vérifié : requise par `verify()`,
non forgeable (modifier l'identité invalide la preuve), non rejouable ailleurs
(`UNKNOWN_SESSION`). C'est un porteur de session, pas une clé. Le risque réel
est son apparition dans des logs : à rédiger avant toute sortie.

**Une approbation peut autoriser N exécutions.** Une permission `maxUses:50`
s'exécute cinquante fois avec une seule approbation. Le ledger plafonne
l'ensemble, mais rien ne limite une permission à une fraction du budget.

**Le compromis de C17.** Une permission qui échoue une fois ne peut plus être
ré-exécutée : il faut reproposer. Choix fail-closed délibéré, vérifié par le
test lui-même pour que personne ne le découvre par surprise.

---

## Ce que la suite mesure

21 suites, 0 échec, ~13 s.

`runAllTests()` est **synchrone** ; C18 exige une vraie concurrence, donc de
l'asynchrone. Utiliser **`runAllTestsFull()`** pour tout lancer — sans lui, le
test le plus important est silencieusement sauté.

La démo navigateur rejoue huit suites dans l'onglet, en ~90 ms sur Safari iPad.
`jarvis-browser.js` contient le noyau **inchangé**, précédé d'un shim
SHA-256/HMAC en JS pur (le `crypto` de Node est synchrone, `SubtleCrypto` ne
l'est pas), vérifié digest par digest contre Node sur 30 vecteurs : chaîne
vide, limites de bloc 55/56/63/64/65, UTF-8 multi-octets, clés plus longues que
le bloc, updates chaînés.

---

## Provenance

Ce durcissement a été mené en boucle courte avec un assistant IA : formulation
d'hypothèses d'attaque, écriture des exploits, correctifs, tests de
non-régression. Les exploits sont reproductibles et présents dans le fichier.

**Ce n'est pas un audit indépendant**, et ce dépôt ne le prétend pas. C'est un
journal de durcissement honnête — y compris sur les fois où le harnais se
mesurait mal lui-même (I1, I2, C12), où le système taisait ce qu'on lui faisait
(C13, C14), et où il annonçait un refus alors que l'effet avait déjà eu lieu
(C18). C'est précisément la partie qu'un rapport complaisant aurait tue.
