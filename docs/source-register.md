# Registre des sources — V1

Source de vérité technique : `config/sources.yaml` (validée au chargement, synchronisée en base par `sync-sources`).
Les champs dynamiques du plan (dernier succès, dernière nouveauté, état du connecteur) sont dans la table
`connector_health` : `python -m app.cli health`.

## Légende du statut de vérification

| Statut | Signification |
|---|---|
| `verified` | endpoint appelé avec succès **et** format compris, preuve datée (smoke réel sur le Pi, `options.verified_on`) |
| `partially_verified` | joignable depuis le Pi, mais format ou contenu pas entièrement confirmé |
| `unverified_blocked` | pas encore validé sur le Pi (URL à retester) |
| `blocked_by_site` | le site refuse notre accès honnête (403, page anti-robot) : **source désactivée, motif écrit, aucun contournement** |
| `to_discover` | URL du flux inconnue ; source désactivée |

Preuves : le 29/10/2026 depuis le cloud, tout était refusé par le proxy (`docs/smoke-cloud-2026-10-29.json`) ; le même jour à 17:08 UTC,
**smoke réel sur le Pi** (lancé par David via la session homelab : venv Python 3.13.5, NTP synchronisé, DNS OK). Un test automatique
impose qu'une source `verified`/`partially_verified` porte sa date de preuve, et qu'une source `blocked_by_site` soit désactivée avec son motif.

## Sources implémentées (6 actives, 4 désactivées)

| id | Organisme / type | Mode | Endpoint | Cadence | Résultat du smoke réel (Pi, 29/10/2026) | Statut |
|---|---|---|---|---|---|---|
| `france-diplomatie-cv` | MEAE — autorité | page HTML | `https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs` **(sans « / » final)** | 15 min | avec « / » : 301 vers `http://` (port 80 fermé) → ConnectError. **URL corrigée** ; redirection https→http désormais une erreur explicite ; marqueur de contenu attendu ; à **relancer** | `unverified_blocked` (à retester) |
| `france-diplomatie-rss` | MEAE — autorité | RSS | `…/spip.php?page=backend&lang=fr` | 5 min | **403** avec notre User-Agent honnête | `blocked_by_site` — **désactivée** ; chercher le flux officiellement documenté (FAQ voyage) |
| `easa-czib` | EASA — autorité | tableau HTML, 1 document par CZIB | `https://www.easa.europa.eu/en/domains/air-operations/czibs` | 10 min | 200, ETag et Last-Modified supportés ; structure d'une ligne relevée | `partially_verified` — parseur réécrit sur la structure réelle ; pagination et page entière à confirmer |
| `ioda-fr` | Georgia Tech IODA — mesure | API JSON v2 | `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?…` | 10 min | 200, enveloppe confirmée (France : `data: []`, `format: codf`) | `partially_verified` — **forme d'un événement non confirmée** (aucun événement observé) ; copyright Georgia Tech noté |
| `cert-fr-alertes` | CERT-FR (ANSSI) — autorité | RSS | `https://cert.cyber.gouv.fr/alerte/feed/` | 15 min | 200, 40 entrées, ETag/Last-Modified ; ordre **non chronologique** ; entrées « [MàJ] » datées de l'origine | `verified` |
| `cert-fr-actualite` | CERT-FR — autorité | RSS | `https://cert.cyber.gouv.fr/actualite/feed/` | 15 min | 200, 40 entrées | `verified` |
| `sgdsn-vigipirate` | SGDSN — autorité | page HTML | `…/vigipirate` (URL supposée) | 15 min | 200 mais **page anti-robot Gcore** prise à tort pour un succès (**corrigé**) | `blocked_by_site` — **désactivée** ; chercher une source officielle alternative du niveau Vigipirate |
| `france24-fr` | France Médias Monde — média | RSS | `https://www.france24.com/fr/rss` | 10 min | 200, 24 entrées | `verified` |
| `nato-news` | OTAN — autorité | RSS | *(inconnue)* | — | non testée | `to_discover`, désactivée |
| `eeas-presse` | UE / SEAE — autorité | RSS | *(inconnue)* | — | non testée | `to_discover`, désactivée |

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
