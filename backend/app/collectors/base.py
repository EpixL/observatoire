from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from app.collectors.http import PoliteClient
from app.models import Source


@dataclass
class FetchedItem:
    """Document normalisé produit par un connecteur (avant stockage)."""

    external_id: str
    url: str
    title: str
    text: str
    published_raw: str | None = None
    structured: dict[str, Any] = field(default_factory=dict)


@dataclass
class ObservationIn:
    entity_type: str
    entity_code: str
    metric: str
    observed_at: datetime
    value: float | None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class FetchResult:
    # ok | not_modified | error | rate_limited | blocked | domain_rejected
    outcome: str
    http_status: int | None = None
    final_url: str | None = None
    items: list[FetchedItem] = field(default_factory=list)
    observations: list[ObservationIn] = field(default_factory=list)
    etag: str | None = None
    last_modified: str | None = None
    raw_body: bytes | None = None
    error: str | None = None
    retry_after_s: int | None = None
    # plancher de backoff propre à l'erreur (404 -> 6 h, etc.)
    min_backoff_s: int = 0


@dataclass
class ConditionalState:
    etag: str | None
    last_modified: str | None


class Connector(Protocol):
    def fetch(self, source: Source, state: ConditionalState, http: PoliteClient) -> FetchResult: ...


def outcome_from_http(status: int | None, kind: str) -> tuple[str, int]:
    """Traduit un échec HTTP en (outcome, plancher de backoff en secondes)."""
    if kind == "domain_rejected":
        return "domain_rejected", 6 * 3600
    if kind == "robots_blocked":
        return "blocked", 6 * 3600
    if status == 429:
        return "rate_limited", 0
    if status == 503:
        return "rate_limited", 0  # le plus souvent un quota/surcharge ; Retry-After respecté
    if status in (401, 403):
        return "blocked", 6 * 3600
    if status in (404, 410):
        return "error", 6 * 3600
    return "error", 0
