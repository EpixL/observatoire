from __future__ import annotations

import hmac
import os
from functools import lru_cache

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.db import make_engine, make_session_factory
from app.gauge.config import GaugeConfig, load_gauge_config
from app.gauge.policy import PolicyError

_factory = None


def get_session():
    global _factory
    if _factory is None:
        _factory = make_session_factory(make_engine(os.environ["DATABASE_URL"]))
    s = _factory()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


@lru_cache(maxsize=1)
def _cfg(path: str) -> GaugeConfig:
    return load_gauge_config(path)


def get_cfg() -> GaugeConfig:
    return _cfg(os.environ.get("CONFIG_DIR", "/app/config"))


def require_admin(authorization: str | None = Header(default=None)) -> str:
    """Écritures protégées par un jeton (ADMIN_TOKEN, dans .env). Sans jeton configuré, les écritures sont DÉSACTIVÉES (sûr par défaut).
    Retourne le nom de l'acteur journalisé (ADMIN_ACTOR)."""
    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        raise PolicyError(503, "writes_disabled", "écritures désactivées : ADMIN_TOKEN n'est pas configuré côté serveur")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not given or not hmac.compare_digest(given.encode(), token.encode()):
        raise PolicyError(401, "unauthorized", "jeton d'administration absent ou invalide")
    return os.environ.get("ADMIN_ACTOR", "admin")
