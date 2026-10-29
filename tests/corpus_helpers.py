"""Outils du corpus de cas piégeux (lot 2). Les textes sont FICTIFS (pays « Fictivia », « Exampleland »…)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.collectors.base import FetchedItem, FetchResult
from app.collectors.store import ingest
from app.db import session_scope
from app.events.pipeline import default_gazetteer, process_pending
from app.models import Claim, Document, Event, EventClaim, Source

T0 = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def add_source(factory, sid: str, *, kind: str = "media", family: str | None = None, org: str | None = None, connector: str = "feed") -> None:
    with session_scope(factory) as s:
        if s.get(Source, sid) is None:
            from app.models import ConnectorHealth
            s.add(Source(id=sid, name=sid, organisation=org or f"Organisme {sid}", source_type=kind, origin_family=family or f"fam-{sid}",
                         zone="monde", access_mode="feed", connector=connector, canonical_url="https://example.invalid/", allowed_domains=["example.invalid"],
                         poll_interval_s=300, options={"default_tz": "Europe/Paris"}))
            s.add(ConnectorHealth(source_id=sid, state="unknown"))


def put(factory, sid: str, ext: str, title: str, body: str, *, published: str | None = None, at: datetime = T0,
        url: str | None = None, structured: dict | None = None, text: str | None = None) -> None:
    """Ingère un document comme le ferait le collecteur (donc via la vraie logique de versionnage)."""
    with session_scope(factory) as s:
        src = s.get(Source, sid)
        item = FetchedItem(external_id=ext, url=url or f"https://example.invalid/{sid}/{ext}", title=title,
                           text=text if text is not None else f"{title}\n{body}", published_raw=published, structured=structured or {})
        ingest(s, src, FetchResult(outcome="ok", items=[item], http_status=200, final_url=item.url), at, None)


def process(factory, at: datetime = T0 + timedelta(minutes=5)) -> dict:
    with session_scope(factory) as s:
        out = process_pending(s, gaz=default_gazetteer(), now=at)
        if out["errors"]:  # une erreur de traitement ne doit jamais passer inaperçue dans le corpus
            from sqlalchemy import text
            raise AssertionError(s.execute(text("select detail from version_processing where status='error'")).all())
        return out


def events(factory, **where):
    with session_scope(factory) as s:
        q = select(Event).order_by(Event.id)
        for k, v in where.items():
            q = q.where(getattr(Event, k) == v)
        rows = s.scalars(q).all()
        s.expunge_all()
        return rows


def claims(factory, **where):
    with session_scope(factory) as s:
        q = select(Claim).order_by(Claim.id)
        for k, v in where.items():
            q = q.where(getattr(Claim, k) == v)
        rows = s.scalars(q).all()
        s.expunge_all()
        return rows


def members(factory, event_id: int):
    with session_scope(factory) as s:
        return [(c.category, ec.role) for ec, c in s.execute(select(EventClaim, Claim).join(Claim, Claim.id == EventClaim.claim_id)
                                                           .where(EventClaim.event_id == event_id).order_by(Claim.id))]
