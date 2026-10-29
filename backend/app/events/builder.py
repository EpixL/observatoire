"""Stockage des affirmations, rattachement aux événements, confirmation par affirmation, liens de cause commune."""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events.dedup import count_independent_origins
from app.events.extractors.common import DocCtx, fold
from app.events.schemas import Category, ExtractedClaim, EVENT_TYPE, MATCH_WINDOW_H
from app.models import Claim, Document, Event, EventClaim, EventLink, EvidenceLink, Review

STALE_AFTER = timedelta(days=7)
STATE_CATEGORIES = {Category.travel_advice_state, Category.airspace_advisory_state, Category.security_posture_state}
INFRA_TYPES = {"internet_outage", "civil_disruption", "closure_restriction", "weather_event"}


def semantic_key(c: ExtractedClaim) -> str:
    """Identité d'une affirmation : catégorie + zone + négation + discriminant (valeur structurée ou, pour la prose,
    objet précis : installation, service, phénomène, acteurs). Une reformulation, ou le titre qui répète la première
    phrase, désigne la MÊME affirmation : elle ajoute une preuve, pas une unité de plus."""
    p = c.params
    discriminant = c.key_extra or "|".join(str(p.get(k)) for k in ("facility", "service", "phenomenon", "attributed_to", "actors"))
    return f"{c.category.value}|{','.join(sorted(c.zone_codes))}|{int(c.negated)}|{discriminant}"


def claim_key(c: ExtractedClaim) -> str:
    return hashlib.sha256(semantic_key(c).encode()).hexdigest()[:32]


def _richness(c: ExtractedClaim) -> tuple:
    return (c.occurred_at is not None, bool(c.zone_codes), bool(c.declarant), len(c.quote))


def doc_ref_time(doc: Document) -> datetime:
    if doc.published_at is not None and "future" not in (doc.date_flags or []):
        return doc.published_at
    return doc.first_seen_at


def claim_ref_time(c: Claim, doc: Document) -> datetime:
    return c.occurred_at or c.period_start or doc_ref_time(doc)


def _review(session: Session, kind: str, now: datetime, reason: str, *, document_id=None, claim_id=None, event_id=None) -> None:
    q = select(Review.id).where(Review.kind == kind, Review.document_id == document_id, Review.claim_id == claim_id, Review.event_id == event_id)
    if session.scalar(q) is None:
        session.add(Review(kind=kind, document_id=document_id, claim_id=claim_id, event_id=event_id, reason=reason[:500], created_at=now))


