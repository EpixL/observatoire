"""Profil de couverture (plan §6.4) : décide si « 0 » est autorisé. Il n'estime PAS la part du monde observable.

Une famille est satisfaite si chaque source essentielle est à jour (dernier succès récent) ou remplacée par son secours.
Une source désactivée, bloquée ou en échec depuis trop longtemps n'est pas « à jour ». Le manque de données donne
« non calculable », jamais zéro.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.gauge.config import GaugeConfig
from app.models import ConnectorHealth, FetchRun, Source


def _fresh(session: Session, source_id: str, now: datetime, fresh_h: float) -> tuple[bool, str]:
    src = session.get(Source, source_id)
    if src is None:
        return False, f"{source_id} : source inconnue du registre"
    if not src.enabled:
        return False, f"{source_id} : désactivée"
    h = session.get(ConnectorHealth, source_id)
    if h is None or h.last_success_at is None:
        return False, f"{source_id} : aucun succès de collecte"
    age = now - h.last_success_at
    if age > timedelta(hours=fresh_h):
        return False, f"{source_id} : dernier succès il y a {age.total_seconds() / 3600:.1f} h (limite {fresh_h:g} h)"
    return True, f"{source_id} : à jour"


def evaluate_coverage(session: Session, cfg: GaugeConfig, territory_id: str, params: dict, now: datetime) -> dict:
    profile = cfg.profiles[territory_id]
    fresh_h = float(params["coverage_freshness_h"])
    families = []
    for fam in profile.families:
        details, ok_count = [], 0
        for source, backup in fam.essential:
            ok, why = _fresh(session, source, now, fresh_h)
            if not ok and backup:
                ok_b, why_b = _fresh(session, backup, now, fresh_h)
                if ok_b:
                    ok, why = True, f"{why} ; remplacée par son secours ({why_b})"
            ok_count += ok
            details.append(why)
        state = "ok" if ok_count == len(fam.essential) else ("degrade" if ok_count else "indisponible")
        families.append({"id": fam.id, "label": fam.label, "state": state, "detail": " · ".join(details)})

    required = int(params["coverage_families"])
    n_ok = sum(1 for f in families if f["state"] == "ok")
    families_ok = n_ok >= required and len(families) >= required

    first = session.scalar(select(func.min(FetchRun.started_at)).where(
        FetchRun.source_id == profile.baseline_source, FetchRun.outcome.in_(("ok", "not_modified"))))
    weeks_needed = float(params["baseline_weeks"])
    if first is None:
        baseline = {"sufficient": False, "detail": f"référence insuffisante : aucune collecte réussie de {profile.baseline_source}"}
    else:
        weeks = (now - first).total_seconds() / (7 * 86400)
        baseline = {"sufficient": weeks >= weeks_needed,
                    "detail": f"{weeks:.1f} semaine(s) de collecte réelle de {profile.baseline_source} sur {weeks_needed:g} requise(s)"
                              + ("" if weeks >= weeks_needed else " : référence insuffisante")}
    reasons = []
    if not families_ok:
        reasons.append(f"familles à jour : {n_ok} sur {required} requises")
    if not baseline["sufficient"]:
        reasons.append(baseline["detail"])
    return {"families": families, "families_ok": families_ok, "required_families": required, "baseline": baseline,
            "reasons": reasons, "partial": families_ok is False and n_ok > 0}
