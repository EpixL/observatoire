from __future__ import annotations

from app.events.extractors.common import DocCtx
from app.events.extractors.prose import extract_prose
from app.events.extractors.structured import extract_cert, extract_czib, extract_diplomatie, extract_ioda, extract_vigipirate
from app.events.schemas import Extraction

EXTRACTOR_VERSION = "lot2.1"


def extract(ctx: DocCtx) -> tuple[Extraction, bool]:
    """Retourne (extraction, prose_applicable). Dispatch par famille d'origine du registre des sources."""
    family = ctx.source.origin_family
    if family == "fr-diplomatie":
        ex = extract_diplomatie(ctx)
        if ctx.source.connector == "feed":  # un flux d'actualités contient aussi de la prose
            prose = extract_prose(ctx)
            ex.claims += prose.claims
            ex.flags += prose.flags
        return ex, ctx.source.connector == "feed"
    if family == "easa":
        return extract_czib(ctx), False
    if family == "sgdsn":
        return extract_vigipirate(ctx), False
    if family == "cert-fr":
        return extract_cert(ctx), False
    if family == "ioda":
        return extract_ioda(ctx), False
    return extract_prose(ctx), True
