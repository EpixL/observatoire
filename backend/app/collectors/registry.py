"""Chargement et validation du registre des sources (config/sources.yaml), puis synchronisation en base."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConnectorHealth, Source
from app.normalization.dates import utcnow


class SourceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,62}$")
    name: str
    organisation: str
    source_type: Literal["mesure", "operateur", "autorite", "media"]
    origin_family: str
    zone: str
    competence: str = ""
    languages: list[str] = []
    connector: Literal["feed", "html_page", "ioda", "easa_czib"]
    access_mode: Literal["feed", "html_page", "json_api"]
    canonical_url: str
    endpoint_url: str | None = None
    allowed_domains: list[str]
    poll_interval_s: int = Field(ge=60)
    licence: str = ""
    quota_note: str = ""
    retention_days: int = 90
    auth_required: bool = False
    verification_status: Literal["unverified_blocked", "partially_verified", "verified", "blocked_by_site", "to_discover"] = "unverified_blocked"
    priority: str = "V1"
    enabled: bool = True
    options: dict[str, Any] = {}

    @field_validator("endpoint_url", "canonical_url")
    @classmethod
    def _https(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith("https://"):
            raise ValueError("seul HTTPS est accepté")
        return v

    @field_validator("allowed_domains")
    @classmethod
    def _domains(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("au moins un domaine autorisé (liste blanche, plan §7)")
        return v


def load_source_configs(path: Path) -> list[SourceConfig]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    defaults = raw.get("defaults", {})
    configs: list[SourceConfig] = []
    for entry in raw["sources"]:
        merged = {k: v for k, v in defaults.items() if k in SourceConfig.model_fields}
        merged.update(entry)
        cfg = SourceConfig(**merged)
        cfg.options = {"default_tz": defaults.get("default_tz", "Europe/Paris"), **cfg.options}
        configs.append(cfg)
    ids = [c.id for c in configs]
    if len(ids) != len(set(ids)):
        raise ValueError("identifiants de source en double")
    return configs


def sync_sources(session: Session, configs: list[SourceConfig]) -> dict[str, int]:
    """Upsert des sources ; ne touche jamais à connector_health d'une source existante."""
    created = updated = 0
    for cfg in configs:
        row = session.get(Source, cfg.id)
        data = cfg.model_dump()
        if row is None:
            row = Source(**data)
            session.add(row)
            session.add(ConnectorHealth(source_id=cfg.id, state="unknown"))
            created += 1
        else:
            for key, value in data.items():
                setattr(row, key, value)
            row.updated_at = utcnow()
            if session.get(ConnectorHealth, cfg.id) is None:
                session.add(ConnectorHealth(source_id=cfg.id, state="unknown"))
            updated += 1
    session.flush()
    return {"created": created, "updated": updated}


def enabled_sources(session: Session) -> list[Source]:
    return list(session.scalars(select(Source).where(Source.enabled.is_(True)).order_by(Source.id)))
