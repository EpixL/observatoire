# Contrat d'API du dashboard (v0.4) — aligné sur le backend

**Le backend fait foi** pour les noms et les formes (`docs/api-contract-backend-proposal.md` sur la branche `backend`, commit `133aace`, lots 0-3). Ce fichier décrit comment le dashboard (session B) les utilise, ce qu'il normalise, ce qu'il demande à A en plus, et ce qui manque encore.

- **Source unique côté code** : [`frontend/src/schema.ts`](../frontend/src/schema.ts) (schémas zod ; les types TypeScript en sont déduits). Chaque réponse de l'API réelle est **validée** contre ces schémas : une dérive du contrat devient une erreur lisible (« Réponse non conforme au contrat : `palier` — … »), jamais un affichage faux.
- **Fixtures** du mode maquette (`src/mocks/`) : validées contre les mêmes schémas par `src/schema.test.ts` (tous les scénarios × tous les territoires).
- **Échantillons de forme réelle** (`src/mocks/backend-samples.ts`) : écrits **à la main d'après le code du backend** (`api/main.py`, `serializers.py`, `gauge/*`), pas capturés sur un serveur en marche (aucun backend n'a tourné dans l'environnement du dashboard). À remplacer par de vraies captures dès qu'un backend de test sera disponible.

## Conventions (communes)

- JSON UTF-8, préfixe `/api/v1`, dates ISO 8601 UTC (`…Z` ou `…+00:00`). Paliers : `0,10,25,40,55,70,85,100` ; **non calculable = `status:"non_calculable"`, `palier:null`, jamais `0`**.
- Erreurs partout : `{"error":{"code","message"}}`. Codes utilisés par le dashboard : `404 not_evaluated`, `404 unknown_territory`, `401 unauthorized`, `503 writes_disabled`, `409 stale_policy_version`, `422 confirmation_required|reason_required|out_of_bounds|off_step|unknown_key|no_change|already_plan|annotation_incomplete|note_required|unknown_qualification|invalid_request`. Le dashboard affiche le message du serveur (reformulé en français pour `writes_disabled`, `unauthorized`, `stale_policy_version`).
- **Écritures protégées** : `Authorization: Bearer <ADMIN_TOKEN>` (sans `ADMIN_TOKEN` côté serveur : `503 writes_disabled`). Le jeton ne doit jamais être dans le code du navigateur ni dans l'image. **Le relais du dashboard ne l'ajoute pas** (voir « Demandes à A », n° 6).
- `territory` = `FR` (défaut) ou `flanc-est` (`GET /territories`). **La caméra de la carte n'est jamais un paramètre de la jauge.** Les événements d'un territoire sont ceux de ses zones, plus les événements sans zone ; une attaque en Ukraine est une attaque pour `flanc-est`, jamais pour `FR`.

## Routes du backend utilisées (toutes en lecture libre sauf 🔒)

Il n'existe **pas** de `/overview` côté serveur : le dashboard compose son instantané en appelant les routes ci-dessous en parallèle (`frontend/src/lib/compose.ts`).

