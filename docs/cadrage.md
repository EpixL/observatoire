# Lot 0 — Cadrage (réponses à la section 16 du plan)

*Rédigé le 29 octobre 2026 à partir de ce que David a déjà indiqué. Tout ce qui n'est pas connu est
listé en « Questions pour David » en bas : je n'ai rien décidé à sa place.*

## 1. Hôte

| Élément | Valeur connue | À préciser |
|---|---|---|
| Matériel | Raspberry Pi 5 | RAM (4, 8 ou 16 Go ?) |
| Architecture | arm64 | — |
| OS | Debian 13 | — |
| Conteneurs | Docker + Portainer déjà en place | version de Docker / plugin Compose |
| Réseau | IP LAN 192.168.1.50 | Ethernet ou Wi-Fi ? IPv6 actif ? |
| Stockage | Btrfs ; données sur le disque `/mnt/homelab` (pas le disque système) | **support : carte SD, SSD USB ou NVMe ?** (voir risque ci-dessous) ; espace libre |

**Risque à connaître : le support de stockage.** PostgreSQL écrit en continu. Sur une carte SD, ce n'est pas
recommandé (usure, corruptions lors des coupures). Un SSD (USB ou NVMe) est fortement conseillé pour le dossier
de données. Btrfs ajoute une particularité : son mode « copy-on-write » fragmente les bases de données ; on le
désactive pour le dossier de PostgreSQL (`chattr +C`, voir `docs/runbook.md`).

**Compatibilité arm64 (vérifiée).** Images Docker : `python:3.13-slim-bookworm` et `postgres:16-alpine` existent en
`linux/arm64` (contrôle par `scripts/check-arm64.sh`, digests verrouillés dans `backend/Dockerfile` et `compose.yaml`).
Dépendances Python : les 29 paquets épinglés de `backend/requirements.txt` ont une version installable en
`aarch64` (téléchargement de contrôle effectué pour cette plateforme).

**Empreinte prévue (estimation, à mesurer sur le Pi).** Limites mémoire par défaut : PostgreSQL 768 Mo,
chaque service Python 384 Mo. Aucun benchmark n'a été fait (je n'ai pas accès au Pi).

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
| Historique normalisé | 12 mois | **Non implémenté** (aucune suppression automatique). À décider avec David avant le lot 6. |
| Sauvegarde | quotidienne base + configs | **Non automatisée.** Commande `pg_dump` et restauration décrites dans `docs/runbook.md` ; à planifier sur le Pi. |

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

## Questions pour David

1. **Matériel** : combien de RAM sur le Pi ? Le dossier de données sera-t-il sur SSD/NVMe (et non carte SD) ? Quel espace libre ?
2. **Ports** : quel port libre pour l'API (variable `API_HOST_PORT`) ? Une liste des ports déjà utilisés accélérerait l'audit.
3. **Zones secondaires** (3 à 5 recommandées, plan §16). Pistes à valider ou rejeter, par intérêt direct pour la France
   (ressortissants, transports aériens, énergie) : flanc est de l'Europe (Ukraine, Russie, Biélorussie, Pologne, États baltes),
   Méditerranée orientale et Moyen-Orient (Israël, Liban, Iran, Syrie), Sahel. Quelles zones souhaites-tu ?
4. **Niveau de notifications** (pour le lot 7) : seulement les décisions officielles ; officielles + A3 ; ou officielles + A2/A3 ?
5. **Rétention** : 12 mois d'historique normalisé te convient-il ? Veux-tu des sauvegardes quotidiennes automatiques, et où les stocker (disque externe, NAS) ?
6. **Couverture pour autoriser « 0 »** : la proposition du plan est trois familles obligatoires (autorités/mesures,
   faits régionaux corroborables, mesure technique). Es-tu d'accord pour la tester telle quelle au lot 3 ?
7. **Contact du User-Agent** : un e-mail ou une URL de contact (variable `COLLECTOR_CONTACT`) sera visible des sites
   sources. Lequel veux-tu y mettre ?
8. **Conditions d'utilisation** : peux-tu consulter, ou me dire de chercher, celles de France Diplomatie, EASA, CERT-FR,
   SGDSN, IODA pour confirmer les cadences autorisées avant de resserrer les intervalles (aujourd'hui 5 à 15 min) ?
