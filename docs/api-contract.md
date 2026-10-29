# Contrat d'API attendu par le dashboard (v0.2 — proposition)

Propriétaire : session B (dashboard). La session A (backend) s'aligne dessus **ou** propose un écart motivé ; les types de référence sont dans [`frontend/src/types.ts`](../frontend/src/types.ts) (le fichier fait foi en cas de divergence de détail). Les données de démonstration sont dans `frontend/src/mocks/`.

## Principes

- JSON, UTF-8, REST sous `/api/v1`, plus un flux SSE. Même origine que le dashboard (via le reverse proxy) : aucun CORS, aucune clé dans le navigateur.
- **Dates** : ISO 8601 UTC (`2026-10-29T14:30:00Z`). Le dashboard affiche en Europe/Paris. Une date inconnue est `null`, jamais inventée ni corrigée en silence.
- **Paliers** : entier parmi `0, 10, 25, 40, 55, 70, 85, 100`. Jamais de décimale, jamais de pourcentage. Non calculable = `status: "non_calculable"` et `palier: null` (jamais `0`).
- **Aucune probabilité** dans aucune réponse. Les hypothèses ont un verdict qualitatif.
- Le serveur calcule ; le dashboard n'applique **aucune règle métier** (il affiche, filtre l'affichage et assemble les phrases du gabarit de conclusion).
- Erreurs : `{"error": {"code": "…", "message": "…"}}` avec le statut HTTP adapté.
- Authentification des commandes (réglages, périmètre, lancement IA) : hors périmètre de la maquette ; les lectures du pilote sont accessibles sur le LAN.

## Lectures (GET)

