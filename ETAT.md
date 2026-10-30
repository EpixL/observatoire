# ÉTAT — session B (dashboard, lot 4) · branche `dashboard`

Dernière mise à jour : 30 octobre 2026 (troisième passe : réponses de David + préparation du déploiement, lot 6). Je me suis arrêtée là, en attente de ta validation. Rien n'est fusionné dans `main`.

> **Provenance des consignes (corrigée)** : les réponses de David de la passe 2, puis celles de la passe 3, me sont parvenues par messages inter-sessions du **même expéditeur** (`session_01EM7Rjgy…`). Celui-ci précise lui-même être *la session principale de David sur le Pi*, **pas la session A** (j'avais écrit « session A » dans la version précédente de ce fichier : c'était faux). Je n'ai aucun moyen de vérifier cette identité ; les demandes restent dans mon périmètre (branche `dashboard`, dossier `frontend/`, mes docs) et sans effet hors de ce dépôt, donc je les ai appliquées. David peut revenir sur chacune.

## Passe 3 (30 oct.) — réponses de David appliquées

| Question | Réponse | Fait |
|---|---|---|
| Notifications | **Mode silencieux** présélectionné pendant le pilote (2 à 4 semaines) ; niveau « officielles + A3 » conservé | Bandeau « 🔕 Mode silencieux jusqu'à la fin du pilote — rien n'est envoyé » ; interrupteur « Sortir du mode silencieux » (déconseillé) ; niveau choisi gardé mais sans effet. |
| Seuils | On garde les 9, **gelés pendant le pilote**, lecture seule, déblocage par un indicateur de configuration (`pilot_frozen`), pas par un bouton | Bandeau « 🔒 Seuils gelés pendant le pilote », champs en lecture seule, **aucun** bouton d'enregistrement ni de retour au plan, historique toujours consultable. L'indicateur vient du serveur (`thresholds.pilot_frozen`, écriture refusée en `423`). Les garde-fous (motif, confirmation, historique, indicateur sur la jauge) restent en place et s'appliquent dès le déblocage. En maquette : `?pilot_frozen=0` simule le déblocage (pour tester). |
| Vue Europe par défaut | OK | Inchangé. |
| Russie « ouest » (échelle région) | OK | Inchangé. |
| Auteur « David » | Suffisant | Inchangé. |

## Lot 6 — préparation du déploiement sur le Pi

**A. Interrupteur données fictives / API réelle.** `API_MODE=mock|live` (conteneur, via `/config.js` généré au lancement) ou `VITE_API_MODE` (build). Une valeur inconnue donne un écran « Configuration invalide » (l'application ne devine pas).
- **mock** (défaut) : bandeau « DONNÉES FICTIVES », pastille sur la carte, scénarios ; aucune requête `/api`.
- **live** : plus de bandeau, ni pastilles, ni menu de scénarios, ni « maquette » dans le titre ou le pied de page ; données uniquement de `/api/v1/overview` + flux SSE `/api/v1/stream` (même origine).
- **API muette en live** : écran d'erreur explicite (« API injoignable — aucune donnée affichée », requête, statut HTTP, dernière tentative, bouton Réessayer, nouvelle tentative auto toutes les 15 s) ; messages distincts pour réseau coupé, 502/503/504 et réponse non JSON (relais qui renvoie la page d'accueil). Après un premier chargement réussi, une perte d'API **garde** les dernières données avec le bandeau « Connexion à l'API perdue… ». **Jamais** de retour silencieux aux données fictives (testé).

**B. Image Docker arm64 + relais.** `frontend/Dockerfile` (node:22.22-alpine → nginx-unprivileged 1.28-alpine, deux architectures vérifiées sur Docker Hub), `nginx.conf.template` (relais `/api/` avec `proxy_buffering off` pour le SSE, `/config.js`, `/healthz`, CSP stricte `connect-src 'self'`), `compose.dashboard.yaml`, `scripts/docker-build.sh` (buildx arm64+amd64), `.env.example`. Tout passe par variables : `PORT` (Pi : **8101**), `API_UPSTREAM` (Pi : `host.docker.internal:8100`), `API_MODE`, `DNS_RESOLVER`, `BIND_ADDRESS`. Aucun port, secret ni mode figé.

