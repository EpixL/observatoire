# Proposition de contrat d'API — côté backend (session A)

*À intégrer par la session B dans `docs/api-contract.md` (B possède ce fichier). Tout ce qui est décrit ici est **implémenté et testé** sur la branche `backend`
(`backend/app/api/main.py`, `tests/test_api.py`), sauf mention « non fait ».*

## Conventions (alignées sur le contrat de B)

- JSON, UTF-8, `/api/v1`. Dates ISO 8601 UTC. Paliers : entier parmi `0,10,25,40,55,70,85,100` ; **non calculable = `status:"non_calculable"` et `palier:null`, jamais `0`**.
- Erreurs partout (y compris la validation des paramètres) : `{"error":{"code":"…","message":"…"}}`. Codes : `401 unauthorized`, `503 writes_disabled`, `404 unknown_event|unknown_territory|not_evaluated`, `409 stale_policy_version`, `422 confirmation_required|reason_required|out_of_bounds|off_step|unknown_key|no_change|already_plan|annotation_incomplete|note_required|unknown_qualification|invalid_request`.
- **Écritures protégées** : `Authorization: Bearer <ADMIN_TOKEN>`. Sans `ADMIN_TOKEN` côté serveur → `503 writes_disabled`. L'acteur journalisé vient du serveur (`ADMIN_ACTOR`), pas du corps de la requête. Les lectures sont libres sur le LAN. Le jeton ne doit jamais être dans le code du navigateur : le reverse proxy (lot 4) l'ajoute pour les routes d'écriture, ou une page de connexion le demande.
- Le paramètre `territory` vaut `FR` (défaut) ou `flanc-est`. `GET /api/v1/territories` les liste. **La caméra de la carte n'est jamais un paramètre de la jauge.**

## Seuils versionnés (demande du dashboard)

