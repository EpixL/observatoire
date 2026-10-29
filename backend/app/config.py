"""Configuration lue dans l'environnement (voir .env.example). Aucun secret par défaut."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"Variable d'environnement obligatoire absente : {name}")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    config_dir: Path
    snapshot_dir: Path
    user_agent: str
    # Temporisation aléatoire ajoutée à chaque intervalle de collecte (± fraction).
    jitter_fraction: float = 0.2
    http_timeout_s: float = 20.0
    max_body_bytes: int = 5_000_000
    backoff_base_s: int = 60
    backoff_max_s: int = 3600
    respect_robots: bool = True
    extra: dict[str, str] = field(default_factory=dict)


def load_settings() -> Settings:
    contact = os.environ.get("COLLECTOR_CONTACT", "contact-non-renseigne")
    return Settings(
        database_url=_env("DATABASE_URL"),
        config_dir=Path(_env("CONFIG_DIR", "/app/config")),
        snapshot_dir=Path(_env("SNAPSHOT_DIR", "/data/snapshots")),
        user_agent=f"VEILLE-observatoire/0.1 (veille privee; {contact})",
        jitter_fraction=float(_env("COLLECTOR_JITTER_FRACTION", "0.2")),
        http_timeout_s=float(_env("COLLECTOR_HTTP_TIMEOUT_S", "20")),
        backoff_base_s=int(_env("COLLECTOR_BACKOFF_BASE_S", "60")),
        backoff_max_s=int(_env("COLLECTOR_BACKOFF_MAX_S", "3600")),
        respect_robots=_env("COLLECTOR_RESPECT_ROBOTS", "true").lower() == "true",
    )
