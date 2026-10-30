"""Outils des tests du lot 3. Tout est FICTIF ; seuls les mécanismes sont testés."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.db import session_scope
from app.gauge import policy
from app.gauge.annotations import annotate
from app.gauge.config import load_gauge_config
from app.gauge.snapshots import evaluate_all
from app.models import ConnectorHealth, Event, FetchRun, IndexSnapshot

from conftest import ROOT
from corpus_helpers import T0, add_source, claims, events, process, put

CFG = load_gauge_config(str(ROOT / "config"))
ESSENTIAL = ("easa-czib", "france-diplomatie-cv", "france24-fr", "ioda-fr")


def coverage_ok(factory, now, baseline_weeks: float = 9):
    """Les 3 familles à jour + N semaines de collecte réelle de la source de référence."""
    with session_scope(factory) as s:
        for sid in ESSENTIAL:
            s.get(ConnectorHealth, sid).last_success_at = now
        s.add(FetchRun(source_id="ioda-fr", started_at=now - timedelta(weeks=baseline_weeks), outcome="ok"))


def evaluate(factory, at):
    with session_scope(factory) as s:
        snaps = evaluate_all(s, CFG, at)
        for x in snaps:
            s.expunge(x)
        return {x.territory: x for x in snaps}


def pal(snap):
    return snap.palier if snap.status == "calculable" else None


def ioda_outage(factory, code="FR", at=T0, ext_suffix="a"):
    epoch = int(at.timestamp())
    put(factory, "ioda-fr", f"ioda|country/{code}|{epoch}|{ext_suffix}", f"Interruption Internet — country/{code}", "",
        text=("Interruption Internet détectée par IODA (mesure technique ; ne prouve ni cyberattaque ni acte hostile).\n"
              f"Entité : country/{code}\nDébut : {at:%Y-%m-%dT%H:%M:%SZ}\nSource de mesure : {ext_suffix}"),
        structured={"entity_type": "country", "entity_code": code, "location": f"country/{code}", "start_epoch": epoch,
                    "duration_s": 900, "score": 500.0, "datasource": ext_suffix}, at=at)


def official_closure(factory, sid="gouv-t", at=T0, text="Le ministère des Transports annonce la fermeture de l'aéroport de Mayotte."):
    add_source(factory, sid, kind="autorite", org="Ministère fictif des Transports")
    put(factory, sid, f"c-{at.timestamp()}", "Communiqué", text, published=f"{at:%a, %d %b %Y %H:%M:%S} GMT", at=at)


def vigipirate(factory, level_text: str, at):
    put(factory, "sgdsn-vigipirate", "vigi", "Plan Vigipirate", "", text=f"Plan Vigipirate\nPosture en cours : {level_text}. Cette posture s'applique sur le territoire national.", at=at)


def annotate_event(factory, event_id, qualification, details=None, note="revue humaine de test", actor="David", at=T0):
    with session_scope(factory) as s:
        return annotate(s, event_id, qualification, details, note, actor, at).id


FULL = {"facts_established": True, "zone_established": True, "period_established": True, "actor_established": True, "state_actor": True}