def store_claims(session: Session, ctx: DocCtx, claims: list[ExtractedClaim], now: datetime, flags: list[str]) -> tuple[list[Claim], list[str]]:
    """Insère les affirmations NOUVELLES (une reformulation à l'identique n'est pas recomptée : elle ajoute une preuve)."""
    new: list[Claim] = []
    problems: list[str] = []
    doc, version = ctx.document, ctx.version
    # Regroupe les doublons internes (titre + chapeau) : le représentant est le plus riche, les autres deviennent des preuves.
    groups: dict[str, list[ExtractedClaim]] = {}
    for c in claims:
        groups.setdefault(claim_key(c), []).append(c)
    ordered: list[tuple[ExtractedClaim, list[ExtractedClaim]]] = []
    for key, grp in groups.items():
        grp.sort(key=_richness, reverse=True)
        ordered.append((grp[0], grp[1:]))
    for c, extras in ordered:
        if version.text[c.quote_start:c.quote_end] != c.quote:
            problems.append(f"quote_mismatch:{c.rule_id}")  # ne doit jamais arriver ; on n'invente pas une preuve
            continue
        key = claim_key(c)
        existing = session.scalar(select(Claim).where(Claim.document_id == doc.id, Claim.claim_key == key))
        relation = "denies" if c.negated else "supports"
        if existing is not None:
            if session.scalar(select(EvidenceLink.id).where(EvidenceLink.claim_id == existing.id, EvidenceLink.document_version_id == version.id,
                                                            EvidenceLink.relation == relation)) is None:
                session.add(EvidenceLink(claim_id=existing.id, document_version_id=version.id, quote=c.quote, char_start=c.quote_start,
                                         char_end=c.quote_end, relation=relation, created_at=now))
            continue
        stale = False
        reasons = list(c.review_reasons)
        if c.certainty.value == "provisional":
            ref = c.occurred_at or (doc.published_at if "future" not in (doc.date_flags or []) else None)
            if "old_publication" in (doc.date_flags or []) or (ref is not None and ref < doc.first_seen_at - STALE_AFTER):
                stale = True
                reasons.append("republication_or_old_event")
        row = Claim(
            document_id=doc.id, first_version_id=version.id, claim_key=key, claim_type=c.claim_type.value, category=c.category.value,
            statement=c.statement, subject=c.subject, action=c.action, place_text=c.place_text, zone_codes=c.zone_codes,
            occurred_at=c.occurred_at, occurred_precision=c.occurred_precision.value, period_start=c.period_start, period_end=c.period_end,
            negated=c.negated, conditional=c.conditional, quoted_speaker=c.quoted_speaker, declarant=c.declarant,
            declarant_kind=c.declarant_kind.value, official_scope=c.official_scope.value, certainty=c.certainty.value,
            needs_review=c.needs_review or stale, review_reasons=reasons, stale=stale, params=c.params,
            extractor=f"{ctx.source.origin_family}", rule_id=c.rule_id, created_at=now,
        )
        session.add(row)
        session.flush()
        session.add(EvidenceLink(claim_id=row.id, document_version_id=version.id, quote=c.quote, char_start=c.quote_start,
                                 char_end=c.quote_end, relation=relation, created_at=now))
        for extra in extras:  # même affirmation répétée ailleurs dans le document : preuve supplémentaire (ex. titre)
            if version.text[extra.quote_start:extra.quote_end] == extra.quote and (extra.quote_start, extra.quote_end) != (c.quote_start, c.quote_end):
                session.add(EvidenceLink(claim_id=row.id, document_version_id=version.id, quote=extra.quote, char_start=extra.quote_start,
                                         char_end=extra.quote_end, relation="mentions", created_at=now))
        if row.needs_review:
            _review(session, "claim_qualification", now, ", ".join(reasons) or "qualification provisoire", document_id=doc.id, claim_id=row.id)
        new.append(row)
    session.flush()
    return new, problems


# ---------------------------------------------------------------------------------------------------------------------
def _compatible(a: Claim, b: Claim, event_type: str) -> bool:
    pa, pb = a.params or {}, b.params or {}
    actors_a, actors_b = set(pa.get("actors", [])), set(pb.get("actors", []))
    if actors_a and actors_b and not (actors_a & actors_b):
        return False
    for key in {"closure_restriction": ("facility",), "civil_disruption": ("service",), "travel_advice_change": ("subject",),
                "airspace_advisory": ("czib_id",), "airspace_advisory_extension": ("czib_id",), "cyber_advisory": ("cert_id",),
                "internet_outage": ()}.get(event_type, ()):
        if pa.get(key) is not None and pb.get(key) is not None and pa.get(key) != pb.get(key):
            return False
    if event_type == "cyber_advisory" and pa.get("cert_id") is None:
        return False
    return True


def _zone(c: Claim, gaz) -> str | None:
    return gaz.root(c.zone_codes[0]) if c.zone_codes else None


def _recompute(session: Session, event: Event, now: datetime) -> None:
    rows = session.execute(select(Claim, Document).join(EventClaim, EventClaim.claim_id == Claim.id).join(Document, Document.id == Claim.document_id)
                           .where(EventClaim.event_id == event.id)).all()
    doc_ids = sorted({d.id for _, d in rows})
    positive = [(c, d) for c, d in rows if not c.negated]
    event.document_count = len(doc_ids)
    event.origin_count = count_independent_origins(session, [d.id for _, d in positive]) if positive else 0
    event.first_seen_at = min(d.first_seen_at for _, d in rows)
    event.last_update_at = now
    starts = [c.period_start or c.occurred_at for c, _ in positive if (c.period_start or c.occurred_at)]
    if starts:
        event.period_start = min(starts)
    ends = [c.period_end for c, _ in positive if c.period_end]
    if ends:
        event.period_end = max(ends)
    if event.status == "to_verify" and any(c.certainty == "structured" and not c.needs_review for c, _ in positive):
        event.status = "active"