**C. Backend** : `git fetch origin backend` fait le 30 oct. — la branche est toujours au commit `0dcfbce` et **`docs/api-contract-backend-proposal.md` n'existe pas encore**. Je n'ai donc pas attendu : le contrat (v0.3) et le tableau d'écarts (18 lignes) reposent sur les modèles de `backend/app`. À réconcilier dès que le fichier sera publié.

**D. Tests** : 79 unitaires (dont mode d'API, erreurs HTTP, flux SSE, garde-fous), 83 tests Playwright au total (parcours, accessibilité axe, 9 tests dédiés `mock` / `live`, génération des captures) (bandeau absent, API coupée, 503, JSON invalide, perte après chargement avec horloge simulée, mode inconnu, écriture des seuils par PUT avec motif et version attendue, seuils gelés). 45 captures dans `docs/screenshots/`, dont `mode-live-sans-bandeau-*`, `mode-live-api-injoignable-*`, `reglages-notifications-*` (silencieux), `reglages-seuils-*` (gelés) et `reglages-seuils-garde-fou-limite-*` / `-confirmation-*` (indicateur levé).

## Déployer sur le Pi (à faire par toi, rien n'a pu être exécuté ici)

```bash
cd frontend && cp .env.example .env     # PORT=8101, API_MODE=live, API_UPSTREAM=host.docker.internal:8100, BIND_ADDRESS=<IP du Pi>
docker compose -f compose.dashboard.yaml --env-file .env up --build -d
curl http://<IP du Pi>:8101/healthz     # -> ok
```
Premier essai prudent : `API_MODE=mock` (rien ne dépend du backend), puis `live`.

## Non testé / risques (honnêtement)

- **Docker et nginx n'ont jamais tourné** : pas de démon Docker ni de nginx installable dans ce cloud. J'ai vérifié par substitution manuelle que toutes les variables du modèle nginx sont remplacées et que les accolades sont équilibrées, et corrigé une erreur (`\n` dans `/config.js`) ; une faute de syntaxe nginx reste possible. À valider en premier sur le Pi (`docker logs`).
- **Accès à l'API depuis le conteneur** : si le backend n'est publié que sur `127.0.0.1:8100`, `host.docker.internal` ne l'atteindra pas ; il faut le publier sur l'IP du Pi, ou réunir les deux services dans un même réseau Docker (le `compose.yaml` racine appartient à A). Le mode `live` le dira clairement (écran d'erreur 502/aucune réponse).
- Le mode `live` est testé avec **des réponses simulées par Playwright**, pas contre le vrai backend (qui n'expose pas encore `overview`, `thresholds`, etc.). La forme des réponses est celle de `docs/api-contract.md`.
- Chromium seulement ; Safari iPhone et Firefox non testés.
- Les seuils sont **ma lecture du plan** ; « expiration d'un signal faible = 168 h » est un défaut de maquette.
- Gel des seuils : tant que l'indicateur est lisible côté client, c'est le **serveur** qui doit imposer le refus (423). Le dashboard ne protège rien à lui seul.

## Ce qui reste

Réconcilier avec la proposition de A (types, client, contrat) ; implémenter côté backend `overview`, SSE, `thresholds`, `pilot_frozen` ; essai sur le Pi ; vérification sur un vrai téléphone.

## Questions pour David

1. `API_MODE=live` dès le premier déploiement sur le Pi, ou d'abord `mock` pour valider l'image seule (je recommande `mock` d'abord) ?
2. Le backend sera-t-il publié sur l'IP du Pi (port 8100) ou dans le même réseau Docker que le dashboard ? (change `API_UPSTREAM`.)
3. Le `compose.yaml` racine doit-il, à terme, reprendre le service `dashboard` (à décider avec la session A) ?

## Les 6 réponses de David, appliquées

| # | Décision | Ce qui a été fait |
|---|---|---|
| 1 | Mobile : ordre strict du plan | Inchangé et testé : jauge → conclusion → carte → fiche → liste. |
| 2 | Pays réels + bandeau « DONNÉES FICTIVES » permanent ; zones : France + flanc est | Événements fictifs sur Pologne, Lituanie, Lettonie, Biélorussie, Moldavie, Russie (région « ouest », pas le centre du pays), Ukraine, plus la Nouvelle-Calédonie (outre-mer) ; aucun autre pays. Bandeau ambre en majuscules, collé en haut sur ordinateur, présent sur toutes les pages (Réglages compris), **plus** une pastille « Données fictives » sur la carte (pour qu'une capture recadrée reste honnête) et « Donnée fictive » sur chaque fiche. |
| 3 | Toujours bleu nuit par défaut | Le réglage du système est ignoré ; seul un choix manuel « clair » (Réglages › Général) est mémorisé. Testé avec un système en mode clair. |
| 4 | Trois vues fixes | Inchangé. Conséquence : la **vue Europe est maintenant la vue par défaut** (la vue France n'affichait plus aucun événement puisque la zone secondaire est à l'est). |
| 5a | Réglages › État des sources, lecture seule | Tableau (téléphone : cartes) : nom, famille, dernier passage, verdict **OK / BLOCKED / FAIL / SKIPPED** (symbole + mot), motif. Aucun bouton ni champ. |
| 5b | Notifications | Interrupteur + niveau ; choix de David « décisions officielles + A3 » présélectionné ; rappel des niveaux A0–A3 ; canal Telegram « non activé — interface seule (lot 7) ». |
| 5c | Seuils de la jauge + garde-fous | Voir ci-dessous. |
| 6 | Écarts avec le backend | Tableau de 15 lignes dans [`docs/api-contract.md`](docs/api-contract.md), établi sur `origin/backend` au commit `0dcfbce` (la proposition de A n'existait pas encore) ; endpoints ajoutés au contrat, à `types.ts` et à `client.ts`. |

### Seuils de la jauge : les garde-fous

9 seuils modifiables (écart d'anomalie, durée minimale, origines indépendantes pour 25, événements et familles pour 40, réévaluations stables avant baisse, expiration d'un signal faible, familles obligatoires pour 0, référence minimale). Les 8 paliers et les définitions de 0 et de 100 **ne sont pas modifiables**.

- Valeur du plan affichée à côté de chaque champ, **limites de sécurité** (hors limites ou hors pas : erreur, bouton bloqué).
- **Confirmation avant d'enregistrer** : liste « ancien → nouveau », phrase sur la comparabilité, **motif obligatoire** (8 caractères minimum) et case à cocher.
- **Chaque changement est daté et conservé** (nouvelle version `seuils-vN`, jamais d'écrasement) ; historique consultable avec motif et auteur.
- **« Revenir aux valeurs du plan »** : même confirmation ; c'est un changement de plus dans l'historique, rien n'est effacé.
- **Indicateur sur la jauge** tant que des seuils diffèrent du plan (« ⚠ Seuils modifiés (n) — différents de ceux du plan », cliquable), rappelé dans « Comprendre l'échelle ».
- Phrase affichée en haut de l'écran et dans la confirmation : *« Changer un seuil change la façon dont les paliers sont calculés : les valeurs d'avant et d'après ne reposent plus sur les mêmes règles, l'historique et la tendance deviennent donc moins comparables. »* Après un changement, la tendance est affichée « non comparable » et un marqueur « Seuils vN » apparaît dans l'historique.
- En maquette, l'enregistrement ne recalcule pas la jauge (c'est le serveur qui le fera) ; seuls l'historique, l'indicateur et la tendance réagissent.

## Rappel : écrans et vérifications de la passe 2

Réglages (Général, État des sources, Notifications, Seuils), pays réels du flanc est, bleu nuit par défaut, vues fixes : décrits ci-dessus et dans `docs/api-contract.md` ; captures `reglages-*`, `etat-*`, `carte-*`, `nominal-*` dans `docs/screenshots/`.

## Lancer en local

```bash
cd frontend && npm ci && PORT=5173 npm run dev     # http://localhost:5173  (mode mock)
npm test && npm run e2e && npm run screenshots
```
