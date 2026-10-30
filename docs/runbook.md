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
curl -s http://$API_BIND_ADDR:$API_HOST_PORT/healthz       # {"status":"ok"}   (port retenu : 8100)
curl -s http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/connectors/health | python3 -m json.tool | head -40
```
Portainer : créer une stack « depuis un dépôt Git » (branche `backend`, fichier `compose.yaml`), renseigner les variables du
`.env.example` dans l'interface, activer la construction de l'image.

### Jeton d'administration (écritures : seuils, revue humaine)

```bash
openssl rand -hex 24                        # copier le résultat dans .env : ADMIN_TOKEN=…   (jamais dans Git)
docker compose up -d api                    # prend en compte .env
curl -s -X PUT http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/thresholds -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"changes":[{"key":"downgrade_evals","to":1}],"reason":"essai de réactivité","confirmed":true,"expected_policy_version":"seuils-v1"}'
curl -s http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/thresholds/history | python3 -m json.tool
```
Sans `ADMIN_TOKEN`, toute écriture répond `503 writes_disabled`.

### La jauge

```bash
docker compose exec worker python -m app.cli evaluate-gauge        # une réévaluation immédiate (le worker le fait toutes les 5 min)
curl -s "http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/gauge?territory=FR" | python3 -m json.tool
curl -s "http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/gauge/detail?territory=flanc-est" | python3 -m json.tool
```
**Attendu pendant les 8 premières semaines : `non_calculable`** (référence quantitative insuffisante) — c'est le comportement voulu, pas une panne. `gauge/detail` dit pourquoi.

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

## 5. Sauvegarde, restauration, purge (décisions de David du 29/10/2026)

**Sauvegarde nocturne de la base** : `pg_dump` vers `/mnt/homelab/@backups/observatoire/`, 7 jours de rétention, à côté du rsync des configs Docker (3 h 30).
**Pas de cron installé par ce dépôt** : valider d'abord la baseline à la main.

```bash
./scripts/backup-db.sh                      # écrit observatoire-AAAA-MM-JJ.dump, vérifie l'archive (pg_restore -l), supprime au-delà de 7 jours
ls -lh /mnt/homelab/@backups/observatoire/
# restauration dans une base vide (arrêter d'abord worker et api) :
docker compose stop worker api
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < /mnt/homelab/@backups/observatoire/observatoire-AAAA-MM-JJ.dump
docker compose start worker api
# une fois la baseline validée, ligne cron suggérée (à ajouter VOUS-MÊME, après le rsync de 3 h 30) :
#   50 3 * * * cd /chemin/observatoire && ./scripts/backup-db.sh >> /mnt/homelab/@backups/observatoire/backup.log 2>&1
```
Ne sauvegarder que le dossier `postgres/` par copie de fichiers ou instantané Btrfs n'est **pas** fiable (écriture en cours + `chattr +C`) : `pg_dump` fait foi. Sauvegarder aussi `config/` et `.env` (hors Git).

**Purge de l'historique à 12 mois** (rétention décidée) : automatique une fois par jour dans le worker ; à tester avant :
```bash
docker compose exec worker python -m app.cli purge-history --dry-run     # compte ce qui serait supprimé, ne supprime rien
docker compose exec worker python -m app.cli purge-history               # supprime (12 mois) — les décisions humaines et ce qui les fonde sont conservés
```
Les seuils, leur historique et les instantanés de jauge ne sont jamais purgés.

## 6. Mise à jour, retour arrière

```bash
git pull origin backend && docker compose up -d --build     # les migrations s'appliquent via le service « init »
docker compose exec worker python -m app.cli migrate        # (manuel, idempotent)
```
Retour arrière de schéma (après sauvegarde !) : `docker compose run --rm --entrypoint alembic init -c /app/alembic.ini downgrade 0002`
(retire le lot 3 : seuils, instantanés, annotations) ou `downgrade 0001` (retire aussi le lot 2). **Les données de ces tables sont perdues** : sauvegarder avant. Retour à la version précédente du code : `git checkout <commit>` puis `up -d --build`.

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
- Seul l'API est publié, sur l'adresse LAN choisie (port 8100). Les lectures sont libres sur le LAN ; les écritures exigent `ADMIN_TOKEN` (désactivées s'il est vide). Ne pas l'ouvrir hors du LAN (pas de redirection de port, pas d'UPnP).
- Le worker est le seul service avec accès Internet sortant.
- Les redirections vers un domaine hors liste blanche sont refusées (`domain_rejected`).

## 8. Installation complète sur le Pi : backend + tableau de bord (procédure de déploiement)

Rien de ce chapitre n'a encore tourné sur le Pi. **Rien n'est fusionné dans `main` par ce dépôt** : la fusion se fait en local sur le Pi, dans une branche de déploiement, et la décision d'aller dans `main` reste à David.

### 8.1 Fusion des deux branches (ordre et conflit attendu)

Essai à blanc déjà fait dans le cloud : `backend` + `dashboard` fusionnent avec **un seul conflit, `ETAT.md`** (chaque session a écrit le sien). Aucun autre fichier n'est commun
(`frontend/`, `docs/api-contract.md` et `docs/screenshots/` viennent de `dashboard` ; tout le reste vient de `backend`).

```bash
git fetch origin backend dashboard
git checkout -b deploiement origin/backend            # branche LOCALE, jamais poussée vers main
git merge --no-ff origin/dashboard                    # s'arrête sur le conflit d'ETAT.md : c'est normal
git show origin/dashboard:ETAT.md > docs/ETAT-dashboard.md     # on garde l'état du dashboard sous un autre nom
git checkout --ours ETAT.md                           # ETAT.md = celui du backend
git add ETAT.md docs/ETAT-dashboard.md && git commit --no-edit
git status --short                                    # doit être vide
```
Si, plus tard, une des deux branches avance : refaire `git fetch` puis `git merge origin/<branche>` dans `deploiement`. Si un conflit autre qu'`ETAT.md` apparaît, **ne pas le résoudre au hasard** : le noter et le signaler (une des deux sessions a touché un fichier de l'autre).

### 8.2 Fichier `.env` (secrets générés sur place, jamais affichés)

```bash
cp .env.example .env && chmod 600 .env
# Générer les secrets directement DANS le fichier, sans jamais les afficher à l'écran :
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$(openssl rand -hex 24)|" .env
nano .env     # puis régler : DATA_DIR=/mnt/homelab/veille, API_BIND_ADDR / DASH_BIND_ADDR (IP LAN du Pi), API_HOST_PORT=8100, DASH_HOST_PORT=8101, COLLECTOR_CONTACT=smoke-test, DASH_API_MODE=mock
grep -c "CHANGER-MOI" .env                            # doit afficher 0
git check-ignore .env                                 # doit afficher « .env » (le fichier est ignoré par Git)
```
Le jeton `ADMIN_TOKEN` ne s'affiche jamais : pour l'utiliser dans une commande, `set -a; . ./.env; set +a` puis `$ADMIN_TOKEN` (ne pas faire `echo`).
Garder une copie de `.env` hors du dépôt (gestionnaire de mots de passe) : sans lui, la base sauvegardée reste lisible mais l'écriture des seuils ne l'est plus.

### 8.3 Dossiers de données (Btrfs)

Voir le §1 ; en résumé, avec `DATA_DIR=/mnt/homelab/veille` :
```bash
set -a; . ./.env; set +a
sudo mkdir -p "$DATA_DIR"/{postgres,snapshots}
sudo chattr +C "$DATA_DIR/postgres"                 # AVANT le premier démarrage, dossier vide
lsattr -d "$DATA_DIR/postgres"                      # doit afficher « C »
sudo chown 70:70 "$DATA_DIR/postgres" && sudo chown 10001:10001 "$DATA_DIR/snapshots"
df -h "$DATA_DIR"                                   # vérifier l'espace libre sur le disque dur
```

### 8.4 Ports : audit puis démarrage

```bash
sudo ss -ltn | awk 'NR>1 {print $4}' | sed 's/.*://' | sort -n | uniq | tr '\n' ' '; echo   # 8100 et 8101 ne doivent PAS y figurer
docker compose --env-file .env --profile dashboard config -q && echo "compose valide"
docker compose --env-file .env --profile dashboard up -d --build
docker compose --env-file .env --profile dashboard ps       # db healthy ; init exited (0) ; worker, api, dashboard running
```
Le profil `dashboard` ajoute le service nginx (arm64, port interne 8080 publié sur `DASH_HOST_PORT`). Il joint l'API **par le réseau interne de la stack** (`api:8000`), pas par l'hôte : l'API n'a donc pas besoin d'être exposée au tableau de bord.
Sans `--profile dashboard`, seule la partie backend démarre.

### 8.5 Vérifications juste après le démarrage

```bash
set -a; . ./.env; set +a
curl -s  http://$API_BIND_ADDR:$API_HOST_PORT/healthz                              # {"status":"ok"}
curl -s  http://$DASH_BIND_ADDR:$DASH_HOST_PORT/healthz                            # ok
curl -s  http://$DASH_BIND_ADDR:$DASH_HOST_PORT/config.js                          # apiMode: "mock" au début
curl -s  http://$DASH_BIND_ADDR:$DASH_HOST_PORT/api/v1/connectors/health | head -c 300   # le relais /api du dashboard atteint bien le backend
docker compose exec db pg_isready -U "$POSTGRES_USER"
docker compose ps --format '{{.Service}} {{.Ports}}' | grep -i 5432 || echo "la base ne publie aucun port (attendu)"
docker compose logs --tail 20 worker                                               # « worker démarré », puis une ligne par collecte
docker compose exec worker python -m app.cli evaluate-gauge                        # jauge « non_calculable » attendue (8 semaines)
```
Puis, **dans un navigateur du LAN** : `http://<DASH_BIND_ADDR>:<DASH_HOST_PORT>`. En mode `mock` le bandeau « DONNÉES FICTIVES » doit être visible.
Passage au vrai backend : mettre `DASH_API_MODE=live` dans `.env` puis `docker compose --profile dashboard up -d dashboard`.
**Contrôle de vérité avant de s'y fier** : en `live`, la jauge doit apparaître « non calculable » (grisée) et non un chiffre ; si un chiffre s'affiche sans bandeau de données fictives, c'est une erreur d'intégration à me signaler.
(À valider avec la session B : le dashboard consomme `docs/api-contract-backend-proposal.md`, pas encore intégré au moment de l'écriture.)

### 8.6 Protocole des 72 heures (critère de sortie du lot 1, à conduire à la main)

Aucun cron, aucune automatisation autre que la boucle du worker. Relevés à faire à **T0, T+24 h, T+48 h, T+72 h** (copier la sortie dans un fichier daté, par exemple `~/veille-72h/T24.txt`) :

```bash
docker compose exec worker python -m app.cli health
docker compose exec worker python -m app.cli verify-provenance                      # attendu : "bad": 0
docker compose exec db psql -U veille -d veille -c "select source_id, outcome, count(*), max(started_at) from fetch_runs group by 1,2 order by 1,2;"
docker compose exec db psql -U veille -d veille -c "select count(*), count(distinct (source_id, external_id)) from documents;"   # deux nombres égaux
docker compose exec db psql -U veille -d veille -c "select event_type, status, count(*) from events group by 1,2 order by 1,2;"
docker stats --no-stream; df -h "$DATA_DIR"; docker compose ps
./scripts/backup-db.sh      # sauvegarde MANUELLE à T0 et à T+72 h seulement ; vérifier ensuite la taille avec ls -lh
```
Épreuves à faire pendant les 72 h (une fois chacune, noter l'heure) :
1. **Redémarrage du worker** : `docker compose restart worker` → pas de doublon (même requête documents ci-dessus).
2. **Coupure** : `docker compose stop worker`, 10 min, `start` → reprise sans doublon, les sources reprennent leur cadence.
3. **Redémarrage complet** : `docker compose --profile dashboard down` puis `up -d` → les données sont toujours là (le dossier `postgres/` persiste).
4. **Purge à blanc** : `docker compose exec worker python -m app.cli purge-history --dry-run` → ne supprime rien.

**Critères de réussite à 72 h** : chaque source active a un `last_success_at` de moins de deux fois son intervalle ; aucune ne reste `failing` sans explication notée ; `verify-provenance` = 0 problème ; aucun doublon ;
mémoire des conteneurs stable (pas de croissance continue d'un relevé à l'autre) ; espace disque suffisant ; l'API répond à chaque relevé.
**Échec** : une source qui change de forme (`schema_unexpected`), une dérive mémoire, un disque qui se remplit, ou un doublon. Dans ce cas, garder les sorties et me les transmettre ; ne pas « réparer » à la main la base.
Ce protocole ne valide **pas** la jauge (8 semaines de baseline) ni la qualité des événements (aucune revue humaine faite).

### 8.7 Retour arrière complet

```bash
docker compose --profile dashboard down            # arrête sans supprimer les données
git checkout backend                               # revient à la branche backend seule (la branche deploiement reste utilisable)
```
Les données restent dans `$DATA_DIR/postgres` ; pour repartir de zéro, il faut supprimer ce dossier **volontairement** (après `./scripts/backup-db.sh`).