| Route | Corps / réponse |
|---|---|
| `GET /api/v1/thresholds` | `ThresholdsState` : `{policy_version, plan_version, items[], history[]}`. `items[]` = `{key,label,description,unit,plan_value,value,min,max,step,affects}` — **`value` ET `plan_value` toujours renvoyés**. Clés identiques à `PLAN_THRESHOLDS` du dashboard, plus `convergence_window_h` et `coverage_freshness_h`. |
| `GET /api/v1/thresholds/history` | `ThresholdChange[]` (le plus récent d'abord) : `{id,at,kind:"modification"\|"retour_plan",key,label,from,to,reason,actor,policy_version}` |
| `GET /api/v1/thresholds/versions` | toutes les versions avec leurs jeux de valeurs complets (`seuils-vN`), pour reconstruire un calcul passé |
| `PUT /api/v1/thresholds` 🔒 | `{changes:[{key,to}], reason, confirmed:true, expected_policy_version}` → crée `seuils-v(N+1)`, renvoie `ThresholdsState`. Garde-fous serveur : `confirmed` obligatoire, motif ≥ 8 caractères, valeur dans `[min,max]` et sur le pas (à partir de `min`), version attendue à jour. |
| `POST /api/v1/thresholds/reset` 🔒 | `{reason, confirmed:true, expected_policy_version}` → nouvelle version `kind:"retour_plan"` aux valeurs du plan ; l'historique reste ; `422 already_plan` si rien à restaurer. |

Une version n'est **jamais** modifiée ni supprimée (triggers en base). Chaque instantané de jauge enregistre la version utilisée ; `gauge.policy = {version, plan_version, label}`.
Après un changement, `trend_24h`/`trend_7d` valent `non_comparable` avec `reason: "seuils modifiés entre-temps (seuils-v1 → seuils-v2)"`.

## État des sources (écran Réglages)

`GET /api/v1/sources/status` → `SourceRecord[]` conforme au type de B, avec la table de correspondance qu'il a proposée :

| `connector_health.state` | `state` | `verdict` |
|---|---|---|
| `ok` | `ok` | `OK` |
| `degraded` | `retard` | `OK` (+ motif = dernière erreur) |
| `failing`, `rate_limited` | `indisponible` | `FAIL` |
| `blocked` (403, page anti-robot, robots.txt, redirection non sûre) | `indisponible` | `BLOCKED` |
| `unknown` (jamais interrogée) | `retard` | `SKIPPED` |
| source désactivée | `desactivee` | `SKIPPED` — `verdict_reason` = `options.disabled_reason` |

Champs supplémentaires (optionnels pour le dashboard) : `verification_status` (`verified|partially_verified|unverified_blocked|blocked_by_site|to_discover`), `enabled`, `consecutive_failures`.
`/api/v1/connectors/health` renvoie la même chose (alias conservé).

## Jauge, dossiers

| Route | Réponse |
|---|---|
| `GET /api/v1/gauge?territory=` | `GaugeState` de B + `rule_id`, `rules_version`. `404 not_evaluated` tant que le worker n'a rien évalué. |
| `GET /api/v1/gauge/detail?territory=` | **ajout** : `{gauge, criteria[8], coverage, events[], raw_palier, pending_downgrade, floor_annotated, paliers[]}` — pourquoi ce palier, critère par critère (`rempli\|non_rempli\|non_evalue` + note + événements), couverture (`families[]` au format `CoverageFamily`, `baseline`, `reasons`, `pending_documents`, `pending_major_review`), définitions des 8 paliers. Alimente « Comprendre l'échelle » et la colonne de couverture. |
| `GET /api/v1/gauge/history?territory=&days=` | `{points:[{at,palier,policy_version,status}], method_changes[]}` ; `palier:null` = intervalle non calculable (courbe interrompue). `method_changes` = changements de version de seuils (`handling:"tendance_suspendue"`). |
| `GET /api/v1/dossiers[/{id}]?territory=` | `DossierScenario[]` : `D-CIV`, `D-REG`, `D-EXT`, `state ∈ actif\|indetermine\|veille`, `rules_version:"dossiers-1.0"`. **`hypotheses` est toujours `[]`** (moteur d'hypothèses non fait) et `missing` le dit. |

## Événements et revue humaine

| Route | Réponse |
|---|---|
| `GET /api/v1/events?territory=&status=&include_excluded=&limit=` | `VeilleEvent[]` (un événement hors zone connue est renvoyé avec `location.kind:"none"`) |
| `GET /api/v1/events/{id}` | un événement ; `id` = `EV-<n>` |
| `GET /api/v1/reviews?status=open` | file de revue (`claim_qualification`, `unqualified_document`, `prompt_injection_suspected`, `possible_same_origin`, `attribution_without_event`) |
| `POST /api/v1/events/{id}/review` 🔒 | `{qualification, details, note}` → `201`. `qualification ∈ grave_hostile_act\|armed_attack\|sustained_conflict\|not_hostile\|resolved\|retracted\|confirmed_civil_incident\|exercise_excluded`. Pour les trois premières, `details` doit contenir `facts_established, zone_established, period_established, actor_established = true` ; `armed_attack` et `sustained_conflict` exigent aussi `state_actor:true` ; `sustained_conflict` exige `campaign_established:true` (sinon `422 annotation_incomplete`). `note` ≥ 8 caractères. Une correction (`retracted`, `not_hostile`, `resolved`…) abaisse la jauge **immédiatement**. |

**Écarts de forme de `VeilleEvent` par rapport au type de B** (à répercuter dans `types.ts`) :
- `fictional` vaut `false` (le type de B est le littéral `true`).
- Ajouts : `event_type`, `zone_code`, `claims[]` (catégorie, rôle `primary|corroboration|contradiction|attribution`, `confirmation` **par affirmation**, `certainty`, `needs_review`), `annotations[]`, `sources[].date_flags`, `proposed_links[]` (déjà prévu par B).
- `reading_status` : `retenu` (événement matériel ou qualifié), `a_verifier` (qualification hostile en prose, en attente de revue), `contexte` (le reste, y compris l'historique).
- `exclusion` : `{reason:"perime", detail}` pour une republication ; `doublon`, `hors_perimetre`, `preuve_insuffisante` **non faits** (les doublons sont fusionnés dans l'événement par origine commune, pas exclus).
- `location` : centre **indicatif du pays** (`config/zones.yaml`, `precision:"pays"`), jamais une position précise ; `kind:"none"` sinon. Pas de `region` ni d'outre-mer plus fin que le territoire.
- `occurred_precision` : `instant|day|month|year|unknown` (vocabulaire déjà aligné).
- `evidence_status` : `directe` seulement si un événement matériel porte une preuve d'une source officielle ; sinon `deux_origines|origine_unique|non_corroboree` d'après `independent_origins`.
- `effect.palier` : palier du critère le plus élevé qui cite l'événement ; `non_evalue` si aucun.

## Non fait (reste à prévoir)

`/overview` (simple composition des routes ci-dessus), `/journal`, `/stream` (SSE), `/ai/*`, `/settings/*` (notifications : `officiel_a3` décidé, canal au lot 7), `civil_alert` et `nuclear` (les mentions
nucléaires/radiologiques sont stockées en attente de revue mais pas exposées comme badge), `conclusion`/`hypotheses` (moteur d'hypothèses), `exclusion.doublon/hors_perimetre/preuve_insuffisante`.

🔒 = nécessite `ADMIN_TOKEN`.