| Route | Réponse | Usage dans l'interface |
|---|---|---|
| `/api/v1/overview?territory=FR` | `Snapshot` (voir ci-dessous) | Chargement initial de toutes les pages |
| `/api/v1/events?territory=FR&since=…&layer=…&status=…&include_excluded=false` | `VeilleEvent[]` | Carte, liste, filtres (les filtres du dashboard n'agissent que sur l'affichage) |
| `/api/v1/events/{id}` | `VeilleEvent` | Fiche, lien profond |
| `/api/v1/gauge?territory=FR` | `GaugeState` | Cadran |
| `/api/v1/gauge/history?territory=FR&days=30` | `{points: HistoryPoint[], method_changes: MethodChange[]}` | Historique en escalier |
| `/api/v1/dossiers`, `/api/v1/dossiers/{id}` | `DossierScenario[]`, `DossierScenario` | Page Dossiers |
| `/api/v1/sources` | `SourceRecord[]` | Page Sources |
| `/api/v1/journal?kind=…&before=…` | `JournalEntry[]` | Page Journal |
| `/api/v1/ai/estimate?dossier=…&scope=current\|extended` | `{max_cost_usd, monthly_cap_usd, monthly_used_usd}` | Confirmation de coût |
| `/api/v1/sources/status` | `SourceRecord[]` (avec `verdict`, `verdict_reason`, `last_attempt`) | Réglages › État des sources (lecture seule) |
| `/api/v1/thresholds` | `ThresholdsState` : `policy_version`, `items[]` (valeur courante, valeur du plan, limites, pas), `history[]` | Réglages › Seuils de la jauge |
| `/api/v1/thresholds/history` | `ThresholdChange[]` (le plus récent d'abord) | Historique consultable |
| `/api/v1/settings/notifications` | `NotificationSettings` | Réglages › Notifications |

`Snapshot` regroupe : `scenario_id`, `as_of`, `last_collect`, `gauge`, `coverage`, `conclusion`, `hypotheses`, `events`, `counters`, `dossiers`, `history`, `method_changes`, `sources`, `journal`, `civil_alert`, `nuclear`, `ai`, `thresholds`, `notifications`, `demo`. En production `demo` vaut `false` (le bandeau « Données fictives — maquette » est piloté par ce champ).

## Écritures (POST) — non utilisées par la maquette

| Route | Effet |
|---|---|
| `POST /api/v1/ai/runs` `{dossier_id, scope, confirmed_max_cost_usd}` | Lance une analyse IA **uniquement après** confirmation du coût maximum ; le serveur réserve le budget avant l'appel. N'écrit jamais dans la jauge. Réponse `202` + identifiant ; le résultat arrive par SSE. |
| `PUT /api/v1/settings/ai-mode` `{mode}` | `desactivee` / `a_la_demande` / `automatique`. |
| `PUT /api/v1/settings/notifications` `{enabled, level}` | `level` ∈ `officiel` \| `officiel_a3` \| `officiel_a2_a3`. Choix de David : `officiel_a3`. Activation réelle du canal au lot 7. |
| `PUT /api/v1/thresholds` `{changes:[{key,to}], reason, confirmed:true, expected_policy_version}` | Enregistre des seuils. **Garde-fous côté serveur** (le dashboard les applique aussi, mais ne les remplace pas) : `confirmed` obligatoire ; `reason` ≥ 8 caractères ; valeur dans `[min,max]` et sur le `step` (sinon `422`) ; `expected_policy_version` périmé ⇒ `409`. Crée une **nouvelle** version de politique (`seuils-vN`) ; ne modifie jamais une version existante. Écrit une ligne d'historique par seuil (date UTC, acteur, ancienne et nouvelle valeur, motif) et une entrée de journal. |
| `POST /api/v1/thresholds/reset` `{reason, confirmed:true, expected_policy_version}` | Revient aux valeurs du plan **comme un changement de plus** (`kind: "retour_plan"`), historique conservé. |
| `POST /api/v1/events/{id}/review` | Revue humaine (qualification d'un document, annotation). |

Un changement du **périmètre d'analyse** est une commande distincte et authentifiée ; changer la vue de la carte n'en est jamais une.

## Flux temps réel : `GET /api/v1/stream` (SSE)

`Content-Type: text/event-stream`. Chaque message `data:` contient un `StreamMessage` :

| `type` | `data` | Effet côté interface |
|---|---|---|
| `snapshot` | `Snapshot` complet | Remplace l'état (envoyé à la connexion et après reconnexion) |
| `event.upserted` | `VeilleEvent` | Ajoute ou met à jour un élément (la sélection est conservée) |
| `source.health` | `SourceRecord` | Met à jour santé et couverture |
| `gauge.updated` | `GaugeState` | Met à jour le cadran |

Envoyer un commentaire `: ping` toutes les 20 s. Sur coupure, le dashboard affiche « Flux interrompu » et garde les dernières données avec leur date : **aucune ancienne observation ne prend l'apparence d'un flux en direct**. Proxy : `proxy_buffering off`.

## Règles de contenu que le serveur doit respecter (le dashboard les affiche telles quelles)

1. **Jauge** : `trend_24h` / `trend_7d` portent `from` et `to` (phrase « passage du palier 25 au palier 40 »). `stable` = même palier. `non_comparable` + `reason` après changement de méthode ou de couverture.
2. **Couverture** : profil non satisfait ⇒ `gauge.status = "non_calculable"`, `last_known` renseigné. Fait grave établi malgré une couverture partielle ⇒ palier documenté avec `partial_coverage: true`.
3. **Événement** : `reading_status` (retenu / contexte / à vérifier) est distinct du caractère officiel de la source (`sources[].official`) et du statut de preuve (`evidence_status`). Les événements exclus restent renvoyés avec `exclusion {reason, detail}`.
4. **Localisation** : `precision` ∈ `pays | region | indicatif`. Jamais de coordonnées plus précises que la connaissance réelle ; si seule une région est connue, `kind: "point"` avec le centre de la région et `precision: "region"`. Pas de lieu connu ⇒ `kind: "none"` + `reason` (liste « non localisé »).
5. **Indépendance** : `sources[].origin_id` identifie la chaîne de reprises ; `independent_origins` compte les origines distinctes (le dashboard ne recompte pas).
6. **Effet sur l'indice** : `effect.state` ∈ `rempli | non_rempli | non_evalue` avec `palier` et `criterion`. Pas de points additionnés.
7. **Conclusion à gabarit** : le serveur envoie `orientation`, `evidence_ids`, `trend`, `alternative` ; le dashboard assemble la phrase du §6.6 du plan. `orientation: null` ⇒ « plusieurs interprétations restent possibles ». `suspended_reason` ⇒ conclusion suspendue.
8. **Nucléaire / radiologique** : `nuclear.kind` ∈ `discours | exercice | alerte_radiologique | emploi_confirme`, indépendant du palier. `null` ne signifie pas absence certaine de risque.
9. **Alerte civile** : `civil_alert` indépendant du palier ; `instruction_url` pointe vers la consigne officielle.
10. **Historique** : un point par réévaluation ; `palier: null` = intervalle sans mesure (le dashboard interrompt la courbe). Chaque point porte `policy_version` ; `method_changes` décrit les changements (`tendance_suspendue` ou `historique_recalcule`).
11. **Seuils** : `gauge.policy` porte `version` et `plan_version`. Tant qu'au moins un seuil diffère du plan, le dashboard affiche un avertissement sur la jauge (le serveur doit donc toujours renvoyer `value` ET `plan_value`). Après un changement, le serveur signale `trend_*: non_comparable` (+ `reason`) sur la période concernée ; `history` ne contient jamais de suppression. Les huit paliers et les définitions de 0 et 100 ne sont **pas** des seuils modifiables.
12. **Sources** : `verdict` ∈ `OK | BLOCKED | FAIL | SKIPPED`, accompagné d'un `verdict_reason` lisible. Une page bloquée par un contrôle anti-robot est `BLOCKED` et n'est jamais contournée. `state` ajoute `desactivee` pour une source désactivée dans la configuration.
13. **IA** : `ai.mode`, `ai.budget_exhausted`, estimation et analyses précédentes (jamais écrasées). L'IA ne modifie ni la jauge ni un statut officiel.

## Écarts avec le backend (état de `origin/backend` au commit `0dcfbce`, lots 0-2)

Établi en lisant `backend/app/api/main.py`, `models/`, `events/schemas.py`, `config/zones.yaml`. `docs/api-contract-backend-proposal.md` n'existait pas encore : à reprendre quand la session A l'aura publié.

| # | Sujet | Backend actuel | Attendu par le dashboard | Proposition |
|---|---|---|---|---|
| 1 | API exposée | `/healthz`, `/api/v1/connectors/health`, `/api/v1/documents[/{id}]` | `overview`, `events`, `gauge`, `history`, `dossiers`, `journal`, `thresholds`, `settings/*`, `stream` (SSE) | Lots 3-4 : implémenter les routes ci-dessus ; `overview` peut être une simple composition |
| 2 | Santé des connecteurs | `state` ∈ `unknown\|ok\|degraded\|failing\|rate_limited\|blocked` | `state` ∈ `ok\|retard\|indisponible\|desactivee` + `verdict` ∈ `OK\|BLOCKED\|FAIL\|SKIPPED` | Table de correspondance : `ok→OK`, `blocked→BLOCKED`, `failing/rate_limited→FAIL`, `degraded→OK` + `state: retard`, `enabled=false→SKIPPED` + `desactivee`, `unknown→SKIPPED`. Le smoke renvoie aussi `OK_EMPTY` : affiché `OK` avec motif « réponse vide ». Exposer `last_error` (→ `verdict_reason`) et `last_attempt_at` (→ « dernier passage ») |
| 3 | Précision des dates | `instant\|day\|month\|year\|unknown` | **aligné** (le dashboard a adopté ce vocabulaire) | — |
| 4 | Localisation | `zone_code` ISO-2 (`config/zones.yaml`), pas de coordonnées | `location {lon, lat, precision, label, zone_code}` | Ajouter à `zones.yaml` un **centre indicatif** par zone (et par région pour la France) ; le serveur renvoie `precision: pays\|region`. Ne jamais dériver de lat/lon précis |
| 5 | Statut de lecture | `events.status` ∈ `active\|to_verify\|resolved\|historical` | `reading_status` ∈ `retenu\|contexte\|a_verifier` | `to_verify→a_verifier` ; `active→retenu` ou `contexte` selon la règle du lot 3 (champ à créer, distinct du caractère officiel de la source) |
| 6 | Exclusions | `exclusion_reason` (ex. `republication`) | `doublon\|hors_perimetre\|perime\|preuve_insuffisante` + `detail` | `republication→perime` ; ajouter `hors_perimetre` (règle de périmètre) et `preuve_insuffisante` ; ajouter un `detail` texte |
| 7 | Origines indépendantes | `origin_groups`, `events.origin_count`, `document_origins` | `sources[].origin_id`, `independent_origins` | **aligné** : `origin_id` = id du groupe, `independent_origins` = `origin_count` |
| 8 | Preuves | `evidence_links` (citation + `char_start/char_end` + `relation`) | `sources[].excerpt` | **aligné** ; le dashboard pourra surligner l'extrait si les positions sont exposées |
| 9 | Liens proposés | `event_links` (`possible_common_cause`, `possible_duplicate`) | `proposed_links[]` | **aligné** (affichés comme « proposition, jamais une preuve ») |
| 10 | À qualifier | `reviews` (kind, status, reason) | file « non localisé / à qualifier », `counters`, `coverage.pending_documents` | Exposer `GET /api/v1/reviews?status=open` |
| 11 | Confirmation officielle | `claims.confirmation` (par affirmation), `official_scope` | `sources[].official`, badge « Source officielle » | À aligner au lot 3 : le dashboard affiche le caractère officiel de la **source** ; la confirmation **par affirmation** reste à exposer |
| 12 | Jauge, hypothèses, dossiers, conclusion | absents (lot 3) | `gauge`, `coverage`, `hypotheses`, `conclusion`, `dossiers`, `history` | Voir « Règles de contenu » ci-dessus |
| 13 | Seuils versionnés | `index_policy_versions` prévu au plan §4, pas de modèle | `thresholds` (+ historique, `policy_version`) | Un seuil = une ligne de `index_policy_versions` ; **insert-only** (jamais d'update/delete, comme `first_seen_at`) |
| 14 | Notifications | `notification_outbox` prévue, rien d'implémenté | `NotificationSettings` | Lot 7 ; en attendant renvoyer `channel_state: "non_active"` |
| 15 | Temps réel | aucun | SSE `/api/v1/stream` | Lot 4 |

## Écarts connus avec le plan (à trancher avec A)

- Le plan parle de `index_snapshots` : `GaugeState` + `HistoryPoint` en sont la projection d'affichage.
- Les identifiants de dossiers (`D-CIV`, `D-REG`, `D-EXT`) et de règles (`R-…`) de la maquette sont arbitraires.
- Pagination des événements et du journal non spécifiée (curseur `before` suggéré).
