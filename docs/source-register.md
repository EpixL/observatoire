# Registre des sources — V1

Source de vérité technique : `config/sources.yaml` (validée au chargement, synchronisée en base par `sync-sources`).
Les champs dynamiques du plan (dernier succès, dernière nouveauté, état du connecteur) sont dans la table
`connector_health` : `python -m app.cli health`.

## Légende du statut de vérification

| Statut | Signification |
|---|---|
| **BLOQUÉ cloud — à vérifier sur le Pi** | Endpoint appelé une fois depuis l'environnement cloud le 29/10/2026 : refusé par le proxy sortant (`ProxyError: 403`). Le collecteur est testé sur des **fixtures fictives** uniquement. Aucun succès n'est simulé. |
| **URL supposée** | En plus : l'URL elle-même est une hypothèse de ma part (non confirmée). |
| **À découvrir** | URL du flux inconnue ; source désactivée. |

**Aucune source n'est marquée « verified ».** Un test automatique (`test_every_enabled_source_is_marked_unverified_in_cloud`)
interdit de le faire sans preuve.

## Sources implémentées (8 actives, 2 désactivées)

| id | Organisme / type | Mode | Endpoint configuré | Cadence configurée (plan) | Famille d'origine | Statut |
|---|---|---|---|---|---|---|
| `france-diplomatie-cv` | MEAE — autorité | page HTML | `diplomatie.gouv.fr/fr/conseils-aux-voyageurs/` (URL de la page citée dans le plan) | 15 min (pages 10–15) | fr-diplomatie | BLOQUÉ cloud (robots.txt injoignable) — à vérifier sur le Pi |
| `france-diplomatie-rss` | MEAE — autorité | RSS | `diplomatie.gouv.fr/spip.php?page=backend&lang=fr` | 5 min (RSS 2–5 si permis) | fr-diplomatie | BLOQUÉ cloud — **URL supposée** : flux général, pas forcément celui des conseils par pays → `discover-feeds` |
| `easa-czib` | EASA — autorité | page HTML | `easa.europa.eu/en/domains/air-operations/czibs` (URL du plan) | 10 min | easa | BLOQUÉ cloud — à vérifier ; flux RSS/JSON annoncés par EASA à identifier |
| `ioda-fr` | Georgia Tech IODA — mesure | API JSON v2 | `api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&entityCode=FR…` | 10 min (5–10) | ioda | BLOQUÉ cloud — **schéma de réponse reconstruit de mémoire**, à confirmer ; quotas inconnus |
| `cert-fr-alertes` | CERT-FR (ANSSI) — autorité | RSS | `www.cert.ssi.gouv.fr/alerte/feed/` | 15 min | cert-fr | BLOQUÉ cloud — **URL supposée** (le plan cite la page `cert.cyber.gouv.fr/flux-rss` ; l'ancien domaine redirige peut-être) |
| `cert-fr-actualite` | CERT-FR — autorité | RSS | `www.cert.ssi.gouv.fr/actualite/feed/` | 15 min | cert-fr | idem |
| `sgdsn-vigipirate` | SGDSN — autorité | page HTML | `sgdsn.gouv.fr/nos-missions/proteger-la-population/vigipirate` | 15 min | sgdsn | BLOQUÉ cloud — **URL supposée** (page exacte du niveau Vigipirate à confirmer) |
| `france24-fr` | France Médias Monde — média | RSS | `france24.com/fr/rss` | 10 min | media-france24 | BLOQUÉ cloud — **URL supposée**. Titres/résumés du flux uniquement, aucun contournement de paywall |
| `nato-news` | OTAN — autorité | RSS | *(inconnue)* | 10 min | nato | **À découvrir**, désactivée |
| `eeas-presse` | UE / SEAE — autorité | RSS | *(inconnue)* | 10 min | eeas | **À découvrir**, désactivée |

Cadences : volontairement prudentes. Resserrer vers 2–5 min seulement après lecture des conditions d'utilisation et
mesure sur le Pi (question 8 du cadrage). Chaque requête : User-Agent identifié, requête conditionnelle (ETag /
Last-Modified), temporisation aléatoire ±20 %, backoff exponentiel plafonné à 1 h (6 h minimum après 403/404),
`Retry-After` respecté, `robots.txt` respecté pour les pages HTML, 2 s minimum entre deux requêtes vers un même hôte.

## Champs du registre (plan §3) → où les trouver

| Champ du plan | Emplacement |
|---|---|
| identifiant, URL canonique, organisme, type, zone, compétence, langues, mode d'accès | `config/sources.yaml` → table `sources` |
| fréquence autorisée | `poll_interval_s` (cadence **choisie**, pas forcément la limite autorisée — inconnue) |
| délai attendu | non renseigné (à mesurer en production : `published_at` vs `first_seen_at`) |
| licence, quotas | `licence`, `quota_note` — **à confirmer** (aucune vérification possible depuis le cloud) |
| politique de conservation | `retention_days` (snapshots : 90 j) |
| dernier succès / dernière nouveauté / état | table `connector_health` (`last_success_at`, `last_new_at`, `state`) |
| conditions d'authentification | `auth_required` (aucune des sources V1 n'exige de clé) |
| famille d'origine | `origin_family` — sert à ne pas compter deux flux d'un même organisme comme indépendants |

## Sources du plan non implémentées dans les lots 0-2

| Source | Raison |
|---|---|
| Gouvernements / protection civile des zones retenues, ministères | zones non choisies (question 3) |
| Météo officielle, calendriers d'exercices | nécessitent une clé (Météo-France) ou des sources par zone ; lot 3 |
| OpenSky, AIS, Copernicus, FIRMS | V2/V3 du plan |
| Réseaux sociaux | facultatifs, non implémentés |
