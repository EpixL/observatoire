# Lot 0 — Cadrage (réponses à la section 16 du plan)

*Rédigé le 29 octobre 2026 à partir de ce que David a déjà indiqué. Tout ce qui n'est pas connu est
listé en « Questions encore ouvertes » en bas ; les décisions de David du 29/10 sont dans leur tableau.*

## 1. Hôte

| Élément | Valeur connue | À préciser |
|---|---|---|
| Matériel | Raspberry Pi 5, **16 Go de RAM** | — |
| Architecture | arm64 | — |
| OS | Debian 13 | — |
| Conteneurs | Docker + Portainer déjà en place | version de Docker / plugin Compose |
| Réseau | IP LAN 192.168.1.50 | Ethernet ou Wi-Fi ? IPv6 actif ? |
| Stockage | Btrfs ; données sur `/mnt/homelab` : **disque dur USB mécanique** de 5,5 To (3,8 To libres) ; système sur SSD USB de 120 Go, à ne pas utiliser pour les données | — |

**Risque à connaître : le disque de données est mécanique.** PostgreSQL y fait de petites écritures aléatoires (lent, mais très
largement suffisant pour ce volume) ; un disque dur n'a pas le problème d'usure d'une carte SD, mais supporte mal les coupures
brutales pendant une écriture : d'où les sauvegardes `pg_dump`. Btrfs ajoute une particularité : son mode « copy-on-write » fragmente les bases de données ; on le
désactive pour le dossier de PostgreSQL (`chattr +C`, voir `docs/runbook.md`).

**Compatibilité arm64 (vérifiée).** Images Docker : `python:3.13-slim-bookworm` et `postgres:16-alpine` existent en
`linux/arm64` (contrôle par `scripts/check-arm64.sh`, digests verrouillés dans `backend/Dockerfile` et `compose.yaml`).
Dépendances Python : les 29 paquets épinglés de `backend/requirements.txt` ont une version installable en
`aarch64` (téléchargement de contrôle effectué pour cette plateforme).

**Empreinte prévue (estimation, à mesurer sur le Pi).** Limites mémoire par défaut : PostgreSQL 768 Mo,
chaque service Python 384 Mo (large marge avec 16 Go). Aucun benchmark n'a été fait.

## 2. Périmètre

- **Territoire principal : France (métropole + outre-mer)**, un territoire à la fois en V1 (plan §6.1).
  Le gazetier `config/zones.yaml` rattache chaque territoire d'outre-mer à la France (Mayotte → France).
  Une attaque dans un autre pays reste localisée dans ce pays : elle ne concerne pas la jauge France.
- **Zones secondaires : non décidées** → question 3. Le plan demande 3 à 5 zones ; sans choix de David, le
  collecteur fonctionne à l'échelle du monde sur les flux généraux et ne cible aucune zone en particulier.
- **Scénarios** (inchangés, plan §2) : perturbation majeure de services civils (72 h), dégradation régionale de
  sécurité (7 j), extension géographique d'un conflit (30 j). Ils sont utilisés à partir du lot 3 ; les lots 0-2 ne
  les évaluent pas.

## 3. IA, notifications, budget

- **IA : désactivée / manuelle, non implémentée à ce stade** (lot 5). Aucun appel externe d'IA n'existe dans le code.
  Le code ne contient ni clé ni emplacement pour une clé IA.
- **Notifications : aucune pour l'instant** (lot 7). Le journal d'envoi (`notification_outbox`) n'existe pas encore.
- **Budget** : coût IA = 0 tant que rien n'est activé. Cadre du plan conservé : objectif < 5 USD/mois,
  plafond applicatif 4 USD HT (à implémenter au lot 5). Aucune donnée payante n'est utilisée.

## 4. Rétention et sauvegarde

