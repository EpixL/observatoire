"""Réévaluation de la jauge : couverture → critères → palier publié (hystérésis) → instantané daté avec la version des seuils.

Règles du plan §6.4 appliquées ici :
  · couverture insuffisante => « non calculable » (jamais 0), dernière valeur connue conservée avec sa date ;
  · exception : un fait grave établi (≥ 70, validé par un humain) reste publié avec le badge « couverture partielle » ;
  · une baisse doit être stable `downgrade_evals` réévaluations ; une hausse n'est jamais retardée ;
  · une correction factuelle (annotation corrective) s'applique immédiatement.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.gauge import engine, policy
from app.gauge.config import GaugeConfig
from app.gauge.coverage import evaluate_coverage
from app.gauge.scenarios import build_dossiers
from app.models import Event, IndexPolicyVersion, IndexSnapshot, ManualAnnotation, Review

PARTIAL_COVERAGE_MIN = 70


def _prev(session: Session, territory: str) -> IndexSnapshot | None:
    return session.scalar(select(IndexSnapshot).where(IndexSnapshot.territory == territory).order_by(IndexSnapshot.id.desc()).limit(1))


def _last_calculable(session: Session, territory: str) -> IndexSnapshot | None:
    return session.scalar(select(IndexSnapshot).where(IndexSnapshot.territory == territory, IndexSnapshot.status == "calculable")
                          .order_by(IndexSnapshot.id.desc()).limit(1))


def evaluate_territory(session: Session, cfg: GaugeConfig, territory_id: str, now: datetime) -> IndexSnapshot:
    terr = cfg.territory(territory_id)
    pol = policy.current_policy(session, cfg, now)
    params = pol.params
    res = engine.evaluate(session, cfg, terr, params, now)
    cov = evaluate_coverage(session, cfg, territory_id, params, now)

    pending_ids = [e.id for e in res.pending_major]
    pending_reviews = session.query(Review).filter(Review.kind == "unqualified_document", Review.status == "open").count()
    reasons = list(cov["reasons"])
    if pending_ids:   # n'empêche pas le calcul : empêche « 0 » (ces événements comptent au moins pour le palier 10)
        reasons.append(f"{len(pending_ids)} événement(s) majeur(s) en attente de revue humaine : le palier ne peut pas être 0")
    satisfied = cov["families_ok"] and cov["baseline"]["sufficient"]
    cov_out = {"profile_satisfied": satisfied, "profile_label": "Profil pilote : 3 familles obligatoires à jour + référence quantitative suffisante",
               "families": cov["families"], "pending_documents": pending_reviews, "pending_major_review": len(pending_ids),
               "baseline": cov["baseline"], "reasons": reasons}

    raw = res.palier if res.palier is not None else (0 if satisfied else None)
    prev = _prev(session, territory_id)
    applied: int | None
    partial = False
    rule = res.rule_id
    pending_downgrade = None

    if not satisfied:
        if res.floor >= PARTIAL_COVERAGE_MIN:
            applied, partial, rule = res.floor, True, f"R-P{res.floor}+couverture-partielle"
            raw = res.palier
        else:
            applied, rule = None, "R-NC"      # non calculable
    else:
        applied = raw
        prev_applied = prev.palier if prev is not None and prev.status == "calculable" else None
        if prev_applied is not None and raw < prev_applied:
            corrected = session.scalar(select(ManualAnnotation.id).where(
                ManualAnnotation.created_at > prev.computed_at, ManualAnnotation.qualification.in_(sorted(engine.CORRECTIVE_QUALS))).limit(1)) is not None
            need = int(params["downgrade_evals"])
            pd = prev.details.get("pending_downgrade") or {}
            count = 1 + (pd.get("count", 0) if pd.get("target") == raw else 0)
            if corrected:
                pending_downgrade = None          # correction factuelle : immédiat
            elif count >= need:
                pending_downgrade = None
            else:
                applied, rule = prev_applied, f"{rule}|baisse-en-attente"
                pending_downgrade = {"target": raw, "count": count, "needed": need}

    last = _last_calculable(session, territory_id)
    if applied is not None:
        lk_pal, lk_at = applied, now
    else:
        lk_pal, lk_at = (last.palier, last.computed_at) if last else (None, None)

    ev_view = [{"id": e.id, "type": e.type, "zone": e.zone, "title": e.title[:140], "role": e.role, "family": e.family, "direct": e.direct,
                "origins": e.origin_count, "why": e.why, "flags": sorted(e.flags)} for e in res.events]
    details = {
        "rules_version": engine.RULES_VERSION, "raw_palier": raw, "evidence_event_ids": res.evidence_ids,
        "criteria": [{"palier": c.palier, "criterion": c.criterion, "state": c.state, "note": c.note, "event_ids": c.event_ids} for c in res.criteria],
        "coverage": cov_out, "events": ev_view, "floor_annotated": res.floor,
        "pending_downgrade": pending_downgrade,
        "dossiers": build_dossiers(session, cfg, terr, params, cov_out["profile_satisfied"], now, res),
        "nuclear_mentions": [e.id for e in res.events if e.type == "nuclear_radiological_mention"],
    }
    snap = IndexSnapshot(territory=territory_id, computed_at=now, policy_version_id=pol.id,
                         status="calculable" if applied is not None else "non_calculable", palier=applied, raw_palier=raw,
                         rule_id=rule, partial_coverage=partial, coverage_satisfied=satisfied,
                         last_known_palier=lk_pal, last_known_at=lk_at, details=details)
    session.add(snap)
    session.flush()
    return snap


def evaluate_all(session: Session, cfg: GaugeConfig, now: datetime) -> list[IndexSnapshot]:
    return [evaluate_territory(session, cfg, t.id, now) for t in cfg.territories]


# --------------------------------------------------------------------------------------------------------------------
def trend(session: Session, snap: IndexSnapshot, hours: int) -> dict:
    """Tendance entre l'instant courant et ~`hours` h plus tôt, sous règles ET couverture comparables."""
    ref = session.scalar(select(IndexSnapshot).where(IndexSnapshot.territory == snap.territory,
                                                     IndexSnapshot.computed_at <= snap.computed_at - timedelta(hours=hours))
                         .order_by(IndexSnapshot.id.desc()).limit(1))
    if ref is None:
        return {"direction": "non_comparable", "from": None, "to": snap.palier, "reason": "historique insuffisant sur cette période"}
    if ref.policy_version_id != snap.policy_version_id:
        a = session.get(IndexPolicyVersion, ref.policy_version_id).label
        b = session.get(IndexPolicyVersion, snap.policy_version_id).label
        return {"direction": "non_comparable", "from": ref.palier, "to": snap.palier, "reason": f"seuils modifiés entre-temps ({a} → {b})"}
    if ref.status != "calculable" or snap.status != "calculable":
        return {"direction": "non_comparable", "from": ref.palier, "to": snap.palier, "reason": "couverture insuffisante à l'une des deux dates"}
    d = "stable" if ref.palier == snap.palier else ("hausse" if snap.palier > ref.palier else "baisse")
    return {"direction": d, "from": ref.palier, "to": snap.palier}


def gauge_state(session: Session, cfg: GaugeConfig, snap: IndexSnapshot) -> dict:
    """Forme `GaugeState` du dashboard."""
    terr = cfg.territory(snap.territory)
    pol = session.get(IndexPolicyVersion, snap.policy_version_id)
    return {
        "territory": {"id": terr.id, "label": terr.label},
        "status": snap.status, "palier": snap.palier,
        "last_known": {"palier": snap.last_known_palier, "at": snap.last_known_at.isoformat()} if snap.last_known_palier is not None else None,
        "partial_coverage": snap.partial_coverage, "as_of": snap.computed_at.isoformat(),
        "trend_24h": trend(session, snap, 24), "trend_7d": trend(session, snap, 24 * 7),
        "policy": {"version": pol.label, "plan_version": "seuils-v1", "label": f"Seuils {pol.label} ({'valeurs du plan' if pol.kind == 'plan' else 'modifiés'})"},
        "rule_id": snap.rule_id, "rules_version": snap.details.get("rules_version"),
    }
