# Runbook — installation et exploitation sur le Raspberry Pi (lots 0-2)

Tout est testé en simulation sur le cloud ; **rien n'a encore tourné sur le Pi**. Ce document est la procédure à suivre
et à corriger au premier essai. Aucun port n'est figé : tout vient du fichier `.env`.

## 1. Préparation

```bash
git clone https://github.com/EpixL/observatoire.git && cd observatoire && git checkout backend
cp .env.example .env && nano .env      # valeurs factices à remplacer, voir ci-dessous
```

À renseigner dans `.env` : `POSTGRES_PASSWORD` (alphanumérique), `DATA_DIR`, `API_BIND_ADDR`, `API_HOST_PORT`,
`COLLECTOR_CONTACT`. `.env` est ignoré par Git (ne jamais le commiter).

### Choisir un port libre (audit des conflits)

```bash
sudo ss -ltnp | awk 'NR>1 {print $4}' | sed 's/.*://' | sort -n | uniq | tr '\n' ' '    # ports déjà écoutés
docker ps --format '{{.Names}}\t{{.Ports}}'                                                # ports publiés par Docker
```
Choisir un port absent des deux listes pour `API_HOST_PORT`. La base de données **ne publie aucun port** (réseau interne de la stack).

### Dossiers de données (Btrfs)

```bash
# Sur ce Pi : disque Btrfs /mnt/homelab (PAS le disque système). Le chemin vient de DATA_DIR dans .env, jamais écrit en dur.
export DATA_DIR=/mnt/homelab/veille            # = la valeur de DATA_DIR dans .env
sudo mkdir -p "$DATA_DIR"/{postgres,snapshots}
sudo chattr +C "$DATA_DIR/postgres"            # AVANT le premier démarrage, dossier VIDE : désactive le copy-on-write de Btrfs
lsattr -d "$DATA_DIR/postgres"                 # doit afficher « C »
sudo chown 70:70 "$DATA_DIR/postgres"          # utilisateur « postgres » de l'image postgres:16-alpine
sudo chown 10001:10001 "$DATA_DIR/snapshots"   # utilisateur de l'image applicative
```
Pourquoi `chattr +C` : le copy-on-write de Btrfs fragmente les fichiers de base de données qui se réécrivent en continu.
Conséquence : un instantané Btrfs du dossier `postgres/` n'est pas une sauvegarde fiable → utiliser `pg_dump` (section 5).
`DATA_DIR` ne doit pas pointer vers le disque système (carte SD : usure, voir `docs/cadrage.md`).

## 2. Valider les vrais flux AVANT de démarrer la collecte

```bash
./scripts/smoke-collectors.sh --all
```
Une requête par source, aucune écriture en base. Sorties : `smoke-out/smoke-report.json` et `smoke-out/raw/` (réponses réelles).
Colonne VERDICT : `OK`, `OK_EMPTY` (flux valide sans entrée), `BLOCKED` (403/429/robots), `FAIL` (erreur ou format inattendu).
Pour une source en `FAIL` sur la forme : transmettre `smoke-report.json` (et le fichier correspondant de `raw/` après relecture) pour ajuster le parseur.
Pour retrouver le bon flux RSS d'une page :
```bash
docker run --rm --entrypoint python -e COLLECTOR_CONTACT=ton-contact veille-backend:local -m app.cli discover-feeds france-diplomatie-cv
```
Corriger ensuite `endpoint_url` dans `config/sources.yaml` et passer `verification_status: verified` **uniquement** pour une source en `OK`.

## 3. Démarrer

```bash
docker compose --env-file .env up -d --build
docker compose ps                                  # db: healthy ; init: exited (0) ; worker, api: running
docker compose logs -f worker                      # « worker démarré », puis une ligne par collecte
curl -s http://$API_BIND_ADDR:$API_HOST_PORT/healthz       # {"status":"ok"}
curl -s http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/connectors/health | python3 -m json.tool | head -40
```
Portainer : créer une stack « depuis un dépôt Git » (branche `backend`, fichier `compose.yaml`), renseigner les variables du
`.env.example` dans l'interface, activer la construction de l'image.

