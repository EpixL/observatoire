"""Dates : tout est stocké en UTC ; une date douteuse est marquée, jamais corrigée en silence.

Drapeaux produits (liste de chaînes, stockée avec le document) :
  missing          aucune date fournie par l'éditeur
  unparseable      date fournie mais illisible (valeur brute conservée)
  no_timezone      pas de fuseau : on applique le fuseau par défaut de la source (hypothèse signalée)
  future           date postérieure à la collecte (au-delà de la tolérance) ; valeur conservée mais à ignorer
  old_publication  date très antérieure à la première observation (republication possible)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

FUTURE_TOLERANCE = timedelta(minutes=10)
OLD_PUBLICATION_AFTER = timedelta(days=7)

_ISO_TZ = re.compile(r"(Z|[+-]\d{2}:?\d{2})$")


@dataclass
class ParsedDate:
    value: datetime | None  # toujours en UTC et "aware", ou None
    raw: str | None
    flags: list[str] = field(default_factory=list)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise ValueError("datetime sans fuseau : utiliser parse_publication_date")
    return dt.astimezone(timezone.utc)


def parse_publication_date(
    raw: str | None,
    *,
    default_tz: str = "Europe/Paris",
    reference: datetime | None = None,
) -> ParsedDate:
    """Interprète une date d'éditeur. `reference` = instant de la collecte (pour détecter le futur)."""
    reference = reference or utcnow()
    if raw is None or not str(raw).strip():
        return ParsedDate(None, None, ["missing"])
    text = str(raw).strip()
    flags: list[str] = []
    parsed: datetime | None = None
    try:
        if re.match(r"^\d{4}-\d{2}-\d{2}", text):
            iso = text.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(iso)
            if not _ISO_TZ.search(text):
                flags.append("no_timezone")
        else:
            parsed = parsedate_to_datetime(text)
            # RFC 822 : "-0000" ou absence de fuseau => parsedate_to_datetime rend un naïf
            if parsed.tzinfo is None:
                flags.append("no_timezone")
    except (ValueError, TypeError, IndexError):
        return ParsedDate(None, text, ["unparseable"])

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(default_tz))
    value = parsed.astimezone(timezone.utc)
    if value > reference + FUTURE_TOLERANCE:
        flags.append("future")
    elif reference - value > OLD_PUBLICATION_AFTER:
        flags.append("old_publication")
    return ParsedDate(value, text, flags)


def paris(dt: datetime) -> datetime:
    """Pour l'affichage uniquement."""
    return dt.astimezone(ZoneInfo("Europe/Paris"))
