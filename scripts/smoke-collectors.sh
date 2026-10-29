#!/usr/bin/env bash
# Test de fumée des VRAIS flux — à lancer sur le Raspberry Pi (le cloud de développement bloque ces domaines).
#
#   ./scripts/smoke-collectors.sh              # sources activées
#   ./scripts/smoke-collectors.sh --all        # + sources désactivées qui ont une URL
#   ./scripts/smoke-collectors.sh --source ioda-fr
#
# Une requête polie par source (User-Agent identifié, robots.txt respecté, 2 s entre requêtes sur un même hôte).
# N'écrit RIEN en base. Produit smoke-out/smoke-report.json et smoke-out/raw/ (réponses brutes réelles).
# Relire smoke-out/raw/ avant de les partager ou de les commiter (aucun secret attendu : flux publics).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/smoke-out"; mkdir -p "$OUT/raw"

echo "== Contrôles préalables =="
echo "Heure UTC du Pi : $(date -u +%FT%TZ)"
(timedatectl show -p NTPSynchronized 2>/dev/null || echo "NTPSynchronized: inconnu") | sed 's/^/  /'
getent hosts www.diplomatie.gouv.fr >/dev/null && echo "  DNS : OK" || echo "  DNS : ÉCHEC (résolution de www.diplomatie.gouv.fr)"

: "${COLLECTOR_CONTACT:=$( [ -f .env ] && grep -E '^COLLECTOR_CONTACT=' .env | cut -d= -f2- || true )}"
export COLLECTOR_CONTACT="${COLLECTOR_CONTACT:-smoke-test}"

status=0
if [ "${SMOKE_LOCAL:-0}" = "1" ]; then
  # Variante sans Docker : venv Python déjà installé (pip install -r backend/requirements.txt)
  ( cd backend && CONFIG_DIR=../config python -m app.cli smoke --report "$OUT/smoke-report.json" --save-fixtures "$OUT/raw" "$@" ) || status=$?
else
  docker compose build --quiet worker >/dev/null 2>&1 || docker build -q -t veille-backend:local -f backend/Dockerfile . >/dev/null
  docker run --rm --user "$(id -u):$(id -g)" -e COLLECTOR_CONTACT -v "$OUT:/out" \
    --entrypoint python veille-backend:local -m app.cli smoke --report /out/smoke-report.json --save-fixtures /out/raw "$@" || status=$?
fi
echo
echo "Rapport : $OUT/smoke-report.json"
echo "Colonne VERDICT : OK = endpoint joignable et compris ; BLOCKED = refus (403/429/robots) ; FAIL = erreur ou format inattendu."
exit $status
