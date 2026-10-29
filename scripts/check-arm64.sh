#!/usr/bin/env bash
# Vérifie qu'une image Docker Hub existe en arm64/linux et affiche le digest
# de l'index multi-architecture (à utiliser pour verrouiller l'image).
# Usage : scripts/check-arm64.sh postgres:16.11-alpine3.22 [python:3.13.9-slim-bookworm ...]
set -euo pipefail
for ref in "$@"; do
  name="${ref%%:*}"; tag="${ref#*:}"
  [[ "$name" == */* ]] || name="library/$name"
  token=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${name}:pull" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
  hdr=$(mktemp); body=$(mktemp)
  curl -fsS -D "$hdr" -o "$body" -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://registry-1.docker.io/v2/${name}/manifests/${tag}"
  digest=$(grep -i '^docker-content-digest:' "$hdr" | awk '{print $2}' | tr -d '\r')
  if python3 - "$body" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
ok=any(m.get("platform",{}).get("architecture")=="arm64" and m["platform"].get("os")=="linux" for m in d.get("manifests",[]))
sys.exit(0 if ok else 1)
PY
  then echo "OK arm64  $ref  @ $digest"; else echo "ABSENT arm64  $ref"; fi
  rm -f "$hdr" "$body"
done
