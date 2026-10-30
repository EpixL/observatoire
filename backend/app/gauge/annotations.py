"""Revue humaine d'un événement (plan §4 `manual_annotations`). C'est la seule voie, sans IA, pour qu'une qualification issue de prose
atteigne les paliers 70/85/100. Une annotation n'est jamais modifiée : une correction est une nouvelle annotation."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.gauge.engine import ALL_QUALS, HOSTILE_QUALS, valid_annotation
from app.gauge.policy import PolicyError
from app.models import Claim, Event, EventClaim, ManualAnnotation, Review


def annotate(session: Session, event_id: int, qualification: str, details: dict | None, note: str, actor: str, now: datetime) -> ManualAnnotation:
    ev = session.get(Event, event_id)
    if ev is None:
        raise PolicyError(404, "unknown_event", f"événement {event_id} inconnu")
    if qualification not in ALL_QUALS:
        raise PolicyError(422, "unknown_qualification", f"qualification inconnue : {qualification!r} (attendu : {sorted(ALL_QUALS)})")
    if not isinstance(note, str) or len(note.strip()) < 8:
        raise PolicyError(422, "note_required", "note obligatoire (au moins 8 caractères) : sur quoi repose cette qualification ?")
    a = ManualAnnotation(event_id=event_id, qualification=qualification, details=details or {}, note=note.strip(), actor=actor, created_at=now)
    if qualification in HOSTILE_QUALS and not valid_annotation(a):
        raise PolicyError(422, "annotation_incomplete",
                          "faits, zone, période et acteur doivent être documentés séparément (facts_established, zone_established, period_established, "
                          "actor_established = true) ; armed_attack exige aussi state_actor ; sustained_conflict exige aussi campaign_established")
    session.add(a)
    session.flush()
    # la file de revue liée à cet événement est traitée
    claim_ids = [c for (c,) in session.execute(select(EventClaim.claim_id).where(EventClaim.event_id == event_id))]
    for r in session.scalars(select(Review).where(Review.status == "open", (Review.event_id == event_id) | Review.claim_id.in_(claim_ids or [-1]))):
        r.status, r.resolved_at, r.note = "closed", now, f"traité par annotation #{a.id} ({qualification})"
    session.flush()
    return a


def annotations_of(session: Session, event_id: int) -> list[dict]:
    return [{"id": a.id, "qualification": a.qualification, "details": a.details, "note": a.note, "actor": a.actor, "created_at": a.created_at.isoformat()}
            for a in session.scalars(select(ManualAnnotation).where(ManualAnnotation.event_id == event_id).order_by(ManualAnnotation.id.desc()))]
