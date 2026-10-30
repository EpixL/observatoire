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

## Sources implémentées (6 actives, 5 désactivées)

| id | Organisme / type | Mode | Endpoint | Cadence | Résultat du smoke réel (Pi, 29/10/2026) | Statut |
|---|---|---|---|---|---|---|
| `france-diplomatie-cv` | MEAE — autorité | page HTML | `https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs` **(sans « / » final)** | 30 min | avec « / » : 301 vers `http://` (port 80 fermé) → ConnectError. **URL corrigée** ; redirection https→http désormais une erreur explicite ; **2e smoke : OK** | `verified` |
| `france-diplomatie-rss` | MEAE — autorité | RSS | `…/spip.php?page=backend&lang=fr` | 5 min | **403** avec notre User-Agent honnête | `blocked_by_site` — **désactivée** ; chercher le flux officiellement documenté (FAQ voyage) |
| `easa-czib` | EASA — autorité | tableau HTML, 1 document par CZIB | `https://www.easa.europa.eu/en/domains/air-operations/czibs` | 30 min | 200, ETag et Last-Modified supportés ; structure d'une ligne relevée | `verified` (22 CZIB lus au 2e smoke) — réserves : pagination non vérifiée ; bulletins à accès restreint absents |
| `ioda-fr` | Georgia Tech IODA — mesure | API JSON v2, **9 entités** (France + flanc est) | `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?…` | 30 min | 200, enveloppe confirmée (France : `data: []`, `format: codf`) | `partially_verified` — **forme d'un événement non confirmée** (aucun événement observé) ; copyright Georgia Tech noté |
| `cert-fr-alertes` | CERT-FR (ANSSI) — autorité | RSS | `https://cert.cyber.gouv.fr/alerte/feed/` | 15 min | 200, 40 entrées, ETag/Last-Modified ; ordre **non chronologique** ; entrées « [MàJ] » datées de l'origine | `verified` |
| `cert-fr-actualite` | CERT-FR — autorité | RSS | `https://cert.cyber.gouv.fr/actualite/feed/` | 15 min | 200, 40 entrées | `verified` |
| `sgdsn-vigipirate` | SGDSN — autorité | page HTML | `…/vigipirate` (URL supposée) | 15 min | 200 mais **page anti-robot Gcore** prise à tort pour un succès (**corrigé**) | `blocked_by_site` — **désactivée** ; chercher une source officielle alternative du niveau Vigipirate |
| `france24-fr` | France Médias Monde — média | RSS | `https://www.france24.com/fr/rss` | 30 min | 200, 24 entrées | `verified` |
| `vigipirate-gouv` | Gouvernement — autorité | page HTML | `https://www.gouvernement.fr/risques/vigipirate` | 30 min | **BLOCKED (smoke Pi 30/10)** : 301 vers `info.gouv.fr/risques/vigipirate` (hors liste blanche) ; test manuel avec UA honnête : **403** | `blocked_by_site`, désactivée. Aucune source Vigipirate accessible honnêtement |
| `nato-news` | OTAN — autorité | RSS | *(inconnue)* ; `discover-feeds` : `/en/natohq/RSS.htm` = **404** (smoke Pi 30/10) ; candidate : `nato.int/cps/fr/natohq/RSS.htm` | — | à tester | `to_discover`, désactivée |
| `eeas-presse` | UE / SEAE — autorité | liste de pages (`press-material_en?page=N`) | *(aucun RSS trouvé)* | — | non testée | `to_discover`, désactivée |

