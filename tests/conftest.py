"""Fixtures communes. Nécessite un vrai PostgreSQL (TEST_DATABASE_URL) : on teste aussi les migrations.

    eval "$(scripts/dev-postgres.sh start)" && pytest
"""
from __future__ import annotations

import os
import random
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.collectors.http import PoliteClient
from app.collectors.registry import load_source_configs, sync_sources
from app.config import Settings
from app.db import make_engine, make_session_factory, session_scope

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


def fixture_bytes(rel: str) -> bytes:
    return (FIXTURES / rel).read_bytes()


@pytest.fixture(scope="session")
def db_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL absent : lancer scripts/dev-postgres.sh start")
    return url


@pytest.fixture(scope="session")
def engine(db_url):
    eng = make_engine(db_url)
    with eng.begin() as c:
        c.execute(text("drop schema public cascade; create schema public"))
    os.environ["MIGRATION_DATABASE_URL"] = db_url
    cfg = Config(str(ROOT / "backend" / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "backend" / "migrations"))
    command.upgrade(cfg, "head")
    yield eng
    eng.dispose()


@pytest.fixture()
def factory(engine):
    """Session factory ; toutes les tables sont vidées avant chaque test."""
    with engine.begin() as c:
        tables = [r[0] for r in c.execute(text(
            "select tablename from pg_tables where schemaname='public' and tablename <> 'alembic_version'"))]
        if tables:
            c.execute(text("truncate " + ", ".join(f'"{t}"' for t in tables) + " restart identity cascade"))
    return make_session_factory(engine)


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        database_url="unused", config_dir=ROOT / "config", snapshot_dir=tmp_path / "snapshots",
        user_agent="VEILLE-test/0.0", jitter_fraction=0.2, backoff_base_s=60, backoff_max_s=3600,
    )


@pytest.fixture()
def sources(factory):
    """Charge config/sources.yaml en base (health 'unknown')."""
    with session_scope(factory) as s:
        sync_sources(s, load_source_configs(ROOT / "config" / "sources.yaml"))
    return factory


class FakeClock:
    def __init__(self, start: datetime):
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kw):
        from datetime import timedelta
        self.now += timedelta(**kw)


@pytest.fixture()
def clock() -> FakeClock:
    return FakeClock(datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc))


@pytest.fixture()
def rng() -> random.Random:
    return random.Random(1234)


def make_client(handler, *, respect_robots=False) -> PoliteClient:
    """Client HTTP branché sur un faux serveur (httpx.MockTransport) : aucun accès réseau."""
    return PoliteClient(
        user_agent="VEILLE-test/0.0", transport=httpx.MockTransport(handler), respect_robots=respect_robots,
        min_host_gap_s=0, sleep=lambda s: None,
    )


@pytest.fixture()
def client_factory():
    return make_client
