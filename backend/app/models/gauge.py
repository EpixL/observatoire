"""Lot 3 — seuils versionnés, snapshots de jauge, annotations humaines. Tout est en ajout seul (triggers)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

TS = DateTime(timezone=True)


class IndexPolicyVersion(Base):
    """Une version = l'ENSEMBLE des seuils à une date. Jamais modifiée, jamais supprimée (v1 = valeurs du plan)."""

    __tablename__ = "index_policy_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    version_no: Mapped[int] = mapped_column(Integer, unique=True)
    label: Mapped[str] = mapped_column(String(24), unique=True)   # seuils-v1, seuils-v2…
    kind: Mapped[str] = mapped_column(String(16))                 # plan | modification | retour_plan
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    reason: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(TS)


class ThresholdChange(Base):
    """Une ligne par seuil modifié (date, acteur, ancienne et nouvelle valeur, motif)."""

    __tablename__ = "threshold_changes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    policy_version_id: Mapped[int] = mapped_column(ForeignKey("index_policy_versions.id"), index=True)
    key: Mapped[str] = mapped_column(String(48))
    from_value: Mapped[float] = mapped_column(Numeric)
    to_value: Mapped[float] = mapped_column(Numeric)
    kind: Mapped[str] = mapped_column(String(16))   # modification | retour_plan
    reason: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(64))
    at: Mapped[datetime] = mapped_column(TS)


class IndexSnapshot(Base):
    """Une réévaluation de la jauge : périmètre, preuves, règle, palier, couverture, version des seuils utilisée."""

    __tablename__ = "index_snapshots"
    __table_args__ = (Index("ix_index_snapshots_territory_time", "territory", "computed_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    territory: Mapped[str] = mapped_column(String(32))
    computed_at: Mapped[datetime] = mapped_column(TS)
    policy_version_id: Mapped[int] = mapped_column(ForeignKey("index_policy_versions.id"))
    status: Mapped[str] = mapped_column(String(16))              # calculable | non_calculable
    palier: Mapped[int | None] = mapped_column(Integer, nullable=True)       # publié (après hystérésis) ; NULL = non calculable
    raw_palier: Mapped[int | None] = mapped_column(Integer, nullable=True)   # palier des critères à cet instant (avant hystérésis)
    rule_id: Mapped[str] = mapped_column(String(64))
    partial_coverage: Mapped[bool] = mapped_column(Boolean, default=False)
    coverage_satisfied: Mapped[bool] = mapped_column(Boolean)
    last_known_palier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_known_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB)       # critères, preuves, couverture, hystérésis, dossiers


class ManualAnnotation(Base):
    """Qualification humaine d'un événement. C'est la SEULE voie pour dépasser le palier 25 à partir de prose (plan §6.3)."""

    __tablename__ = "manual_annotations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    qualification: Mapped[str] = mapped_column(String(32))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB)
    note: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(TS)
