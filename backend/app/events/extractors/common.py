from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone

from app.events.gazetteer import Gazetteer
from app.events.schemas import Precision
from app.models import Document, DocumentVersion, Source


@dataclass
class DocCtx:
    source: Source
    document: Document
    version: DocumentVersion
    prev_version: DocumentVersion | None
    gazetteer: Gazetteer
    now: datetime


def fold(text: str) -> str:
    """Minuscules sans accents, MÊME LONGUEUR que le texte (les positions restent valables)."""
    return "".join(unicodedata.normalize("NFD", c)[0].lower() for c in text)


_MONTHS = {
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7, "aout": 8,
    "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_ALT = "|".join(sorted(_MONTHS, key=len, reverse=True))
DATE_DMY = re.compile(rf"\b(\d{{1,2}})(?:er)? ({_MONTH_ALT})\.?(?: (\d{{4}}))?\b")
DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def parse_date_in(text_folded: str, reference: datetime | None) -> tuple[datetime | None, Precision, list[str]]:
    """Date d'événement explicite dans un texte (déjà passé par fold). Jamais devinée :
    - jour+mois+année -> précision jour ;
    - jour+mois sans année -> année de la date de référence, signalé `year_inferred` ;
    - sinon (hier, ce matin…) -> inconnue."""
    m = DATE_ISO.search(text_folded)
    if m:
        try:
            return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=timezone.utc), Precision.day, []
        except ValueError:
            return None, Precision.unknown, ["invalid_date"]
    m = DATE_DMY.search(text_folded)
    if m:
        day, month = int(m[1]), _MONTHS[m[2]]
        flags: list[str] = []
        if m[3]:
            year = int(m[3])
        elif reference is not None:
            year = reference.year
            flags.append("year_inferred")
        else:
            return None, Precision.unknown, ["date_without_year"]
        try:
            return datetime(year, month, day, tzinfo=timezone.utc), Precision.day, flags
        except ValueError:
            return None, Precision.unknown, ["invalid_date"]
    return None, Precision.unknown, []
