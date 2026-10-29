"""Orchestration du lot 2 : versions non traitées -> origine -> extraction -> affirmations -> événements."""
from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from pathlib import Path
import os

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.events import builder
from app.events.dedup import assign_origin
from app.events.extractors import EXTRACTOR_VERSION, extract
from app.events.extractors.common import DocCtx
from app.events.gazetteer import Gazetteer, load_gazetteer
from app.models import Document, DocumentVersion, Source, VersionProcessing
from app.normalization.dates import utcnow


def default_gazetteer() -> Gazetteer:
    root = Path(os.environ.get("CONFIG_DIR", Path(__file__).resolve().parents[3] / "config"))
    return load_gazetteer(str(root / "zones.yaml"))


def process_version(session: Session, version: DocumentVersion, gaz: Gazetteer, now: datetime) -> dict:
    doc = session.get(Document, version.document_id)
    source = session.get(Source, doc.source_id)
    prev = session.scalar(select(DocumentVersion).where(DocumentVersion.document_id == doc.id, DocumentVersion.version_no < version.version_no)
                          .order_by(DocumentVersion.version_no.desc()))
    first = session.scalar(select(func.min(Document.first_seen_at)).where(Document.source_id == source.id))
    ctx = DocCtx(source=source, document=doc, version=version, prev_version=prev, gazetteer=gaz, now=now, source_first_seen=first)
    extraction, prose_applicable = extract(ctx)

    wire = next((f.split(":", 1)[1] for f in extraction.flags if f.startswith("wire:")), None)
    assign_origin(session, doc, version, wire, now)

    new_claims, problems = builder.store_claims(session, ctx, extraction.claims, now, extraction.flags)
    events = set()
    # Les attributions se rattachent au fait attribué : on traite d'abord les faits, ensuite les attributions.
    for claim in sorted(new_claims, key=lambda c: c.category == "attribution_statement"):
        ev = builder.attach_claim(session, claim, ctx, now)
        if ev is not None:
            events.add(ev.id)

    if "prompt_injection_suspected" in extraction.flags:
        builder._review(session, "prompt_injection_suspected", now,
                        "le texte contient une consigne adressée à un modèle ; traité comme donnée, aucune consigne suivie", document_id=doc.id)
    if prose_applicable and not extraction.claims:
        builder._review(session, "unqualified_document", now, "aucun indice reconnu par les règles : document à qualifier à la main", document_id=doc.id)
    return {"claims": len(new_claims), "events": sorted(events), "flags": extraction.flags + problems}


def process_pending(session: Session, limit: int = 500, gaz: Gazetteer | None = None, now: datetime | None = None) -> dict:
    gaz = gaz or default_gazetteer()
    done = skipped = errors = 0
    versions = session.scalars(
        select(DocumentVersion).outerjoin(VersionProcessing, VersionProcessing.version_id == DocumentVersion.id)
        .where(VersionProcessing.version_id.is_(None)).order_by(DocumentVersion.id).limit(limit)
    ).all()
    for v in versions:
        t = now or utcnow()
        if v.change_kind == "cosmetic":
            session.add(VersionProcessing(version_id=v.id, processed_at=t, status="skipped", flags=["cosmetic_change"], detail={}))
            skipped += 1
            continue
        try:
            with session.begin_nested():
                detail = process_version(session, v, gaz, t)
                session.add(VersionProcessing(version_id=v.id, processed_at=t, status="ok", flags=detail["flags"],
                                              detail={"claims": detail["claims"], "events": detail["events"], "extractor": EXTRACTOR_VERSION}))
            done += 1
        except Exception as exc:  # une version défaillante n'arrête pas les suivantes ; elle reste visible
            session.add(VersionProcessing(version_id=v.id, processed_at=t, status="error", flags=["exception"],
                                          detail={"error": f"{type(exc).__name__}: {exc}"[:300]}))
            errors += 1
    session.flush()
    return {"processed": done, "skipped_cosmetic": skipped, "errors": errors}
