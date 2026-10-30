"""Exécution des collectes : état de santé, backoff exponentiel, temporisation aléatoire, boucle worker."""
from __future__ import annotations

import logging
import os
import random
import re
import signal
import time
from datetime import datetime, timedelta
from typing import Callable

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.collectors import CONNECTORS
from app.collectors.base import ConditionalState, FetchResult
from app.collectors.http import PoliteClient
from app.collectors.store import IngestCounts, ingest
from app.config import Settings
from app.db import session_scope
from app.models import ConnectorHealth, FetchRun, Source
from app.normalization.dates import utcnow

log = logging.getLogger("observatoire.runner")
_SECRET_RE = re.compile(r"((?:key|token|secret|password|apikey|api_key)=)[^&\s]+", re.I)
WORKER_LOCK_ID = 727_001


def sanitize_error(msg: str | None) -> str | None:
    if msg is None:
        return None
    return _SECRET_RE.sub(r"\1***", msg)[:300]


def next_delay_s(source: Source, result: FetchResult, failures: int, settings: Settings, rng: random.Random) -> float:
    """Délai avant la prochaine collecte. Succès : intervalle ± jitter. Échec : backoff exponentiel
    (jamais sous l'intervalle, Retry-After et plancher d'erreur respectés), jitter uniquement vers le haut."""
    interval = float(source.poll_interval_s)
    j = settings.jitter_fraction
    if result.outcome in ("ok", "not_modified"):
        return interval * (1 + rng.uniform(-j, j))
    backoff = min(settings.backoff_base_s * 2 ** max(failures - 1, 0), settings.backoff_max_s)
    delay = max(interval, backoff, float(result.min_backoff_s), float(result.retry_after_s or 0))
    return delay * (1 + rng.uniform(0, j))


def state_for(outcome: str, failures: int) -> str:
    if outcome in ("ok", "not_modified"):
        return "ok"
    if outcome == "rate_limited":
        return "rate_limited"
    if outcome in ("blocked", "domain_rejected"):
        return "blocked"
    return "degraded" if failures < 2 else "failing"  # « visible après deux cycles échoués » (plan §12)


def apply_result(
    session: Session, source: Source, health: ConnectorHealth, result: FetchResult,
    counts: IngestCounts, started: datetime, finished: datetime, settings: Settings, rng: random.Random,
) -> None:
    failed = result.outcome not in ("ok", "not_modified")
    health.last_attempt_at = finished
    health.last_http_status = result.http_status
    health.consecutive_failures = health.consecutive_failures + 1 if failed else 0
    health.state = state_for(result.outcome, health.consecutive_failures)
    health.last_error = sanitize_error(result.error) if failed else None
    if not failed:
        health.last_success_at = finished
        health.etag = result.etag if result.etag is not None else health.etag
        health.last_modified = result.last_modified if result.last_modified is not None else health.last_modified
    if counts.new_documents or counts.new_versions:
        health.last_new_at = finished
    delay = next_delay_s(source, result, health.consecutive_failures, settings, rng)
    health.next_run_at = finished + timedelta(seconds=delay)
    health.backoff_until = health.next_run_at if failed else None
    session.add(FetchRun(
        source_id=source.id, started_at=started, finished_at=finished, outcome=result.outcome,
        http_status=result.http_status, items_seen=counts.items_seen, new_documents=counts.new_documents,
        new_versions=counts.new_versions, cosmetic_versions=counts.cosmetic_versions,
        error=sanitize_error(result.error), duration_ms=int((finished - started).total_seconds() * 1000),
    ))


def run_source(
    factory: sessionmaker[Session], source_id: str, http: PoliteClient, settings: Settings,
    *, rng: random.Random | None = None, clock: Callable[[], datetime] = utcnow,
) -> FetchResult:
    rng = rng or random.Random()
    with session_scope(factory) as s:
        source = s.get(Source, source_id)
        health = s.get(ConnectorHealth, source_id)
        state = ConditionalState(health.etag, health.last_modified)
        s.expunge_all()
    started = clock()
    try:
        result = CONNECTORS[source.connector]().fetch(source, state, http)
    except Exception as exc:  # un connecteur défaillant ne doit jamais arrêter les autres
        log.exception("connecteur %s : exception non gérée", source_id)
        result = FetchResult(outcome="error", error=f"internal: {type(exc).__name__}: {exc}", min_backoff_s=900)
    with session_scope(factory) as s:
        source = s.get(Source, source_id)
        health = s.get(ConnectorHealth, source_id)
        now = clock()
        counts = IngestCounts()
        if result.items or result.observations:
            counts = ingest(s, source, result, now, settings.snapshot_dir)
        apply_result(s, source, health, result, counts, started, now, settings, rng)
    log.info("collecte %s : %s (nouveaux docs=%d, versions=%d)", source_id, result.outcome, counts.new_documents, counts.new_versions)
    return result


