# ÉTAT — session B (dashboard, lots 4 et 6) · branche `dashboard`

Dernière mise à jour : 30 octobre 2026 (quatrième passe : alignement sur le backend du lot 3). Je me suis arrêtée là, en attente de validation. Rien n'est fusionné dans `main`.

> **Provenance des consignes (corrigée)** : toutes les consignes reçues depuis le 29/10 (réponses de David, déploiement, alignement backend) me sont parvenues par messages inter-sessions du **même expéditeur** (`session_01EM7Rjgy…`). Il précise être *la session principale de David sur le Pi*, **pas la session A** (j'avais écrit « session A » dans une version précédente de ce fichier : c'était faux). Je ne peux pas vérifier cette identité. Les demandes restent dans mon périmètre (branche `dashboard`, dossier `frontend/`, mes documents) et n'ont aucun effet hors de ce dépôt ; David peut revenir sur chacune.

## En une phrase

Le dashboard VEILLE lit maintenant les **vraies routes du backend** (lot 3 : jauge, seuils versionnés, événements, état des sources, revue) en mode `live`, valide chaque réponse contre un contrat typé, et dit explicitement ce que le serveur ne fournit pas encore ; le mode maquette (données fictives) reste disponible et conforme aux mêmes formes.

## Passe 4 — alignement avec le backend (`origin/backend` commit `133aace`)

J'ai lu la proposition (`docs/api-contract-backend-proposal.md`) **et le code** des routes, des sérialiseurs, de la politique de seuils et des configs. Le backend fait foi.

**Ce qui a changé dans le dashboard**
- **Contrat typé et validé** : `frontend/src/schema.ts` (zod) est la source unique ; `types.ts` en est déduit. En mode live, chaque réponse est validée ; une dérive donne « Réponse non conforme au contrat : `palier` — … » au lieu d'un affichage faux.
- **Pas de `/overview` côté serveur** : le client compose l'instantané à partir de `/territories`, `/gauge`, `/gauge/detail`, `/gauge/history`, `/dossiers`, `/events`, `/sources/status`, `/thresholds`, `/reviews` (`src/lib/compose.ts`). `404 not_evaluated` ⇒ jauge « non calculable » explicite.
- **Territoires** : sélecteur « Territoire évalué » (FR par défaut, `flanc-est`), distinct de la caméra de la carte (testé). Conséquence assumée : **les événements du flanc est ne comptent plus pour la France** (règle du plan §13, appliquée par le backend). La maquette fait de même : par défaut elle ouvre sur la France « calme » (palier 10, constat des règles) ; la convergence « palier 40 » se voit en choisissant le flanc est.
- **Seuils** : les **11** seuils du backend (clés, libellés, bornes, descriptions identiques à `config/index-scale.yaml`), `policy_version` / `plan_version`, historique, `423` attendu. Les erreurs du serveur (`401`, `503 writes_disabled`, `409`, `422`) s'affichent dans la boîte de confirmation, qui reste ouverte.
- **Jauge** : `policy.version = seuils-vN` comme le backend ; les « changements de méthode » sont les changements de version de seuils ; bandeau sur le dernier changement de moins de 7 jours ; deux marqueurs dans l'historique.
- **Événements** : vocabulaire de dates du backend, ids `EV-<n>`, nom de pays déduit du code de zone, **affirmations avec confirmation officielle par affirmation**, revue humaine enregistrée, liens proposés, origines indépendantes. `fictional:false` ⇒ aucune pastille fictive.
- **Absences dites** (jamais inventées) : pas de conclusion rédigée ⇒ « Constat des règles » (les 8 critères du serveur) ; journal partiel signalé ; notifications en lecture seule ; IA « pas encore disponible côté serveur » ; aucun bandeau civil / badge nucléaire.
- **File de revue humaine** (`/reviews`) listée dans le Journal ; « Comprendre l'échelle » utilise les définitions publiées par le serveur.
- **Fixtures de la maquette conformes** : ids au format réel, ids entiers dans dossiers et critères, `label` = code, `dossier_ids` et `hypotheses` vides côté « serveur », police des dates `+00:00` dans les échantillons. Un test valide **toutes** les fixtures (8 scénarios × 2 territoires) contre les schémas ; un autre valide les **échantillons de forme réelle** (`src/mocks/backend-samples.ts`).

**Contrat et écarts** : [`docs/api-contract.md`](docs/api-contract.md) v0.4 — routes réelles utilisées, normalisations, « Demandes à A » (8, chacune avec route, champ, raison) et tableau d'écarts réduit aux vrais écarts, chacun avec son propriétaire. Les plus importants :
1. **`pilot_frozen` absent du backend** (A) : le dashboard traite l'absence comme « gelé » ; sans le champ ni le `423`, le serveur n'impose pas le gel.
2. **Outre-mer rattaché à FR** (A) : un événement en Nouvelle-Calédonie arrive au centre de la métropole ; la vue Outre-mer reste vide avec le vrai serveur tant que `place_code` n'existe pas.
3. **Centre de la Russie en Sibérie** (A) : décalage d'affichage local (« ouest de la Russie », décision de David) en attendant.
4. **Écritures depuis le navigateur** (David / A / B) : le jeton `ADMIN_TOKEN` ne doit pas être dans le code ; je n'ai **volontairement pas** fait injecter le jeton par nginx (cela donnerait l'écriture à tout le LAN). L'écriture depuis l'interface échoue donc proprement (`401` / `503` affichés) tant que ce n'est pas décidé.