def _confirm(session: Session, event: Event, new_claim: Claim, ctx: DocCtx, now: datetime) -> None:
    """Confirmation PAR AFFIRMATION : seule une affirmation de même catégorie et même zone est confirmée."""
    if new_claim.negated:
        return
    others = session.execute(
        select(Claim).join(EventClaim, EventClaim.claim_id == Claim.id)
        .where(EventClaim.event_id == event.id, Claim.id != new_claim.id, Claim.category == new_claim.category, Claim.negated.is_(False))
    ).scalars().all()
    for other in others:
        if other.zone_codes[:1] != new_claim.zone_codes[:1]:
            continue
        official_new = new_claim.declarant_kind == "official" and new_claim.official_scope in ("own_decision", "own_measure")
        official_other = other.declarant_kind == "official" and other.official_scope in ("own_decision", "own_measure")
        if official_new and other.declarant_kind != "official" and other.confirmation != "official":
            other.confirmation = "official"
            first_link = session.scalar(select(EvidenceLink).where(EvidenceLink.claim_id == new_claim.id))
            session.add(EvidenceLink(claim_id=other.id, document_version_id=first_link.document_version_id, quote=first_link.quote,
                                     char_start=first_link.char_start, char_end=first_link.char_end, relation="official_confirms", created_at=now))
        elif official_other and new_claim.declarant_kind != "official" and new_claim.confirmation != "official":
            new_claim.confirmation = "official"
            first_link = session.scalar(select(EvidenceLink).where(EvidenceLink.claim_id == other.id))
            session.add(EvidenceLink(claim_id=new_claim.id, document_version_id=first_link.document_version_id, quote=first_link.quote,
                                     char_start=first_link.char_start, char_end=first_link.char_end, relation="official_confirms", created_at=now))


