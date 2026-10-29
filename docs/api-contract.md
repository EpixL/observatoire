# Contrat d'API attendu par le dashboard (v0.1 — proposition)

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

`Snapshot` regroupe : `scenario_id`, `as_of`, `last_collect`, `gauge`, `coverage`, `conclusion`, `hypotheses`, `events`, `counters`, `dossiers`, `history`, `method_changes`, `sources`, `journal`, `civil_alert`, `nuclear`, `ai`, `demo`. En production `demo` vaut `false` (le bandeau « Données fictives — maquette » est piloté par ce champ).

## Écritures (POST) — non utilisées par la maquette

| Route | Effet |
|---|---|
| `POST /api/v1/ai/runs` `{dossier_id, scope, confirmed_max_cost_usd}` | Lance une analyse IA **uniquement après** confirmation du coût maximum ; le serveur réserve le budget avant l'appel. N'écrit jamais dans la jauge. Réponse `202` + identifiant ; le résultat arrive par SSE. |
| `PUT /api/v1/settings/ai-mode` `{mode}` | `desactivee` / `a_la_demande` / `automatique`. |
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
11. **IA** : `ai.mode`, `ai.budget_exhausted`, estimation et analyses précédentes (jamais écrasées). L'IA ne modifie ni la jauge ni un statut officiel.

## Écarts connus avec le plan (à trancher avec A)

- Le plan parle de `index_snapshots` : `GaugeState` + `HistoryPoint` en sont la projection d'affichage.
- Les identifiants de dossiers (`D-CIV`, `D-REG`, `D-EXT`) et de règles (`R-…`) de la maquette sont arbitraires.
- Pagination des événements et du journal non spécifiée (curseur `before` suggéré).
