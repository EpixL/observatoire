"""Lot 1 — collecte : sources, documents versionnés, santé des connecteurs.

Toutes les dates sont en UTC (timestamptz). `first_seen_at` est immuable (trigger en base).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

TS = DateTime(timezone=True)


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    organisation: Mapped[str] = mapped_column(String(200))
    source_type: Mapped[str] = mapped_column(String(20))  # mesure | operateur | autorite | media
    origin_family: Mapped[str] = mapped_column(String(64))  # famille d'origine (indépendance)
    zone: Mapped[str] = mapped_column(String(64))
    competence: Mapped[str] = mapped_column(Text, default="")
    languages: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=list)
    access_mode: Mapped[str] = mapped_column(String(20))  # feed | html_page | json_api
    connector: Mapped[str] = mapped_column(String(32))
    canonical_url: Mapped[str] = mapped_column(Text)
    endpoint_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_domains: Mapped[list[str]] = mapped_column(ARRAY(String(255)), default=list)
    poll_interval_s: Mapped[int] = mapped_column(Integer)
    licence: Mapped[str] = mapped_column(Text, default="")
    quota_note: Mapped[str] = mapped_column(Text, default="")
    retention_days: Mapped[int] = mapped_column(Integer, default=90)
    auth_required: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_status: Mapped[str] = mapped_column(String(32), default="unverified")
    priority: Mapped[str] = mapped_column(String(16), default="V1")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    health: Mapped["ConnectorHealth | None"] = relationship(back_populates="source", uselist=False)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id"),
        Index("ix_documents_canonical_url", "canonical_url"),
        Index("ix_documents_first_seen_at", "first_seen_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"))
    external_id: Mapped[str] = mapped_column(Text)
    canonical_url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, default="")
    first_seen_at: Mapped[datetime] = mapped_column(TS)  # immuable
    last_seen_at: Mapped[datetime] = mapped_column(TS)
    published_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    published_at_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_flags: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list)
    version_count: Mapped[int] = mapped_column(Integer, default=0)
    current_version_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    versions: Mapped[list["DocumentVersion"]] = relationship(back_populates="document", order_by="DocumentVersion.version_no")


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version_no"),
        Index("ix_document_versions_content_hash", "content_hash"),
        Index("ix_document_versions_retrieved_at", "retrieved_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"))
    version_no: Mapped[int] = mapped_column(Integer)
    change_kind: Mapped[str] = mapped_column(String(16))  # initial | material | cosmetic
    retrieved_at: Mapped[datetime] = mapped_column(TS)
    available_at: Mapped[datetime] = mapped_column(TS)  # 1re disponibilité prouvable (= notre acquisition)
    published_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    final_url: Mapped[str] = mapped_column(Text)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    etag: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_modified: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, default="")
    text: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    substantive_hash: Mapped[str] = mapped_column(String(64))
    raw_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    snapshot_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    structured: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    document: Mapped[Document] = relationship(back_populates="versions")


class FetchRun(Base):
    """Journal de chaque tentative de collecte (base du critère « 72 h de fonctionnement »)."""

    __tablename__ = "fetch_runs"
    __table_args__ = (Index("ix_fetch_runs_source_started", "source_id", "started_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"))
    started_at: Mapped[datetime] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    outcome: Mapped[str] = mapped_column(String(24))  # ok | not_modified | error | rate_limited | blocked | domain_rejected
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    items_seen: Mapped[int] = mapped_column(Integer, default=0)
    new_documents: Mapped[int] = mapped_column(Integer, default=0)
    new_versions: Mapped[int] = mapped_column(Integer, default=0)
    cosmetic_versions: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ConnectorHealth(Base):
    __tablename__ = "connector_health"

    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"), primary_key=True)
    # unknown | ok | degraded | failing | rate_limited | blocked
    state: Mapped[str] = mapped_column(String(16), default="unknown")
    last_attempt_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    last_new_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)  # dernière nouveauté
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    etag: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_modified: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    backoff_until: Mapped[datetime | None] = mapped_column(TS, nullable=True)

    source: Mapped[Source] = relationship(back_populates="health")


class Observation(Base):
    """Mesures numériques datées (ex. signaux IODA). Jamais de valeur fabriquée pour combler un trou."""

    __tablename__ = "observations"
    __table_args__ = (
        UniqueConstraint("source_id", "entity_type", "entity_code", "metric", "observed_at"),
        Index("ix_observations_lookup", "source_id", "entity_code", "metric", "observed_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_code: Mapped[str] = mapped_column(String(64))
    metric: Mapped[str] = mapped_column(String(64))
    observed_at: Mapped[datetime] = mapped_column(TS)
    retrieved_at: Mapped[datetime] = mapped_column(TS)
    value: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
