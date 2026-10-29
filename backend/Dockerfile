# Image unique pour api / worker / migrations. Base multi-architecture (amd64 + arm64 vérifiée par
# scripts/check-arm64.sh). Digest de l'index verrouillé ; toutes les dépendances Python sont épinglées
# (backend/requirements.txt, wheels aarch64 disponibles : lxml, psycopg-binary, pydantic-core, PyYAML, MarkupSafe).
FROM python:3.13-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt
COPY backend/ /app/
COPY config/ /app/config/
RUN useradd --system --uid 10001 --home-dir /nonexistent veille && mkdir -p /data/snapshots && chown veille /data/snapshots
USER veille
ENV CONFIG_DIR=/app/config SNAPSHOT_DIR=/data/snapshots
ENTRYPOINT ["python", "-m", "app.cli"]
CMD ["worker"]