def due_source_ids(factory: sessionmaker[Session], now: datetime) -> list[str]:
    with session_scope(factory) as s:
        rows = s.execute(
            select(Source.id).join(ConnectorHealth, ConnectorHealth.source_id == Source.id)
            .where(Source.enabled.is_(True), or_(ConnectorHealth.next_run_at.is_(None), ConnectorHealth.next_run_at <= now))
            .order_by(ConnectorHealth.next_run_at.asc().nullsfirst(), Source.id)
        ).all()
    return [r[0] for r in rows]


def run_due(factory: sessionmaker[Session], http: PoliteClient, settings: Settings, **kw) -> dict[str, str]:
    clock = kw.get("clock", utcnow)
    return {sid: run_source(factory, sid, http, settings, **kw).outcome for sid in due_source_ids(factory, clock())}


def purge_all(factory: sessionmaker[Session], settings: Settings) -> int:
    from app.collectors.store import purge_snapshots
    now = utcnow()
    with session_scope(factory) as s:
        rows = s.execute(select(Source.id, Source.retention_days)).all()
    removed = sum(purge_snapshots(settings.snapshot_dir, sid, days, now) for sid, days in rows)
    if removed:
        log.info("purge : %d snapshots supprimés (le texte normalisé reste en base)", removed)
    return removed


def serve(factory: sessionmaker[Session], settings: Settings, *, tick_s: float = 15.0) -> None:
    """Boucle du worker. Un seul worker actif grâce à un verrou consultatif PostgreSQL."""
    stop = {"flag": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))
    signal.signal(signal.SIGINT, lambda *_: stop.update(flag=True))
    http = PoliteClient(user_agent=settings.user_agent, timeout_s=settings.http_timeout_s,
                        max_body_bytes=settings.max_body_bytes, respect_robots=settings.respect_robots)
    lock_conn = factory.kw["bind"].connect()
    try:
        if not lock_conn.execute(text("select pg_try_advisory_lock(:i)"), {"i": WORKER_LOCK_ID}).scalar():
            raise SystemExit("un autre worker de collecte est déjà actif")
        log.info("worker démarré")
        from app.events.gazetteer import load_gazetteer
        from app.events.pipeline import process_pending
        gaz = load_gazetteer(str(settings.config_dir / "zones.yaml"))
        from app.gauge.config import load_gauge_config
        from app.gauge.snapshots import evaluate_all
        gauge_cfg = load_gauge_config(str(settings.config_dir))
        gauge_every = float(os.environ.get("GAUGE_EVAL_INTERVAL_S", "300"))
        last_gauge = -1e9
        last_purge = 0.0
        while not stop["flag"]:
            outcomes = run_due(factory, http, settings)
            try:  # le traitement des événements ne doit jamais empêcher la collecte de continuer
                with session_scope(factory) as s:
                    done = process_pending(s, gaz=gaz)
                if done["processed"] or done["errors"]:
                    log.info("événements : %s", done)
            except Exception:
                log.exception("échec du traitement des événements (la collecte continue)")
            if time.monotonic() - last_gauge >= gauge_every:   # réévaluation de la jauge (un instantané daté par territoire)
                last_gauge = time.monotonic()
                try:
                    with session_scope(factory) as s:
                        snaps = evaluate_all(s, gauge_cfg, utcnow())
                        log.info("jauge : %s", {x.territory: (x.palier if x.status == "calculable" else "non calculable") for x in snaps})
                except Exception:
                    log.exception("échec de l'évaluation de la jauge (la collecte continue)")
            if time.monotonic() - last_purge > 86_400:  # purge quotidienne des snapshots bruts au-delà de la rétention
                last_purge = time.monotonic()
                try:
                    purge_all(factory, settings)
                except Exception:
                    log.exception("échec de la purge des snapshots")
            time.sleep(tick_s)
    finally:
        lock_conn.close()
        http.close()
        log.info("worker arrêté")
