# syntax=docker/dockerfile:1
# Multi-étapes, images multi-architectures (amd64 + arm64 : Raspberry Pi 5).
#   ./scripts/docker-build.sh                      # construit pour arm64 + amd64
#   docker run --rm -e PORT=8101 -e API_MODE=live -e API_UPSTREAM=host.docker.internal:8100 -p 8101:8101 veille-dashboard
# Rien n'est figé : PORT, API_MODE (mock|live), API_UPSTREAM (hôte:port du backend) viennent de l'environnement.

FROM node:22.22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine
# Valeurs par défaut NEUTRES (toujours remplacées au lancement) : le port n'est choisi que par la variable PORT.
ENV PORT=8080 \
    API_MODE=mock \
    API_UPSTREAM= \
    DNS_RESOLVER=127.0.0.11 \
    NGINX_ENVSUBST_FILTER='^(PORT|API_MODE|API_UPSTREAM|DNS_RESOLVER)$'
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