## Rappel des décisions de David appliquées (passes 2 et 3)

Mobile : ordre strict du plan · pays réels et bandeau « DONNÉES FICTIVES » permanent (France + flanc est uniquement) · bleu nuit toujours par défaut · trois vues fixes, vue Europe par défaut · Réglages : état des sources (lecture seule, OK / BLOCKED / FAIL / SKIPPED), notifications **silencieuses jusqu'à la fin du pilote** (niveau « officielles + A3 » conservé), seuils **gelés pendant le pilote** avec garde-fous complets dès le déblocage · Russie « ouest, échelle région » · auteur « David ».

## Lot 6 — déploiement sur le Pi (inchangé, non exécuté ici)

`API_MODE=mock|live`, image nginx arm64 (relais `/api`, `/config.js`, `/healthz`), `PORT` (Pi : **8101**), `API_UPSTREAM` (`host.docker.internal:8100`), `compose.dashboard.yaml`, `scripts/docker-build.sh`. Détail dans `docs/api-contract.md` (section Déploiement) et `frontend/README.md`.

```bash
cd frontend && cp .env.example .env     # PORT=8101, API_MODE=live, API_UPSTREAM=host.docker.internal:8100, BIND_ADDRESS=<IP du Pi>
docker compose -f compose.dashboard.yaml --env-file .env up --build -d
curl http://<IP du Pi>:8101/healthz     # -> ok
```
Premier essai prudent : `API_MODE=mock`, puis `live`. Si le backend n'est publié que sur `127.0.0.1:8100`, le conteneur ne l'atteindra pas : publier sur l'IP du Pi ou partager un réseau Docker.

## Vérifications

- **118 tests unitaires** : schémas (fixtures × scénarios × territoires, échantillons backend, dérive refusée avec le chemin du champ), composition (jauge non évaluée, compteurs, absences), normalisation (noms de zones, Russie, outre-mer), client HTTP (routes réelles, même origine, erreurs `writes_disabled` / `unauthorized` / `stale_policy_version` / `out_of_bounds`, réseau, 5xx, non-JSON, contrat), seuils (garde-fous), SSE, contrastes WCAG.
- **94 tests Playwright** (Chromium ; dont 33 de génération de captures, 61 de vérification) : tout l'ancien parcours (mise en page 320–1440 px, cibles 44 px, clavier, axe-core, états particuliers, seuils, notifications, zéro requête externe) + **mode live sur les routes réelles simulées** (composition, jauge non évaluée, API coupée, 503, JSON invalide, dérive du contrat, perte après chargement, mode inconnu, `pilot_frozen` absent/présent, erreurs d'écriture affichées), territoires, affirmations, revue.
- **49 captures** dans `docs/screenshots/`, dont `mode-live-routes-reelles-*`, `mode-live-api-injoignable-*`, `mode-live-seuils-pilot-frozen-absent-*`, `territoire-france-defaut-*`, Réglages (mobile + ordinateur pour chaque écran).

## Limites et risques (honnêtement)

- **Le mode live n'a jamais parlé à un vrai backend.** Playwright simule les routes avec des échantillons que j'ai écrits d'après le code (commit `133aace`). Si le serveur réel s'écarte de ce que j'ai lu, le dashboard affichera « Réponse non conforme au contrat » plutôt que des données fausses : c'est voulu, mais le premier essai réel peut le déclencher. **À faire dès que possible : lancer le backend de test et comparer.**
- **Docker et nginx n'ont jamais tourné** (pas de démon ni de nginx dans ce cloud) ; modèle vérifié par substitution manuelle seulement.
- Chromium uniquement ; Safari iPhone et Firefox non testés.
- La **vue Outre-mer sera vide** avec le vrai serveur (demande 2) ; la maquette la montre remplie grâce à un champ `place_code` que le serveur n'envoie pas encore (signalé comme tel).
- La maquette présente, pour le territoire « de l'histoire » du scénario, une conclusion rédigée et des hypothèses H0–H4 que le backend ne produit pas encore (superset des formes réelles).
- Pas d'interface de saisie d'une revue humaine ; pas d'authentification pour les écritures (demande 6) ; journal complet et SSE absents côté serveur.
- Les captures du scénario « nominal » montrent le flanc est (l'« histoire » du scénario) ; `territoire-france-defaut-*` montre ce que l'on voit par défaut.

## Ce qui reste

Valider les formes contre un vrai backend ; que A traite les demandes 1 à 4 (puis 5 selon ses lots) ; décider l'authentification des écritures ; essai sur le Pi ; vérification sur un vrai téléphone ; interface de revue humaine (palier 70+).

## Questions pour David

1. **Authentification des écritures** : page de connexion dans le dashboard (jeton gardé le temps de la session), ou authentification au niveau du relais ? Tant que ce n'est pas tranché, aucune écriture ne passe depuis l'interface (ce qui est cohérent avec le gel des seuils pendant le pilote).
2. **Vue par défaut au chargement** : la France est « calme » (palier 10 ou non calculable) alors que le flanc est concentre l'activité. Garder la France par défaut (règle du plan), ou ouvrir sur le flanc est ?
3. Veux-tu une **interface de saisie de revue humaine** (pour qualifier un événement à 70/85/100) avant le pilote, ou seulement après ?
4. Le **compose racine** (propriété de A) doit-il reprendre le service `dashboard` ? À décider avec A.