| Sujet | Proposition du plan | État |
|---|---|---|
| Snapshots bruts | 90 jours | **Implémenté** : purge quotidienne par le worker (`purge-snapshots` en manuel). Le texte normalisé est conservé. |
| Historique normalisé | 12 mois | **Implémenté** (`purge-history`, quotidienne dans le worker, `--dry-run` disponible) : supprime documents, versions, affirmations, preuves et événements de plus de 12 mois, **sauf** ce sur quoi s'appuie une décision humaine ; les seuils, leur historique et les instantanés de jauge sont conservés. |
| Sauvegarde | quotidienne base + configs | **Script fourni, non planifié** (`scripts/backup-db.sh` : `pg_dump`, vérification de l'archive, 7 jours) ; à lancer à la main puis à planifier après validation de la baseline. |

## 5. Critères de gravité et de couverture

Les critères de la jauge (paliers 0–100) sont ceux de la section 6 du plan, **inchangés** : ils seront codés au lot 3.
Rien dans les lots 0-2 ne calcule de palier. Le profil de couverture (familles obligatoires, fraîcheur, secours)
reste à valider : voir question 6.

## 6. Quotas et accès vérifiés ?

**Partiellement.** Depuis le cloud, tout était bloqué (`docs/smoke-cloud-2026-10-29.json`). Le smoke **réel sur le Pi** du 29/10/2026 a ensuite confirmé
l'accès à CERT-FR (×2), France 24, EASA (page) et IODA (enveloppe), et a montré deux sources refusant notre accès honnête (RSS France Diplomatie : 403 ;
Vigipirate : page anti-robot) — désactivées, sans contournement. Quotas et licences restent **non confirmés** (aucune source ne les publie dans les réponses ;
IODA indique un copyright Georgia Tech). Détail : `docs/source-register.md`. Le critère de sortie du lot 0 sera rempli après le second smoke et la relecture
des conditions d'utilisation par David (question 8).

## Décisions de David du 29/10/2026

*(relayées par la session homelab après le second smoke, puis ma reprise du travail confirmée par David le 30/10 : « Go vas-y ok »)*

| # | Sujet | Décision | Où c'est appliqué |
|---|---|---|---|
| 1 | Matériel | Pi 5 avec **16 Go de RAM** (vérifié). Données sur `/mnt/homelab` : disque dur USB **mécanique** de 5,5 To, 3,8 To libres, Btrfs. Le système est sur un SSD USB de 120 Go, **à ne pas utiliser pour les données**. `chattr +C` sur `postgres/`. | `.env.example` (`DATA_DIR=/mnt/homelab/veille`), `docs/runbook.md` |
| 2 | Port de l'API | `API_HOST_PORT=8100` (vérifié libre ; 8080 et 8090 sont pris) | `.env.example` |
| 3 | Zones secondaires | **Une seule** : le flanc est de l'Europe (Ukraine, Russie, Biélorussie, Pologne, Lituanie, Lettonie, Estonie, Moldavie) | `config/territories.yaml`, `config/zones.yaml`, entités IODA de `config/sources.yaml` |
| 4 | Notifications (lot 7, rien d'implémenté) | Décisions officielles + A3 | `docs/api-contract-backend-proposal.md` (`officiel_a3`) |
| 5 | Couverture pour autoriser « 0 » | Les 3 familles obligatoires du plan, telles quelles | `config/coverage-profiles.yaml`, seuil `coverage_families = 3` |
| 6 | Rétention et sauvegarde | 12 mois d'historique normalisé ; `pg_dump` nocturne vers `/mnt/homelab/@backups/observatoire/`, 7 jours de rétention, à côté du rsync des configs Docker (3 h 30). **Script et doc fournis, pas de cron** : la baseline doit d'abord être validée à la main. | `backend/app/retention.py` (purge 12 mois), `scripts/backup-db.sh`, `docs/runbook.md` §5 |
| 7 | `COLLECTOR_CONTACT` | À terme, l'URL d'une page de contact sur davlab.fr (créée au lot 6). D'ici là `smoke-test`. **Aucune adresse e-mail personnelle dans le dépôt.** | `.env.example` |
| 8 | Conditions d'utilisation | À chercher par la session backend ; si bloqué, le noter | `docs/source-register.md` (section « Conditions d'utilisation ») |

## Questions encore ouvertes

1. **Vigipirate** : aucune source officielle accessible sans contournement n'est encore identifiée (voir `docs/source-register.md`). Tant que ce n'est pas résolu, la famille « autorités et mesures » repose sur EASA et la page des conseils aux voyageurs.
2. **Conditions d'utilisation** : j'ai seulement pu lire des extraits de recherche (le cloud ne résout aucun domaine source). À confirmer en lisant les vraies pages, surtout EASA, IODA et France 24 — voir le tableau.
3. **Notifications** : les niveaux sont décidés, mais le canal Telegram n'existe pas avant le lot 7.
4. **Jeton d'administration** : un `ADMIN_TOKEN` doit être généré dans `.env` du Pi pour autoriser les écritures (seuils, revue humaine). Sans lui, elles restent désactivées.
5. **Qualification humaine** : les paliers 70/85/100 n'existent que par revue humaine d'un événement. Qui fait cette revue, et à quelle fréquence au pilote ?