def attach_claim(session: Session, claim: Claim, ctx: DocCtx, now: datetime) -> Event | None:
    cat = Category(claim.category)
    doc = ctx.document
    if cat in STATE_CATEGORIES:
        return None  # un état de référence n'est pas un événement
    if cat is Category.attribution_statement:
        sibling = session.execute(
            select(Event).join(EventClaim, EventClaim.event_id == Event.id).join(Claim, Claim.id == EventClaim.claim_id)
            .where(Claim.document_id == doc.id, Event.event_type == "hostile_act_alleged").order_by(Event.id.desc())
        ).scalars().first()
        if sibling is None:
            _review(session, "attribution_without_event", now, "attribution trouvée sans fait attribué rattachable dans le même document",
                    document_id=doc.id, claim_id=claim.id)
            return None
        session.add(EventClaim(event_id=sibling.id, claim_id=claim.id, role="attribution"))
        session.flush()
        _recompute(session, sibling, now)
        return sibling
    event_type = EVENT_TYPE.get(cat)
    if event_type is None:
        return None

    gaz = ctx.gazetteer
    zone = _zone(claim, gaz)
    ref = claim_ref_time(claim, doc)
    window = timedelta(hours=MATCH_WINDOW_H.get(event_type, 48))
    statuses = ("active", "to_verify")

    if claim.stale:  # republication : on la range à part, inspectable, sans jamais alimenter un événement en cours
        hist = session.scalars(select(Event).where(Event.event_type == event_type, Event.zone_code.is_(zone) if zone is None else Event.zone_code == zone,
                                                   Event.status == "historical")).all()
        for ev in hist:
            if abs(ev.ref_at - ref) <= window:
                session.add(EventClaim(event_id=ev.id, claim_id=claim.id, role="corroboration"))
                session.flush()
                _recompute(session, ev, now)
                return ev
        ev = Event(event_type=event_type, zone_code=zone, title=claim.statement[:200], status="historical", exclusion_reason="republication",
                   novelty="republication", ref_at=ref, occurred_at=claim.occurred_at, occurred_precision=claim.occurred_precision,
                   first_seen_at=doc.first_seen_at, last_update_at=now, created_at=now)
        session.add(ev)
        session.flush()
        session.add(EventClaim(event_id=ev.id, claim_id=claim.id, role="primary"))
        session.flush()
        _recompute(session, ev, now)
        return ev

    candidates: list[tuple[timedelta, Event]] = []
    if zone is not None or True:
        q = select(Event).where(Event.event_type == event_type, Event.status.in_(statuses))
        if zone is not None:
            q = q.where(Event.zone_code == zone)
        else:
            q = q.where(Event.zone_code.is_(None))
        for ev in session.scalars(q):
            delta = abs(ev.ref_at - ref)
            if delta > window:
                continue
            members = session.scalars(select(Claim).join(EventClaim, EventClaim.claim_id == Claim.id).where(EventClaim.event_id == ev.id,
                                                                                                             EventClaim.role != "attribution")).all()
            if zone is None:
                # sans zone, on ne rapproche que des documents de même origine (jamais « au hasard »)
                from app.models import DocumentOrigin
                my = session.get(DocumentOrigin, doc.id)
                same_origin = my is not None and any(
                    (o := session.get(DocumentOrigin, m.document_id)) is not None and o.group_id == my.group_id for m in members)
                if not same_origin:
                    continue
            if members and not any(_compatible(claim, m, event_type) for m in members):
                continue
            candidates.append((delta, ev))

    if claim.negated:
        # Un démenti / « aucune attaque » rejoint le dossier de l'événement contredit ; il n'en crée jamais un.
        if not candidates:
            return None
        ev = min(candidates, key=lambda t: t[0])[1]
        session.add(EventClaim(event_id=ev.id, claim_id=claim.id, role="contradiction"))
        session.flush()
        _recompute(session, ev, now)
        return ev

    if candidates:
        ev = min(candidates, key=lambda t: (t[0], t[1].id))[1]
        session.add(EventClaim(event_id=ev.id, claim_id=claim.id, role="corroboration"))
        session.flush()
        _confirm(session, ev, claim, ctx, now)
        _recompute(session, ev, now)
        link_common_causes(session, ev, gaz, now)
        return ev

    provisional = claim.needs_review or claim.certainty == "provisional"
    ev = Event(event_type=event_type, zone_code=zone, title=claim.statement[:200], status="to_verify" if provisional else "active",
               novelty="new", ref_at=ref, occurred_at=claim.occurred_at, occurred_precision=claim.occurred_precision,
               period_start=claim.period_start, period_end=claim.period_end, first_seen_at=doc.first_seen_at, last_update_at=now, created_at=now)
    session.add(ev)
    session.flush()
    session.add(EventClaim(event_id=ev.id, claim_id=claim.id, role="primary"))
    session.flush()
    _confirm(session, ev, claim, ctx, now)
    _recompute(session, ev, now)
    link_common_causes(session, ev, gaz, now)
    return ev


def link_common_causes(session: Session, event: Event, gaz, now: datetime) -> None:
    """Propose (sans l'affirmer) une cause commune : même zone, même fenêtre de 24 h, avec au moins une explication
    ordinaire candidate (météo, panne électrique/réseau). L'indépendance de ces événements reste à examiner."""
    if event.event_type not in INFRA_TYPES or event.zone_code is None or event.status == "historical":
        return
    for other in session.scalars(select(Event).where(Event.id != event.id, Event.zone_code == event.zone_code,
                                                    Event.event_type.in_(INFRA_TYPES), Event.status != "historical")):
        if abs(other.ref_at - event.ref_at) > timedelta(hours=24):
            continue

        def ordinary_cause(e: Event) -> bool:
            if e.event_type == "weather_event":
                return True
            if e.event_type == "civil_disruption":
                return any((c.params or {}).get("service") in ("power", "network") for c in session.scalars(
                    select(Claim).join(EventClaim, EventClaim.claim_id == Claim.id).where(EventClaim.event_id == e.id)))
            return False

        if not (ordinary_cause(event) or ordinary_cause(other)):
            continue
        a, b = sorted((event.id, other.id))
        if session.scalar(select(EventLink.id).where(EventLink.event_a_id == a, EventLink.event_b_id == b, EventLink.link_type == "possible_common_cause")) is None:
            session.add(EventLink(event_a_id=a, event_b_id=b, link_type="possible_common_cause", created_at=now,
                                  reason="même zone et même fenêtre de 24 h ; une explication ordinaire commune (météo, panne électrique/réseau) "
                                         "n'est pas exclue : ne pas compter ces événements comme indépendants sans examen"))
    session.flush()
