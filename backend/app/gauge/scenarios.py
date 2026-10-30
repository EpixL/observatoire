"""Les trois dossiers d'analyse (plan §2), par territoire. Ils ne sont additionnés ni entre eux ni à la jauge.

Sans moteur d'hypothèses (reste du lot 3, non fait) : le dossier donne l'état (indéterminé / en veille / actif), les
événements retenus, les origines indépendantes et ce qui manque. `hypotheses` est volontairement vide.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.events.dedup import count_independent_origins
from app.gauge.config import GaugeConfig, Territory

RULES_VERSION = "dossiers-1.0"
SCENARIOS = [
    {"id": "D-CIV", "title": "Perturbation majeure de services civils", "horizon": "présent à 72 heures", "hours": 72,
     "types": {"internet_outage", "civil_disruption", "closure_restriction", "cyber_advisory"}},
    {"id": "D-REG", "title": "Dégradation régionale de sécurité", "horizon": "7 jours", "hours": 24 * 7,
     "types": {"hostile_act_alleged", "security_posture_change", "travel_advice_change", "airspace_advisory", "rhetoric", "military_exercise",
               "nuclear_radiological_mention"}},
    {"id": "D-EXT", "title": "Extension géographique d'un conflit", "horizon": "30 jours", "hours": 24 * 30,
     "types": {"hostile_act_alleged", "airspace_advisory"}},
]


def build_dossiers(session: Session, cfg: GaugeConfig, terr: Territory, params: dict, coverage_ok: bool, now: datetime, res) -> list[dict]:
    out = []
    for sc in SCENARIOS:
        horizon = timedelta(hours=sc["hours"])
        evs = [e for e in res.events if e.type in sc["types"] and e.role != "ignored" and now - e.last_update_at <= horizon]
        ids = sorted(e.id for e in evs)
        origins = count_independent_origins(session, sorted({d for e in evs for d in e.doc_ids})) if evs else 0
        zones = sorted({e.zone for e in evs if e.zone})
        missing, contradicts = [], []
        if not coverage_ok:
            missing.append("Profil de couverture non satisfait : aucune conclusion rassurante possible")
        weather = [e for e in res.events if e.type == "weather_event" and now - e.last_update_at <= horizon]
        if weather and sc["id"] == "D-CIV":
            contradicts.append(f"{len(weather)} événement(s) météo dans la fenêtre : explication ordinaire possible, cause commune à examiner")
        if sc["id"] == "D-EXT" and evs and len(zones) < 2:
            missing.append("Un seul territoire concerné : pas d'extension géographique documentée")
        state = "indetermine" if not coverage_ok and not evs else ("actif" if evs else "veille")
        summary = (f"{len(evs)} événement(s) dans la fenêtre de {sc['horizon']}, {origins} origine(s) indépendante(s), zones : {', '.join(zones) or 'aucune'}."
                   if evs else ("Données insuffisantes pour conclure." if not coverage_ok else f"Aucun événement retenu sur {sc['horizon']}."))
        out.append({
            "id": sc["id"], "title": sc["title"], "zone": terr.label, "horizon": sc["horizon"], "state": state, "summary": summary,
            "rules_version": RULES_VERSION, "event_ids": ids, "updated_at": now.isoformat(),
            "rule_interpretation": {
                "conclusion": summary, "supports": [f"{e.title[:120]} — {e.why}" for e in evs[:8]],
                "contradicts": contradicts, "missing": missing + ["Moteur d'hypothèses non implémenté (lot 3, reste à faire)"],
                "hypotheses": [],
            },
        })
    return out
