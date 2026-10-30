#!/usr/bin/env bash
# Construit l'image du dashboard pour arm64 (Raspberry Pi 5) et amd64.
#   ./scripts/docker-build.sh            -> charge l'image de l'architecture locale (tag veille-dashboard:local)
#   PLATFORMS=linux/arm64,linux/amd64 PUSH=1 IMAGE=registre/veille-dashboard:0.2 ./scripts/docker-build.sh
# Non exécuté dans l'environnement de développement cloud (pas de démon Docker) : à lancer sur le Pi ou une machine avec buildx.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${IMAGE:-veille-dashboard:local}"
PLATFORMS="${PLATFORMS:-}"
if [ -n "$PLATFORMS" ]; then
  docker buildx build --platform "$PLATFORMS" -t "$IMAGE" $([ "${PUSH:-0}" = 1 ] && echo --push || echo --output=type=image,push=false) .
else
  docker build -t "$IMAGE" .
fi