**Second smoke réel (Pi, 29/10/2026, 17:58 UTC)** : page des conseils OK ; EASA 22 CZIB ; IODA OK ; CERT-FR 40 + 40 ; France 24 24 ; Vigipirate BLOCKED (Gcore détecté, non contourné) ;
RSS France Diplomatie toujours 403 ; OTAN et SEAE ignorées (pas d'URL). Les flux CERT-FR mélangent des articles de 2014-2015 et de 2026 : cela vient de la source ; le
`sample_title` du rapport de smoke est désormais l'article le plus **récent**, pas le premier.

## Conditions d'utilisation (recherche du 30/10/2026)

**Limite importante :** depuis le cloud, aucun domaine source ne se résout (`WebFetch` : « ENOTFOUND » pour tous). Je n'ai donc lu **aucune** page de mentions légales,
de conditions d'utilisation ni de `robots.txt` à la source : ce qui suit vient d'**extraits de moteur de recherche** (secondaires, parfois datés) et doit être confirmé en
lisant les vraies pages. `robots.txt` est de toute façon respecté **à l'exécution** pour les pages HTML (le code s'abstient s'il est injoignable). Règle retenue : **en cas de doute, on ralentit** (30 min) ; usage **strictement privé**, aucune redistribution.

| Source | Ce que j'ai trouvé (et où) | Réutilisation | Cadence retenue |
|---|---|---|---|
| **CERT-FR / ANSSI** | Les [mentions légales ANSSI](https://cyber.gouv.fr/mentions-legales/) (extrait de recherche) placent les contenus sous **Licence ouverte v1.0** sauf mention contraire ; usage commercial soumis à autorisation préalable ; logos interdits sans autorisation. Flux d'alertes cité : `cert.ssi.gouv.fr/alerte/feed/` (vérifié ensuite sur le Pi, redirige vers `cert.cyber.gouv.fr`). | Oui en usage privé non commercial | 15 min (flux publié pour être lu par des machines) |
| **EASA (CZIB)** | La [page des zones de conflit](https://www.easa.europa.eu/en/domains/air-operations/czibs) porte un avertissement « à titre d'information générale » ; EASA propose un compte et le suivi de la catégorie « Conflict zone » ([page d'information](https://www.easa.europa.eu/easa-and-you/air-operations/information-on-conflict-zones)) ; **aucun RSS trouvé**. Conditions de réutilisation non trouvées. **Point d'attention :** [un article](https://ops.group/blog/easa-removes-czibs-middle-east-risk-gets-harder-to-read/) rapporte que certains bulletins passent en « Information Notes » à accès restreint : la liste publique peut être **incomplète**. | Non confirmée — usage privé uniquement | 30 min |
| **IODA** | Données sous copyright Georgia Tech Research Corporation (mention renvoyée par l'API). Le [dépôt `InetIntel/ioda-api`](https://github.com/InetIntel/ioda-api) est open source mais renvoie, pour un usage **non académique**, au Georgia Tech Office of Technology Licensing ; [CAIDA](https://www.caida.org/funding/ioda/) décrit le projet (financement NSF). Aucune limite de débit publiée trouvée. | **Non confirmée** : usage privé non commercial seulement ; ne rien redistribuer ; envisager d'écrire à Georgia Tech si le projet dépasse l'usage personnel | 30 min pour 9 entités = 18 requêtes/h |
| **France Diplomatie** | Canaux officiels documentés par le [Centre de crise](https://www.diplomatie.gouv.fr/fr/le-ministere-et-son-reseau/le-centre-de-crise-et-de-soutien/faire-connaitre-les-services-conseils-aux-voyageurs-et-fil-d-ariane/) : application « Conseils aux voyageurs », compte X @ConseilsVoyages. **Aucun flux RSS des conseils trouvé** ; le site a été refait en 2026 (un article l'indique), ce qui peut expliquer le 403 du RSS général. Mentions légales non lues. | Non confirmée — usage privé | 30 min, page seule, `robots.txt` respecté |
| **SGDSN / gouvernement (Vigipirate)** | Les changements de niveau sont annoncés par le gouvernement ([info.gouv.fr](https://www.info.gouv.fr/actualite/plan-vigipirate-des-moyens-exceptionnels-partout-sur-le-territoire)) et le ministère de l'Intérieur ; aucune source structurée trouvée. La page du SGDSN est derrière un défi anti-robot (Gcore). | — | source désactivée ; candidate `vigipirate-gouv` testée le 30/10 : 301 puis 403, abandonnée |
| **France 24** | **Aucune condition trouvée.** Les flux RSS de médias français comparables sont en général réservés à un usage personnel. | Titres/résumés du flux, usage privé, aucune redistribution | 30 min |
| **OTAN** | Page officielle « RSS » : [nato.int/cps/en/natohq/RSS.htm](https://www.nato.int/cps/en/natohq/RSS.htm) (dernière mise à jour 03/2023) ; URL exacte du flux non confirmée ; une source non officielle indique que la page « news » n'a pas de RSS propre. | Non confirmée | à définir (30–60 min) |
| **UE / SEAE** | [Liste « press material »](https://www.eeas.europa.eu/eeas/press-material_en) filtrable et paginée ; **aucun RSS trouvé**. | Non confirmée | à définir (30–60 min) |

**Vigipirate — proposition :** (1) tester sur le Pi la page `gouvernement.fr/risques/vigipirate` (candidate `vigipirate-gouv`, désactivée) : à activer seulement si le smoke la donne OK
**sans** défi anti-robot et si le niveau est lisible sans JavaScript ; (2) à défaut, suivre les annonces officielles (info.gouv.fr / interieur.gouv.fr) comme source de *changements* plutôt que d'état ;
(3) en dernier recours, saisir le niveau par **annotation humaine** (aucune API ne l'expose) — jamais par contournement.

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
