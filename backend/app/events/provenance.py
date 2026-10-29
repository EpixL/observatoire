"""Vérifications hors IA de la provenance (plan §8) : les références sont-elles réellement traçables ?"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Claim, DocumentVersion, EvidenceLink, Event, EventClaim


def verify_all(session: Session) -> dict:
    bad: list[dict] = []
    n_links = 0
    for link, version in session.execute(select(EvidenceLink, DocumentVersion).join(DocumentVersion, DocumentVersion.id == EvidenceLink.document_version_id)):
        n_links += 1
        if version.text[link.char_start:link.char_end] != link.quote:
            bad.append({"kind": "quote_mismatch", "evidence_link_id": link.id, "claim_id": link.claim_id})
    for (cid,) in session.execute(select(Claim.id).where(~select(EvidenceLink.id).where(EvidenceLink.claim_id == Claim.id).exists())):
        bad.append({"kind": "claim_without_evidence", "claim_id": cid})
    for (eid,) in session.execute(select(Event.id).where(~select(EventClaim.claim_id).where(EventClaim.event_id == Event.id).exists())):
        bad.append({"kind": "event_without_claim", "event_id": eid})
    for claim in session.scalars(select(Claim).where(Claim.claim_type == "observation")):
        if claim.certainty != "structured":
            bad.append({"kind": "observation_not_structured", "claim_id": claim.id})
    return {
        "evidence_links": n_links,
        "claims": session.scalar(select(func.count()).select_from(Claim)),
        "events": session.scalar(select(func.count()).select_from(Event)),
        "bad": len(bad), "problems": bad[:50],
    }
