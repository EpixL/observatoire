"""Seuils versionnés (plan §4 `index_policy_versions`) : chaque changement crée une NOUVELLE version, datée, avec acteur
et motif ; rien n'est jamais écrasé ni supprimé (triggers en base) ; les valeurs du plan sont toujours restaurables.

Garde-fous côté serveur (le dashboard les applique aussi mais ne les remplace pas) :
  confirmed obligatoire · motif ≥ 8 caractères · valeur dans [min, max] et sur le pas · version attendue à jour.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.gauge.config import GaugeConfig, ThresholdDef
from app.models import IndexPolicyVersion, ThresholdChange

MIN_REASON = 8


class PolicyError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _num(x) -> float:
    return float(x) if not isinstance(x, Decimal) else float(x)


def ensure_plan_policy(session: Session, cfg: GaugeConfig, now: datetime) -> IndexPolicyVersion:
    """Crée « seuils-v1 » = valeurs du plan, si aucune version n'existe encore."""
    first = session.scalar(select(IndexPolicyVersion).order_by(IndexPolicyVersion.version_no).limit(1))
    if first is not None:
        return first
    v = IndexPolicyVersion(version_no=1, label="seuils-v1", kind="plan", params=cfg.plan_params(),
                           reason="Valeurs du plan (docs/PLAN.md, §5 et §6)", actor="système", created_at=now)
    session.add(v)
    session.flush()
    return v


def current_policy(session: Session, cfg: GaugeConfig, now: datetime) -> IndexPolicyVersion:
    ensure_plan_policy(session, cfg, now)
    return session.scalar(select(IndexPolicyVersion).order_by(IndexPolicyVersion.version_no.desc()).limit(1))


def _validate_value(d: ThresholdDef, to) -> float:
    if isinstance(to, bool) or not isinstance(to, (int, float)):
        raise PolicyError(422, "invalid_value", f"« {d.key} » : valeur numérique attendue")
    to = float(to)
    if to < d.min or to > d.max:
        raise PolicyError(422, "out_of_bounds", f"« {d.key} » doit rester entre {d.min:g} et {d.max:g} {d.unit}")
    steps = (to - d.min) / d.step
    if abs(steps - round(steps)) > 1e-9:
        raise PolicyError(422, "off_step", f"« {d.key} » doit être un multiple de {d.step:g} à partir de {d.min:g}")
    return to


def _check_common(session: Session, cfg: GaugeConfig, reason: str, confirmed: bool, expected_version: str | None, now: datetime):
    if confirmed is not True:
        raise PolicyError(422, "confirmation_required", "confirmation explicite obligatoire (confirmed: true)")
    if not isinstance(reason, str) or len(reason.strip()) < MIN_REASON:
        raise PolicyError(422, "reason_required", f"motif obligatoire (au moins {MIN_REASON} caractères)")
    cur = current_policy(session, cfg, now)
    if expected_version is not None and expected_version != cur.label:
        raise PolicyError(409, "stale_policy_version", f"version attendue {expected_version}, version actuelle {cur.label} : recharger avant de modifier")
    return cur


def _create_version(session: Session, cur: IndexPolicyVersion, new_params: dict, changes: list[tuple[str, float, float]],
                    kind: str, reason: str, actor: str, now: datetime) -> IndexPolicyVersion:
    n = cur.version_no + 1
    v = IndexPolicyVersion(version_no=n, label=f"seuils-v{n}", kind=kind, params=new_params, reason=reason.strip(), actor=actor, created_at=now)
    session.add(v)
    session.flush()
    for key, old, new in changes:
        session.add(ThresholdChange(policy_version_id=v.id, key=key, from_value=old, to_value=new, kind=kind, reason=reason.strip(), actor=actor, at=now))
    session.flush()
    return v


def change_thresholds(session: Session, cfg: GaugeConfig, changes: list[dict], reason: str, confirmed: bool,
                      expected_version: str | None, actor: str, now: datetime) -> IndexPolicyVersion:
    cur = _check_common(session, cfg, reason, confirmed, expected_version, now)
    if not changes:
        raise PolicyError(422, "no_change", "aucun changement fourni")
    params = dict(cur.params)
    applied: list[tuple[str, float, float]] = []
    seen = set()
    for ch in changes:
        key = ch.get("key")
        defs = next((t for t in cfg.thresholds if t.key == key), None)
        if defs is None:
            raise PolicyError(422, "unknown_key", f"seuil inconnu : {key!r}")
        if key in seen:
            raise PolicyError(422, "duplicate_key", f"seuil répété : {key!r}")
        seen.add(key)
        to = _validate_value(defs, ch.get("to"))
        old = _num(params[key])
        if to != old:
            params[key] = to
            applied.append((key, old, to))
    if not applied:
        raise PolicyError(422, "no_change", "les valeurs demandées sont déjà en vigueur")
    return _create_version(session, cur, params, applied, "modification", reason, actor, now)


def reset_to_plan(session: Session, cfg: GaugeConfig, reason: str, confirmed: bool, expected_version: str | None,
                  actor: str, now: datetime) -> IndexPolicyVersion:
    """Retour aux valeurs du plan, enregistré comme un changement de plus (historique intact)."""
    cur = _check_common(session, cfg, reason, confirmed, expected_version, now)
    plan = cfg.plan_params()
    diff = [(k, _num(cur.params[k]), float(plan[k])) for k in plan if _num(cur.params[k]) != float(plan[k])]
    if not diff:
        raise PolicyError(422, "already_plan", "les seuils sont déjà aux valeurs du plan")
    return _create_version(session, cur, {k: float(v) for k, v in plan.items()}, diff, "retour_plan", reason, actor, now)


# --------------------------------------------------------------------------------------------------------------------
def history(session: Session, cfg: GaugeConfig, limit: int = 200) -> list[dict]:
    rows = session.execute(
        select(ThresholdChange, IndexPolicyVersion).join(IndexPolicyVersion, IndexPolicyVersion.id == ThresholdChange.policy_version_id)
        .order_by(ThresholdChange.id.desc()).limit(limit)).all()
    labels = {t.key: t.label for t in cfg.thresholds}
    return [{"id": f"T-{c.id}", "at": c.at.isoformat(), "kind": c.kind, "key": c.key, "label": labels.get(c.key, c.key),
             "from": _num(c.from_value), "to": _num(c.to_value), "reason": c.reason, "actor": c.actor, "policy_version": v.label}
            for c, v in rows]


def thresholds_state(session: Session, cfg: GaugeConfig, now: datetime) -> dict:
    """Forme attendue par le dashboard (ThresholdsState) : valeur courante ET valeur du plan, limites, pas, historique."""
    cur = current_policy(session, cfg, now)
    items = [{"key": t.key, "label": t.label, "description": t.description, "unit": t.unit, "plan_value": t.plan,
              "value": _num(cur.params[t.key]), "min": t.min, "max": t.max, "step": t.step, "affects": t.affects} for t in cfg.thresholds]
    return {"policy_version": cur.label, "plan_version": "seuils-v1", "items": items, "history": history(session, cfg)}


def policy_versions(session: Session) -> list[dict]:
    return [{"label": v.label, "version_no": v.version_no, "kind": v.kind, "created_at": v.created_at.isoformat(), "actor": v.actor,
             "reason": v.reason, "params": v.params}
            for v in session.scalars(select(IndexPolicyVersion).order_by(IndexPolicyVersion.version_no.desc()))]