| Route | Réponse (schéma) | Usage |
|---|---|---|
| `GET /territories` | `Territory[]` `{id,label,zones[],default}` | Sélecteur « Territoire évalué » ; défaut du serveur |
| `GET /gauge?territory=` | `GaugeState` + `rule_id`, `rules_version` ; `404 not_evaluated` tant que le worker n'a rien évalué | Cadran. `not_evaluated` ⇒ jauge « non calculable » explicite, le reste de l'écran fonctionne |
| `GET /gauge/detail?territory=` | `GaugeDetail` : `criteria[8]` (rempli/non rempli/non évalué + note + ids entiers), `coverage`, `events[]`, `paliers[]` (définitions), `raw_palier`, `pending_downgrade`, `floor_annotated` | « Constat des règles », couverture, « Comprendre l'échelle » (définitions du serveur) |
| `GET /gauge/history?territory=&days=30` | `{points[{at,palier\|null,policy_version,status}], method_changes[]}` | Historique en escalier ; `method_changes` = changements de version de seuils |
| `GET /dossiers?territory=` | `DossierScenario[]` (`D-CIV`, `D-REG`, `D-EXT`) ; `event_ids` entiers ; `hypotheses` toujours `[]` | Page Dossiers |
| `GET /events?territory=&include_excluded=true&limit=500` | `VeilleEvent[]` | Carte, liste, fiche |
| `GET /events/{id}` | `VeilleEvent` | (disponible, non utilisé aujourd'hui) |
| `GET /sources/status` | `SourceRecord[]` avec `verdict` `OK\|BLOCKED\|FAIL\|SKIPPED`, `verdict_reason`, `last_attempt`, `state` incl. `desactivee` | Réglages › État des sources (lecture seule) |
| `GET /thresholds` | `ThresholdsState` `{policy_version, plan_version, items[], history[]}` ; **`value` ET `plan_value` toujours présents** | Réglages › Seuils ; indicateur sur la jauge |
| `GET /thresholds/history`, `GET /thresholds/versions` | `ThresholdChange[]`, versions complètes | (historique déjà inclus dans `/thresholds`) |
| `PUT /thresholds` 🔒 | `{changes:[{key,to}], reason, confirmed:true, expected_policy_version}` → `ThresholdsState` | Enregistrement après confirmation + motif |
| `POST /thresholds/reset` 🔒 | `{reason, confirmed:true, expected_policy_version}` → `ThresholdsState` | « Revenir aux valeurs du plan » (un changement de plus, historique intact) |
| `GET /reviews?status=open` | `ReviewItem[]` | Journal › File de revue humaine |
| `POST /events/{id}/review` 🔒 | `{qualification, details, note}` → `201` | **Pas d'interface de saisie encore** ; la revue enregistrée s'affiche sur la fiche (`annotations[]`) |

### Ce que le dashboard fait des formes réelles (normalisation d'affichage, `src/lib/normalize.ts`)

1. `location.label` et `location.iso` valent le **code** de zone (`LT`) : le nom (« Lituanie — position indicative (échelle pays) ») vient de `src/lib/zones.ts`, recopié de `config/zones.yaml`. Géométries Natural Earth en alpha-3 : correspondance ISO-2 → alpha-3 locale.
2. `dossiers[].event_ids`, `criteria[].event_ids` (entiers) → `"EV-<n>"` ; `events[].dossier_ids` (toujours `[]`) est complété à partir des dossiers.
3. **Russie** : le centre du gazetier est `[95, 61]` (Sibérie). Décision de David (30/10) : marqueur sur l'ouest du pays, à l'échelle région. Le dashboard applique ce décalage d'**affichage** (`DISPLAY_OVERRIDES`), nommé « Ouest de la Russie ». Voir « Demandes à A », n° 3.
4. `fictional:false` du serveur ⇒ aucune pastille « Donnée fictive ». `demo:false` ⇒ aucun bandeau.
5. **Seuils gelés** : `thresholds.pilot_frozen` est absent du backend ; le dashboard traite l'absence comme **gelé** (valeur sûre) ; seul `false` explicite débloque l'édition.

### Ce que le backend ne fournit pas encore — le dashboard l'affiche comme absent, sans rien inventer

| Absent côté serveur | Rendu dans le dashboard |
|---|---|
| `conclusion` et `hypotheses` (moteur d'hypothèses) | Panneau « Constat des règles » (critères du serveur) ; aucune phrase fabriquée |
| `civil_alert`, `nuclear` | aucun bandeau ni badge (l'absence ne vaut pas absence de risque, le dashboard le rappelle dans l'aide) |
| `/journal` | Journal partiel (changements de seuils réels uniquement), signalé |
| `/stream` (SSE) | puce « Flux interrompu » ; actualisation toutes les 30 s |
| `/settings/notifications` | Réglage en **lecture seule** (mode silencieux jusqu'à la fin du pilote, niveau « officielles + A3 ») |
| `/ai/*` | « L'analyse IA n'est pas encore disponible côté serveur » ; aucun bouton actif |
| `exclusion` `doublon`, `hors_perimetre`, `preuve_insuffisante` | affichés si le serveur les envoie ; aujourd'hui seule `perime` existe |

## Déploiement : mode d'API, relais `/api`, ports

Le même conteneur nginx sert la maquette ou l'API réelle, choisi **au lancement** (aucun port ni mode figé dans l'image) :

| Variable | Rôle | Valeur sur le Pi |
|---|---|---|
| `PORT` | port d'écoute du dashboard | `8101` |
| `API_MODE` | `mock` (données fictives, aucune requête `/api`) ou `live` (API réelle). Toute autre valeur : écran « Configuration invalide », aucun repli | `live` |
| `API_UPSTREAM` | `hôte:port` du backend vu depuis le conteneur | `host.docker.internal:8100` ou `nom-du-service:port` si les deux services partagent un réseau Docker |
| `DNS_RESOLVER` | résolveur du relais | `127.0.0.11` (Docker) |

- nginx publie `/config.js` (`window.__VEILLE__ = {apiMode, apiBase:""}`) ; `apiBase` vide = **même origine**. `location /api/` relaie vers `API_UPSTREAM` avec `proxy_buffering off` (SSE), lecture 3600 s, en-tête `Host` conservé. Contrôle de santé du conteneur : `GET /healthz`.
- **Mode `live`** : démarrage = `GET /territories` puis les routes ci-dessus. Échec (réseau, 5xx, non-JSON, **dérive du contrat**) ⇒ écran « API injoignable — aucune donnée affichée » (statut HTTP, dernière tentative, « Réessayer », reprise auto toutes les 15 s). Après un premier chargement réussi, une perte d'API **garde** les dernières données, datées, avec le bandeau « Connexion à l'API perdue » ; actualisation toutes les 30 s. **Jamais** de retour silencieux aux données fictives.
- Attention hôte : si le backend n'est publié que sur `127.0.0.1:8100`, le conteneur ne l'atteint pas via `host.docker.internal`.

## Demandes à A (le dashboard ne modifie pas le backend)

| # | Route / champ | Demande | Raison |
|---|---|---|---|
| 1 | `GET /thresholds` + `PUT`/`POST /thresholds*` | Ajouter `pilot_frozen: boolean` (lu dans la configuration serveur, ex. `PILOT_FROZEN=1`, **jamais modifiable par l'API**) et répondre `423 {"error":{"code":"pilot_frozen",…}}` aux écritures tant qu'il vaut vrai. À lever par configuration + redémarrage. | Décision de David (30/10) : seuils gelés pendant le pilote. Aujourd'hui le dashboard déduit « gelé » de l'**absence** du champ ; sans le champ, le serveur n'impose rien et un client autre que le dashboard pourrait écrire (avec jeton). |
| 2 | `GET /events` | Ajouter `place_code` (code ISO-2 de la sous-zone, ex. `NC`) à côté de `zone_code` (racine `FR`), avec le centre de cette sous-zone dans `location` et `precision:"region"`. | `gaz.root()` ramène l'outre-mer à `FR` : un événement en Nouvelle-Calédonie arrive au centre de la métropole. La vue Outre-mer reste vide sans cela. Le dashboard sait déjà lire `place_code`. |
| 3 | `config/zones.yaml` → `RU` | Centre à l'ouest du pays (ex. `[38, 56]`) avec `precision:"region"`, ou champ `display_center`. | Décision de David : « ouest de la Russie, échelle région ». `[95, 61]` place le marqueur en Sibérie, hors de la vue Europe. Le dashboard applique un décalage local en attendant. |
| 4 | `GET /events` `exclusion.reason` | Produire `doublon`, `hors_perimetre`, `preuve_insuffisante` quand les règles les établissent (aujourd'hui seule `perime`). | Compteurs et liste des exclus (plan §10) ; déjà affichés si présents. |
| 5 | `GET /journal`, `GET /stream` (SSE), `GET\|PUT /settings/notifications`, `/ai/*`, `civil_alert`, `nuclear`, `conclusion`, `hypotheses` | À implémenter aux lots prévus (4, 5, 7 et reste du 3). Formes attendues : `JournalEntry`, `StreamMessage`, `NotificationSettings`, `CivilAlert`, `NuclearBadge`, `Conclusion`, `Hypothesis` de `schema.ts`. | Aujourd'hui affichés comme **absents**. |
| 6 | Écritures depuis le navigateur | Décider **comment le jeton arrive** : (a) page de connexion du dashboard qui garde le jeton en `sessionStorage` (jamais dans le code), (b) authentification HTTP au niveau du relais nginx + ajout du `Bearer` pour `PUT/POST`. **Je n'ai pas fait (b)** : sans authentification devant lui, le relais donnerait le droit d'écriture à tout le LAN, ce qui annule l'intérêt de `ADMIN_TOKEN`. | Plan §9 : « authentification pour les réglages et commandes ». Aujourd'hui l'écriture depuis l'interface échoue proprement (`401`/`503` affichés). |
| 7 | Ids d'événements | Homogénéiser en `"EV-<n>"` partout (`dossiers[].event_ids`, `gauge/detail.criteria[].event_ids`, `gauge/detail.events[].id` sont des entiers). | Confort : le dashboard normalise déjà. Priorité basse. |
| 8 | `GET /events` `dossier_ids` | Renseigner (aujourd'hui `[]`). | Confort : le dashboard le complète depuis les dossiers. Priorité basse. |

## Écarts restants (état au 30 octobre 2026) et propriétaires

| Écart | Propriétaire | État |
|---|---|---|
| `pilot_frozen` absent | **A** (demande 1) | contourné côté dashboard (absence = gelé) |
| `place_code` / outre-mer rattaché à FR | **A** (demande 2) | vue Outre-mer vide avec le vrai backend ; code prêt |
| Centre de la Russie en Sibérie | **A** (demande 3) | décalage d'affichage local |
| Exclusions `doublon` / `hors_perimetre` / `preuve_insuffisante` | **A** (demande 4) | non produites |
| Journal, SSE, notifications, IA, alerte civile, badge nucléaire, conclusion, hypothèses | **A** (demande 5) | affichés absents |
| Acheminement du jeton pour les écritures | **David / A / B** (demande 6) | à décider ; écriture UI non fonctionnelle de bout en bout |
| Interface de saisie d'une revue humaine (`POST /events/{id}/review`) | **B** | non faite (lot ultérieur) |
| Échantillons « forme réelle » écrits à la main, jamais comparés à un vrai serveur | **B** (avec A) | à valider contre un backend de test |
| Vue Outre-mer et libellés des 8 vignettes | **B** | faits ; dépendent de la demande 2 |

*Alignés (plus des écarts)* : vocabulaire des précisions de date (`instant|day|month|year|unknown`), groupes d'origine (`origin_id`, `independent_origins`), extraits avec leur source, liens proposés (`event_links`), affirmations avec confirmation **par affirmation**, verdicts de sources, version de seuils dans la jauge (`policy.version = seuils-vN`), erreurs `{"error":{…}}`, seuils versionnés insert-only, `423` à venir.
