"""API en lecture seule (lots 0-2) : santé des connecteurs, sources, documents. Le contrat complet viendra aux lots 3/4."""
from __future__ import annotations

import os

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import desc, select, text
from sqlalchemy.orm import Session

from app.db import make_engine, make_session_factory
from app.models import ConnectorHealth, Document, Source

app = FastAPI(title="VEILLE — observatoire (API lots 0-2)", docs_url="/api/docs", openapi_url="/api/openapi.json")
_factory = None


def get_session():
    global _factory
    if _factory is None:
        _factory = make_session_factory(make_engine(os.environ["DATABASE_URL"]))
    s = _factory()
    try:
        yield s
    finally:
        s.close()


@app.get("/healthz")
def healthz(db: Session = Depends(get_session)):
    db.execute(text("select 1"))
    return {"status": "ok"}


@app.get("/api/v1/connectors/health")
def connectors_health(db: Session = Depends(get_session)):
    rows = db.execute(select(Source, ConnectorHealth).join(ConnectorHealth, ConnectorHealth.source_id == Source.id).order_by(Source.id)).all()
    return [{
        "source_id": s.id, "name": s.name, "enabled": s.enabled, "verification_status": s.verification_status,
        "state": h.state, "consecutive_failures": h.consecutive_failures, "last_attempt_at": h.last_attempt_at,
        "last_success_at": h.last_success_at, "last_new_at": h.last_new_at, "next_run_at": h.next_run_at,
        "last_http_status": h.last_http_status, "last_error": h.last_error,
    } for s, h in rows]


@app.get("/api/v1/documents")
def documents(source: str | None = None, limit: int = Query(50, le=200), db: Session = Depends(get_session)):
    q = select(Document).order_by(desc(Document.first_seen_at)).limit(limit)
    if source:
        q = q.where(Document.source_id == source)
    return [{
        "id": d.id, "source_id": d.source_id, "title": d.title, "url": d.canonical_url, "first_seen_at": d.first_seen_at,
        "published_at": d.published_at, "date_flags": d.date_flags, "version_count": d.version_count,
    } for d in db.scalars(q)]


@app.get("/api/v1/documents/{doc_id}")
def document(doc_id: int, db: Session = Depends(get_session)):
    d = db.get(Document, doc_id)
    if d is None:
        raise HTTPException(404, "document inconnu")
    return {"id": d.id, "source_id": d.source_id, "title": d.title, "url": d.canonical_url, "first_seen_at": d.first_seen_at,
            "published_at": d.published_at, "date_flags": d.date_flags,
            "versions": [{"version_no": v.version_no, "change_kind": v.change_kind, "retrieved_at": v.retrieved_at,
                          "content_hash": v.content_hash, "text": v.text} for v in d.versions]}
