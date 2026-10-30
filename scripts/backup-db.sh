#!/usr/bin/env bash
# Sauvegarde logique de la base (pg_dump), à lancer à la main tant que la baseline n'est pas validée (pas de cron fourni).
#   ./scripts/backup-db.sh              # écrit $BACKUP_DIR/observatoire-AAAA-MM-JJ.dump, vérifie, garde 7 jours
#   BACKUP_DIR=/autre/dossier KEEP_DAYS=14 ./scripts/backup-db.sh
# Décision de David (29/10/2026) : dossier /mnt/homelab/@backups/observatoire/, 7 jours de rétention.
# Un instantané Btrfs du dossier postgres/ n'est PAS une sauvegarde fiable (voir docs/runbook.md) : c'est pg_dump qui fait foi.
# Planification (plus tard, après validation manuelle) : voir docs/runbook.md §5 — le cron n'est pas installé par ce dépôt.
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/mnt/homelab/@backups/observatoire}"
KEEP_DAYS="${KEEP_DAYS:-7}"
[ -f .env ] && { set -a; . ./.env; set +a; }
: "${POSTGRES_USER:?POSTGRES_USER absent (.env)}" "${POSTGRES_DB:?POSTGRES_DB absent (.env)}"

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
stamp="$(date +%F)"
tmp="$BACKUP_DIR/.observatoire-$stamp.dump.tmp"
final="$BACKUP_DIR/observatoire-$stamp.dump"

docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$tmp"
# vérification : l'archive doit être lisible et contenir des tables
if ! docker compose exec -T db pg_restore -l < "$tmp" | grep -q "TABLE DATA"; then
  rm -f "$tmp"; echo "ÉCHEC : l'archive produite est illisible ou vide" >&2; exit 1
fi
chmod 600 "$tmp"; mv "$tmp" "$final"
echo "sauvegarde : $final ($(du -h "$final" | cut -f1))"

# rétention : supprime les sauvegardes plus vieilles que KEEP_DAYS, en gardant toujours la plus récente
find "$BACKUP_DIR" -maxdepth 1 -name 'observatoire-*.dump' -mtime +"$KEEP_DAYS" ! -newer "$final" -print -delete | sed 's/^/supprimée : /'
echo "présentes : $(ls -1 "$BACKUP_DIR"/observatoire-*.dump | wc -l)"
