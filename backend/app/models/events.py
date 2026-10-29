"""Lot 2 — affirmations, événements, provenance, origines communes, revues humaines."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

TS = DateTime(timezone=True)


class OriginGroup(Base):
    """Groupe de documents issus d'une même origine (reprise de dépêche, copie, même URL).
    Compter les groupes, pas les documents, pour mesurer l'indépendance (plan §7)."""

    __tablename__ = "origin_groups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    method: Mapped[str] = mapped_column(String(24))  # seed | url | exact_hash | near_duplicate | wire_cue
    wire_agency: Mapped[str | None] = mapped_column(String(32), nullable=True)
    representative_document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class DocumentOrigin(Base):
    __tablename__ = "document_origins"

    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("origin_groups.id"), index=True)
    method: Mapped[str] = mapped_column(String(24))
    similarity: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)


class Claim(Base):
    __tablename__ = "claims"
    __table_args__ = (
        UniqueConstraint("document_id", "claim_key"),
        Index("ix_claims_category_zone", "category"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    first_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id"))
    claim_key: Mapped[str] = mapped_column(String(64))  # empreinte stable : une affirmation reformulée à l'identique n'est pas recomptée
    claim_type: Mapped[str] = mapped_column(String(16))  # observation | declaration | inference
    category: Mapped[str] = mapped_column(String(48))
    statement: Mapped[str] = mapped_column(Text)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    action: Mapped[str | None] = mapped_column(Text, nullable=True)
    place_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    zone_codes: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=list)
    occurred_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    occurred_precision: Mapped[str] = mapped_column(String(12), default="unknown")  # instant|day|month|year|unknown
    period_start: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    negated: Mapped[bool] = mapped_column(Boolean, default=False)
    conditional: Mapped[bool] = mapped_column(Boolean, default=False)
    quoted_speaker: Mapped[str | None] = mapped_column(Text, nullable=True)
    declarant: Mapped[str | None] = mapped_column(Text, nullable=True)
    declarant_kind: Mapped[str] = mapped_column(String(12))  # official | measure | media
    official_scope: Mapped[str] = mapped_column(String(16), default="none")  # own_decision | own_measure | attribution | none
    certainty: Mapped[str] = mapped_column(String(12))  # structured | provisional
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_reasons: Mapped[list[str]] = mapped_column(ARRAY(String(48)), default=list)
    confirmation: Mapped[str] = mapped_column(String(12), default="none")  # none | official  (par affirmation)
    stale: Mapped[bool] = mapped_column(Boolean, default=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    extractor: Mapped[str] = mapped_column(String(48))
    rule_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(TS)


class EvidenceLink(Base):
    """Provenance : citation exacte + position dans le texte conservé d'une version précise."""

    __tablename__ = "evidence_links"
    __table_args__ = (UniqueConstraint("claim_id", "document_version_id", "relation", "char_start"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claims.id"), index=True)
    document_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id"), index=True)
    quote: Mapped[str] = mapped_column(Text)
    char_start: Mapped[int] = mapped_column(Integer)
    char_end: Mapped[int] = mapped_column(Integer)
    relation: Mapped[str] = mapped_column(String(24))  # supports | denies | official_confirms | mentions
    created_at: Mapped[datetime] = mapped_column(TS)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (Index("ix_events_type_zone", "event_type", "zone_code"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_type: Mapped[str] = mapped_column(String(32))
    zone_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12))  # active | to_verify | resolved | historical
    exclusion_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)  # republication | ...
    novelty: Mapped[str] = mapped_column(String(16), default="new")  # new | republication
    # temps de référence du rapprochement : occurred_at, sinon publication, sinon 1re observation
    ref_at: Mapped[datetime] = mapped_column(TS)
    occurred_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    occurred_precision: Mapped[str] = mapped_column(String(12), default="unknown")
    period_start: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(TS)
    last_update_at: Mapped[datetime] = mapped_column(TS)
    origin_count: Mapped[int] = mapped_column(Integer, default=0)   # groupes d'origine distincts
    document_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(TS)


class EventClaim(Base):
    __tablename__ = "event_claims"

    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claims.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))  # primary | corroboration | contradiction | attribution


class EventLink(Base):
    """Liens PROPOSÉS entre événements (cause commune possible, doublon possible). Jamais une preuve."""

    __tablename__ = "event_links"
    __table_args__ = (UniqueConstraint("event_a_id", "event_b_id", "link_type"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_a_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    event_b_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    link_type: Mapped[str] = mapped_column(String(24))  # possible_common_cause | possible_duplicate
    status: Mapped[str] = mapped_column(String(12), default="proposed")
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS)


class Review(Base):
    """File de revue humaine : documents à qualifier, qualifications provisoires, soupçons d'injection."""

    __tablename__ = "reviews"
    __table_args__ = (Index("ix_reviews_status", "status"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    claim_id: Mapped[int | None] = mapped_column(ForeignKey("claims.id"), nullable=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), default="open")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS)
    resolved_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class VersionProcessing(Base):
    __tablename__ = "version_processing"

    version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id"), primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(12))  # ok | skipped | error
    flags: Mapped[list[str]] = mapped_column(ARRAY(String(48)), default=list)
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