## 4. Surveillance (critère « 72 h de fonctionnement »)

```bash
docker compose exec worker python -m app.cli health              # état de chaque connecteur
docker compose exec db psql -U veille -d veille -c \
 "select source_id, outcome, count(*), max(started_at) from fetch_runs group by 1,2 order by 1,2;"
docker compose exec worker python -m app.cli verify-provenance   # doit afficher "bad": 0
docker compose exec db psql -U veille -d veille -c "select event_type, status, count(*) from events group by 1,2 order by 1,2;"
```
Lecture de `state` : `ok` · `degraded` (1 échec) · `failing` (≥ 2 échecs : visible, c'est la règle du plan §12) · `rate_limited` (429/503) · `blocked` (403, robots, redirection hors liste blanche).
Critère de réussite à 72 h : chaque source active a `last_success_at` récent, aucune ne reste `failing` sans explication notée,
`verify-provenance` renvoie 0 problème, et un redémarrage (`docker compose restart worker`) reprend sans doublon.

Test de reprise après coupure : `docker compose stop worker` 10 min puis `start` ; vérifier qu'aucun document n'est dupliqué
(`select count(*), count(distinct (source_id, external_id)) from documents;` → deux nombres égaux).

## 5. Sauvegarde et restauration (manuelles pour l'instant)

```bash
docker compose exec -T db pg_dump -U veille -d veille -Fc > "$DATA_DIR/backup-$(date +%F).dump"
# restauration dans une base vide :
docker compose exec -T db pg_restore -U veille -d veille --clean --if-exists < "$DATA_DIR/backup-AAAA-MM-JJ.dump"
```
Sauvegarder aussi `config/` et `.env` (hors Git). À planifier avec cron une fois l'emplacement choisi (question 5 du cadrage).

## 6. Mise à jour, retour arrière

```bash
git pull origin backend && docker compose up -d --build     # les migrations s'appliquent via le service « init »
docker compose exec worker python -m app.cli migrate        # (manuel, idempotent)
```
Retour arrière de schéma (après sauvegarde !) : `docker compose run --rm --entrypoint alembic init -c /app/alembic.ini downgrade 0001`
(supprime les tables du lot 2 et leurs données). Retour à la version précédente du code : `git checkout <commit>` puis `up -d --build`.

## 7. Dépannage

| Symptôme | Piste |
|---|---|
| `init` en échec | `docker compose logs init` : mot de passe, droits sur `DATA_DIR/postgres` (uid 70) |
| Source `failing` avec `HTTP 404` | URL supposée erronée : `discover-feeds`, corriger `config/sources.yaml`, `docker compose restart init worker` |
| Source `blocked` « page de défi anti-robot détectée » | le site protège sa page (Gcore, Cloudflare…) : **ne pas contourner** ; chercher une autre source officielle ou laisser la source désactivée |
| Source `domain_rejected` « redirection non sécurisée » | le site redirige vers http:// : corriger l'URL (souvent un « / » final en trop ou en moins) |
| Source `blocked` « interdit par robots.txt » | respecter : ne pas contourner ; demander l'autorisation ou utiliser un flux officiel |
| Source `blocked` « robots.txt injoignable » | réseau/DNS du Pi, ou 5xx temporaire du site (nouvel essai automatique) |
| Source `rate_limited` | intervalle trop court : augmenter `poll_interval_s` |
| Heures décalées | `timedatectl` : l'horloge du Pi doit être synchronisée (NTP) ; tout est stocké en UTC |
| Un port est déjà pris | changer `API_HOST_PORT` dans `.env` puis `docker compose up -d` |

## 8. Sécurité

- Aucun secret dans Git, les logs ni les fixtures. Les messages d'erreur masquent `key=`, `token=`, `password=`… (`sanitize_error`).
- Seul l'API est publié, sur l'adresse LAN choisie. Elle est en lecture seule et sans authentification à ce stade : ne pas l'ouvrir hors du LAN (pas de redirection de port, pas d'UPnP).
- Le worker est le seul service avec accès Internet sortant.
- Les redirections vers un domaine hors liste blanche sont refusées (`domain_rejected`).
