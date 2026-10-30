"""API VEILLE (lots 0-3). Lectures sur le LAN ; écritures protégées par jeton (ADMIN_TOKEN) et désactivées sans jeton.
Contrat : docs/api-contract.md (session B) et docs/api-contract-backend-proposal.md (écarts et ajouts proposés par le backend)."""
from __future__ import annotations

from datetime import timedelta

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, select, text
from sqlalchemy.orm import Session

from app.api.deps import get_cfg, get_session, require_admin
from app.api.serializers import event_dict, iso, sources_status
from app.gauge import policy, snapshots
from app.gauge.annotations import annotate
from app.gauge.config import GaugeConfig
from app.models import ConnectorHealth, Document, Event, IndexPolicyVersion, IndexSnapshot, Review, Source
from app.normalization.dates import utcnow

app = FastAPI(title="VEILLE — observatoire (API)", docs_url="/api/docs", openapi_url="/api/openapi.json")


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.exception_handler(policy.PolicyError)
async def _policy_error(_: Request, exc: policy.PolicyError):
    return error(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    return error(422, "invalid_request", f"{'.'.join(str(x) for x in first.get('loc', []))} : {first.get('msg', 'requête invalide')}")


@app.exception_handler(HTTPException)
async def _http_error(_: Request, exc: HTTPException):
    return error(exc.status_code, "http_error", str(exc.detail))


# ---- santé / existant -------------------------------------------------------------------------------------------------
@app.get("/healthz")
def healthz(db: Session = Depends(get_session)):
    db.execute(text("select 1"))
    return {"status": "ok"}


@app.get("/api/v1/connectors/health")
def connectors_health(db: Session = Depends(get_session)):
    return sources_status(db)


@app.get("/api/v1/sources/status")
def sources_status_route(db: Session = Depends(get_session)):
    """Écran Réglages › État des sources : dernier passage, verdict, motif (lecture seule)."""
    return sources_status(db)


@app.get("/api/v1/documents")
def documents(source: str | None = None, limit: int = Query(50, le=200), db: Session = Depends(get_session)):
    q = select(Document).order_by(desc(Document.first_seen_at)).limit(limit)
    if source:
        q = q.where(Document.source_id == source)
    return [{"id": d.id, "source_id": d.source_id, "title": d.title, "url": d.canonical_url, "first_seen_at": iso(d.first_seen_at),
             "published_at": iso(d.published_at), "date_flags": d.date_flags, "version_count": d.version_count} for d in db.scalars(q)]


# ---- territoires, jauge -----------------------------------------------------------------------------------------------
@app.get("/api/v1/territories")
def territories(cfg: GaugeConfig = Depends(get_cfg)):
    return [{"id": t.id, "label": t.label, "zones": sorted(t.zones), "default": t.default} for t in cfg.territories]


def _latest(db: Session, cfg: GaugeConfig, territory: str | None) -> IndexSnapshot:
    tid = territory or next(t.id for t in cfg.territories if t.default)
    if cfg.territory(tid) is None:
        raise policy.PolicyError(404, "unknown_territory", f"territoire inconnu : {tid}")
    snap = db.scalar(select(IndexSnapshot).where(IndexSnapshot.territory == tid).order_by(IndexSnapshot.id.desc()).limit(1))
    if snap is None:
        raise policy.PolicyError(404, "not_evaluated", "la jauge n'a pas encore été évaluée pour ce territoire (attendre le prochain tour du worker)")
    return snap


@app.get("/api/v1/gauge")
def gauge(territory: str | None = None, db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    return snapshots.gauge_state(db, cfg, _latest(db, cfg, territory))


@app.get("/api/v1/gauge/detail")
def gauge_detail(territory: str | None = None, db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    """Pourquoi ce palier : critères de chacun des 8 paliers (rempli / non rempli / non évalué), couverture, événements considérés."""
    snap = _latest(db, cfg, territory)
    d = snap.details
    return {"gauge": snapshots.gauge_state(db, cfg, snap), "criteria": d["criteria"], "coverage": d["coverage"], "events": d["events"],
            "raw_palier": snap.raw_palier, "pending_downgrade": d.get("pending_downgrade"), "floor_annotated": d.get("floor_annotated"),
            "paliers": [{"value": p.value, "label": p.label, "definition": p.definition} for p in cfg.paliers]}


@app.get("/api/v1/gauge/history")
def gauge_history(territory: str | None = None, days: int = Query(30, ge=1, le=365), db: Session = Depends(get_session),
                  cfg: GaugeConfig = Depends(get_cfg)):
    tid = territory or next(t.id for t in cfg.territories if t.default)
    since = utcnow() - timedelta(days=days)
    rows = db.execute(select(IndexSnapshot, IndexPolicyVersion).join(IndexPolicyVersion, IndexPolicyVersion.id == IndexSnapshot.policy_version_id)
                      .where(IndexSnapshot.territory == tid, IndexSnapshot.computed_at >= since).order_by(IndexSnapshot.id)).all()
    points = [{"at": iso(s.computed_at), "palier": s.palier, "policy_version": v.label, "status": s.status} for s, v in rows]
    changes = []
    prev = None
    for _, v in rows:
        if prev is not None and v.label != prev.label:
            changes.append({"at": iso(v.created_at), "from_version": prev.label, "to_version": v.label, "note": v.reason, "handling": "tendance_suspendue"})
        prev = v
    return {"points": points, "method_changes": changes}


@app.get("/api/v1/dossiers")
def dossiers(territory: str | None = None, db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    return _latest(db, cfg, territory).details["dossiers"]


@app.get("/api/v1/dossiers/{dossier_id}")
def dossier(dossier_id: str, territory: str | None = None, db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    d = next((x for x in _latest(db, cfg, territory).details["dossiers"] if x["id"] == dossier_id), None)
    if d is None:
        raise policy.PolicyError(404, "unknown_dossier", dossier_id)
    return d


# ---- seuils versionnés ------------------------------------------------------------------------------------------------
class ThresholdChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    to: float


class ThresholdsPut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    changes: list[ThresholdChangeIn]
    reason: str = ""
    confirmed: bool = False
    expected_policy_version: str | None = None


class ThresholdsReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = ""
    confirmed: bool = False
    expected_policy_version: str | None = None


@app.get("/api/v1/thresholds")
def thresholds(db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    return policy.thresholds_state(db, cfg, utcnow())


@app.get("/api/v1/thresholds/history")
def thresholds_history(db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    return policy.history(db, cfg)


@app.get("/api/v1/thresholds/versions")
def thresholds_versions(db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    policy.ensure_plan_policy(db, cfg, utcnow())
    return policy.policy_versions(db)


@app.put("/api/v1/thresholds")
def thresholds_put(body: ThresholdsPut, actor: str = Depends(require_admin), db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    try:
        policy.change_thresholds(db, cfg, [c.model_dump() for c in body.changes], body.reason, body.confirmed, body.expected_policy_version, actor, utcnow())
    except policy.PolicyError:
        db.rollback()
        raise
    return policy.thresholds_state(db, cfg, utcnow())


@app.post("/api/v1/thresholds/reset")
def thresholds_reset(body: ThresholdsReset, actor: str = Depends(require_admin), db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    try:
        policy.reset_to_plan(db, cfg, body.reason, body.confirmed, body.expected_policy_version, actor, utcnow())
    except policy.PolicyError:
        db.rollback()
        raise
    return policy.thresholds_state(db, cfg, utcnow())


# ---- événements, revues -----------------------------------------------------------------------------------------------
@app.get("/api/v1/events")
def events(territory: str | None = None, status: str | None = None, include_excluded: bool = False, limit: int = Query(100, le=500),
           db: Session = Depends(get_session), cfg: GaugeConfig = Depends(get_cfg)):
    tid = territory or next(t.id for t in cfg.territories if t.default)
    terr = cfg.territory(tid)
    if terr is None:
        raise policy.PolicyError(404, "unknown_territory", tid)
    snap = db.scalar(select(IndexSnapshot).where(IndexSnapshot.territory == tid).order_by(IndexSnapshot.id.desc()).limit(1))
    q = select(Event).where(Event.zone_code.in_(sorted(terr.zones)) | Event.zone_code.is_(None)).order_by(desc(Event.ref_at)).limit(limit)
    if not include_excluded:
        q = q.where(Event.status != "historical")
    if status:
        q = q.where(Event.status == status)
    return [event_dict(db, e, snap) for e in db.scalars(q)]


@app.get("/api/v1/events/{event_id}")
def event(event_id: str, db: Session = Depends(get_session)):
    try:
        eid = int(event_id.removeprefix("EV-"))
    except ValueError:
        raise policy.PolicyError(404, "unknown_event", event_id)
    ev = db.get(Event, eid)
    if ev is None:
        raise policy.PolicyError(404, "unknown_event", event_id)
    snap = db.scalar(select(IndexSnapshot).where(IndexSnapshot.territory.in_(["FR", "flanc-est"])).order_by(IndexSnapshot.id.desc()).limit(1))
    return event_dict(db, ev, snap)


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    qualification: str
    details: dict = Field(default_factory=dict)
    note: str = ""


@app.post("/api/v1/events/{event_id}/review", status_code=201)
def event_review(event_id: str, body: ReviewIn, actor: str = Depends(require_admin), db: Session = Depends(get_session)):
    """Revue humaine : qualification d'un événement. Nécessaire pour dépasser le palier 25 à partir de prose."""
    try:
        eid = int(event_id.removeprefix("EV-"))
    except ValueError:
        raise policy.PolicyError(404, "unknown_event", event_id)
    try:
        a = annotate(db, eid, body.qualification, body.details, body.note, actor, utcnow())
    except policy.PolicyError:
        db.rollback()
        raise
    return {"id": a.id, "event_id": f"EV-{eid}", "qualification": a.qualification, "actor": a.actor, "created_at": iso(a.created_at)}


@app.get("/api/v1/reviews")
def reviews(status: str = "open", limit: int = Query(200, le=1000), db: Session = Depends(get_session)):
    rows = db.scalars(select(Review).where(Review.status == status).order_by(desc(Review.id)).limit(limit))
    return [{"id": r.id, "kind": r.kind, "document_id": r.document_id, "claim_id": r.claim_id, "event_id": f"EV-{r.event_id}" if r.event_id else None,
             "reason": r.reason, "status": r.status, "created_at": iso(r.created_at)} for r in rows]
