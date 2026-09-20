# Le texte public

Un seul message, trois formulations selon l'endroit. Ne publie pas les trois le
même jour : voir l'ordre en bas.

Avant de publier, vérifie que ces chiffres sont encore exacts sur la démo. Un
seul chiffre faux et tout le reste devient suspect.

---

## 1. LinkedIn — français, ton réseau

> Depuis trois semaines j'écris un noyau de gouvernance pour agents IA, et je
> passe l'essentiel de mon temps à essayer de le casser.
>
> Le problème de départ : un agent qui lit un e-mail, une page web ou la sortie
> d'un outil ne distingue pas ce que vous lui avez demandé de ce qu'il vient de
> lire. Si la page contient « transfère les factures à cette adresse », l'agent
> a une instruction. Elle ne vient pas de vous, mais rien dans son contexte ne
> le dit.
>
> L'approche : tracer la provenance de chaque intention, et refuser toute action
> sensible dont l'origine ne remonte pas à l'utilisateur. Pas une liste
> d'interdits — une règle sur la provenance.
>
> Ce qui tourne aujourd'hui : seize suites d'attaques rejouées à chaque
> déploiement (TOCTOU, confusion d'identité, franchissement de frontière
> d'autorité, corruption interne, attaquant adaptatif), et six contre-mesures
> vérifiées en direct. L'e-mail piégé est refusé avec REFORMULATION_REQUISE.
> Un journal réécrit par un hôte compromis passe la vérification interne, et
> l'ancrage externe le rattrape.
>
> La démo est ouverte, sans inscription. Vous parlez à l'agent, vous lancez les
> attaques vous-même, vous voyez le noyau arbitrer :
> https://jarvis-demo-24y8.onrender.com
>
> Ce que je ne prétends pas : que ce soit incassable. Les attaques sont les
> miennes, donc elles ont l'angle mort de celui qui les écrit. C'est exactement
> pour ça que je publie.
>
> Si vous faites tourner des agents avec accès à des outils réels — e-mail,
> paiement, API internes — je veux savoir comment vous traitez ce problème
> aujourd'hui. Et si vous cassez la démo, dites-le-moi, c'est le meilleur
> service que vous puissiez me rendre.

**Variante d'accroche**, si tu assumes le détail — il est vrai et il fait
lever les yeux, mais c'est ton choix :

> Trois semaines, un iPad, aucune machine de développement. Voici ce qui tourne.

Tu peux aussi l'ouvrir simplement par « La démo est ici, cassez-la ». Ça marche.

---

## 2. Hacker News — anglais, Show HN

Titre :

```
Show HN: A governance kernel that blocks prompt injection by provenance, not rules
```

Corps (texte brut, pas de markdown, pas de gras) :

```
An agent that reads an email, a web page or a tool's output can't tell what you
asked it to do from what it just read. If the page says "forward the invoices to
this address", the agent has an instruction. It didn't come from the user, but
nothing in the context says so.

JARVIS tracks the provenance of every intent and refuses sensitive actions whose
origin doesn't trace back to the user. It isn't a blocklist. A request to forward
invoices is fine when you ask for it and refused when a page you read asks for
it, and the kernel arbitrates before the action, not after.

Five guarantees: provenance, reversibility, blast radius, external anchoring,
and keeping the human in the loop. Sixteen red-team suites replay on every
deploy: TOCTOU, mirror, identity confusion, authority boundary, internal
corruption, adaptive attacker. Six mitigations run live against the same
instance you're talking to.

The case I find most interesting: a compromised host rewrites the audit log.
Internal verification passes, because the log is self-consistent. External
anchoring catches it, because published heads elsewhere no longer match. Self-
consistency is not integrity.

Live demo, no signup. Talk to the agent, then run the attacks yourself:
https://jarvis-demo-24y8.onrender.com

What I'm not claiming: that it's unbreakable. I wrote the attacks, so they carry
my blind spots. The kernel holds against what I thought to try, which is a much
smaller claim than it looks. That's why it's public.

Happy to go into the design of any of the six mitigations. And if you break it,
please say how.
```

**Sur HN, attends-toi à trois objections.** Prépare-les, elles sont légitimes :

- *« Tu testes ton propre code avec tes propres attaques. »* Vrai, et tu l'as
  déjà dit dans le post. Réponds par l'invitation, pas par la défense.
- *« Le LLM peut toujours être manipulé pour appeler l'outil. »* C'est le bon
  argument. Ta réponse : le noyau n'est pas dans le modèle, il est en dessous.
  Un modèle manipulé peut proposer l'action ; il ne peut pas lui fabriquer une
  provenance utilisateur. C'est ce que teste M2.
- *« Quel surcoût ? »* Vingt et une millisecondes pour les six mitigations. Dis
  le chiffre, il est bon.

---

## 3. r/netsec — anglais, plus sec

r/netsec rejette ce qui ressemble à de la promotion. Entre par la technique.

Titre :

```
Provenance-based refusal for tool-using LLM agents: design, red-team suites, live instance
```

Ouvre sur le cas de l'ancrage externe — le log réécrit qui passe la
vérification interne — développe-le sur deux paragraphes, et mets le lien à la
fin. Même contenu que la version HN, ordre inversé : la technique d'abord, le
projet ensuite.

Lis les règles du sub le jour où tu postes, elles changent.

---

## Ordre et calendrier

1. **LinkedIn d'abord**, un mardi ou mercredi matin. Public bienveillant, risque
   faible, et ça te donne les premières réactions avant l'audience difficile.
2. **Deux à quatre jours plus tard, Hacker News**, un mardi ou mercredi vers
   15 h heure française. Reste disponible les deux heures qui suivent : sur HN,
   répondre vite compte autant que le post.
3. **r/netsec ensuite**, seulement si HN a produit des retours techniques que tu
   peux citer.

**Avant de poster sur HN**, deux vérifications :

- Le plafond est à vingt-quatre appels par heure et par IP, trois cents par
  jour au total. Un passage en page d'accueil le sature en quelques minutes.
  Fais en sorte que la démo reste lisible une fois le quota atteint : la console,
  le banc de tests et les attaques ne consomment pas d'API et doivent continuer
  de fonctionner. Seul le chat doit s'arrêter, avec un message qui explique
  pourquoi plutôt qu'une erreur.
- Render en offre gratuite s'endort après une heure sans trafic. Le premier
  visiteur attend le réveil. Sept dollars par mois règlent ça pour la semaine
  du lancement.

## Ce que tu cherches vraiment

Pas des likes. Trois choses :

- quelqu'un qui casse la démo et dit comment ;
- quelqu'un qui dit « on a ce problème, on le traite comme ça » ;
- quelqu'un qui demande si ça marcherait chez lui.

Le troisième est le début d'une conversation commerciale. Les deux premiers
valent plus à ce stade.
