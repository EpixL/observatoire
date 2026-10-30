"""Projection des tables vers les formes attendues par le dashboard (docs/api-contract.md, branche dashboard)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.events.pipeline import default_gazetteer
from app.gauge.annotations import annotations_of
from app.models import (
    Claim, ConnectorHealth, Document, DocumentOrigin, DocumentVersion, Event, EventClaim, EventLink, EvidenceLink, IndexSnapshot, OriginGroup, Source,
)

LAYER = {"internet_outage": "reseaux", "civil_disruption": "reseaux", "closure_restriction": "restrictions", "airspace_advisory": "restrictions",
         "airspace_advisory_extension": "restrictions", "hostile_act_alleged": "incidents", "weather_event": "incidents", "rhetoric": "incidents",
         "military_exercise": "incidents", "nuclear_radiological_mention": "incidents", "travel_advice_change": "mesures",
         "security_posture_change": "mesures", "cyber_advisory": "reseaux"}


def iso(d: datetime | None) -> str | None:
    return d.isoformat().replace("+00:00", "Z") if d else None


def sources_status(session: Session) -> list[dict]:
    rows = session.execute(select(Source, ConnectorHealth).outerjoin(ConnectorHealth, ConnectorHealth.source_id == Source.id).order_by(Source.id)).all()
    out = []
    for s, h in rows:
        st = h.state if h else "unknown"
        if not s.enabled:
            state, verdict = "desactivee", "SKIPPED"
            reason = (s.options or {}).get("disabled_reason") or ("URL du flux à découvrir" if s.verification_status == "to_discover" else "désactivée dans la configuration")
        elif st == "ok":
            state, verdict, reason = "ok", "OK", "dernière collecte réussie"
        elif st == "degraded":
            state, verdict, reason = "retard", "OK", f"1 échec récent : {h.last_error}"
        elif st in ("failing", "rate_limited"):
            state, verdict, reason = "indisponible", "FAIL", h.last_error or ("quota atteint" if st == "rate_limited" else "échecs répétés")
        elif st == "blocked":
            state, verdict, reason = "indisponible", "BLOCKED", h.last_error or "accès refusé"
        else:
            state, verdict, reason = "retard", "SKIPPED", "jamais interrogée"
        out.append({
            "id": s.id, "name": s.name, "organism": s.organisation, "kind": s.source_type, "family": s.origin_family, "zone": s.zone,
            "access": s.access_mode, "expected_delay": "non mesuré", "frequency": f"toutes les {s.poll_interval_s // 60} min",
            "state": state, "state_detail": reason, "last_attempt": iso(h.last_attempt_at) if h else None,
            "last_success": iso(h.last_success_at) if h else None, "last_novelty": iso(h.last_new_at) if h else None,
            "licence": s.licence, "verdict": verdict, "verdict_reason": reason, "verification_status": s.verification_status,
            "enabled": s.enabled, "consecutive_failures": h.consecutive_failures if h else 0,
        })
    return out


def _reading_status(ev: Event, role: str | None) -> str:
    if ev.status == "historical":
        return "contexte"
    if role in ("material", "grave"):
        return "retenu"
    if role in ("pending_major",) or ev.status == "to_verify":
        return "a_verifier"
    return "contexte"


def event_dict(session: Session, ev: Event, snap: IndexSnapshot | None) -> dict:
    gaz = default_gazetteer()
    claims = session.execute(select(Claim, EventClaim.role).join(EventClaim, EventClaim.claim_id == Claim.id).where(EventClaim.event_id == ev.id)
                             .order_by(Claim.id)).all()
    primary = next((c for c, r in claims if r == "primary"), claims[0][0] if claims else None)
    docs = {}
    for c, role in claims:
        d = session.get(Document, c.document_id)
        v = session.get(DocumentVersion, d.current_version_id)
        link = session.scalar(select(EvidenceLink).where(EvidenceLink.claim_id == c.id).order_by(EvidenceLink.id).limit(1))
        o = session.get(DocumentOrigin, d.id)
        grp = session.get(OriginGroup, o.group_id) if o else None
        src = session.get(Source, d.source_id)
        docs.setdefault(d.id, {
            "id": src.id, "name": src.name, "kind": src.source_type, "official": src.source_type in ("autorite", "operateur"),
            "published_at": iso(d.published_at) if "future" not in (d.date_flags or []) else None, "retrieved_at": iso(v.retrieved_at),
            "url": d.canonical_url, "excerpt": link.quote[:400] if link else "",
            "origin_id": f"O-{o.group_id}" if o else "O-?", "is_original": bool(grp and grp.representative_document_id == d.id),
            "date_flags": d.date_flags or [],
        })
    role = None
    effect = {"palier": 10, "criterion": "Non évalué par les règles", "state": "non_evalue", "note": ""}
    if snap is not None:
        for e in snap.details.get("events", []):
            if e["id"] == ev.id:
                role = e["role"]
                break
        for cr in sorted(snap.details.get("criteria", []), key=lambda x: -x["palier"]):
            if ev.id in cr["event_ids"]:
                effect = {"palier": cr["palier"], "criterion": cr["criterion"], "state": cr["state"], "note": cr["note"]}
                break
    center = gaz.centers.get(ev.zone_code) if ev.zone_code else None
    location = ({"kind": "point", "lon": center[0], "lat": center[1], "precision": "pays", "label": ev.zone_code, "iso": ev.zone_code}
                if center else {"kind": "none", "reason": "lieu non identifié ou hors gazetier : non localisé"})
    links = session.execute(select(EventLink).where((EventLink.event_a_id == ev.id) | (EventLink.event_b_id == ev.id))).scalars().all()
    excl = {"reason": "perime", "detail": "republication ou événement ancien : écarté de l'analyse"} if ev.status == "historical" else None
    return {
        "id": f"EV-{ev.id}", "title": ev.title, "layer": LAYER.get(ev.event_type, "incidents"), "event_type": ev.event_type, "fictional": False,
        "reading_status": _reading_status(ev, role), "exclusion": excl,
        "evidence_status": "directe" if (role in ("material", "grave") and effect["state"] == "rempli" and any(d["official"] for d in docs.values()))
        else ("deux_origines" if ev.origin_count >= 2 else ("origine_unique" if ev.origin_count == 1 else "non_corroboree")),
        "occurred_at": iso(ev.occurred_at), "occurred_precision": ev.occurred_precision, "published_at": min((d["published_at"] for d in docs.values() if d["published_at"]), default=None),
        "first_seen_at": iso(ev.first_seen_at), "retrieved_at": max((d["retrieved_at"] for d in docs.values()), default=iso(ev.first_seen_at)), "expires_at": None,
        "location": location, "zone_code": ev.zone_code,
        "observed_fact": primary.statement if primary else ev.title, "hypotheses": [],
        "contradictions": [c.statement for c, r in claims if r == "contradiction"],
        "rule": {"id": snap.rule_id if snap else "R-?", "version": snap.details.get("rules_version") if snap else "n/a"}, "effect": effect,
        "sources": list(docs.values()), "independent_origins": ev.origin_count, "dossier_ids": [],
        "proposed_links": [{"event_id": f"EV-{l.event_b_id if l.event_a_id == ev.id else l.event_a_id}", "link_type": l.link_type, "reason": l.reason} for l in links],
        "claims": [{"id": c.id, "category": c.category, "claim_type": c.claim_type, "role": r, "negated": c.negated, "confirmation": c.confirmation,
                    "declarant": c.declarant, "certainty": c.certainty, "needs_review": c.needs_review, "statement": c.statement} for c, r in claims],
        "annotations": annotations_of(session, ev.id),
    }
