# syntax=docker/dockerfile:1
# Multi-étapes, images multi-architectures (amd64 + arm64 : Raspberry Pi 5).
#   docker build -t veille-dashboard ./frontend
#   docker run --rm -e PORT=8080 -p 8080:8080 veille-dashboard
# Le port d'écoute vient de la variable d'environnement PORT (aucun port figé dans l'image).

FROM node:22.22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine
ENV PORT=8080
# Le modèle est complété au démarrage par l'image (envsubst) : ${PORT} devient la valeur de la variable.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
