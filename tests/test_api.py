"""API lot 3 : seuils (lecture, écriture protégée, historique, réinitialisation), jauge, état des sources, revue humaine."""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from corpus_helpers import T0, add_source, events, process, put
from gauge_helpers import FULL, coverage_ok, evaluate, ioda_outage

AUTH = {"Authorization": "Bearer jeton-de-test"}


@pytest.fixture()
def client(sources, db_url, monkeypatch):
    from conftest import ROOT
    import app.api.deps as deps
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("CONFIG_DIR", str(ROOT / "config"))
    monkeypatch.setenv("ADMIN_TOKEN", "jeton-de-test")
    monkeypatch.setenv("ADMIN_ACTOR", "David")
    monkeypatch.setattr(deps, "_factory", None)
    from app.api.main import app
    with TestClient(app) as c:
        yield c


def test_thresholds_read_is_public_and_complete(client):
    r = client.get("/api/v1/thresholds")
    assert r.status_code == 200
    j = r.json()
    assert j["policy_version"] == "seuils-v1" and j["plan_version"] == "seuils-v1" and j["history"] == []
    keys = {i["key"] for i in j["items"]}
    assert {"anomaly_mad_k", "origins_for_25", "events_for_40", "families_for_40", "downgrade_evals", "weak_signal_expiry_h", "coverage_families", "baseline_weeks"} <= keys
    i = next(i for i in j["items"] if i["key"] == "events_for_40")
    assert {"value", "plan_value", "min", "max", "step", "unit", "affects"} <= set(i)


def test_writes_require_a_token_and_are_disabled_without_one(client, monkeypatch):
    body = {"changes": [{"key": "events_for_40", "to": 3}], "reason": "essai de sensibilité", "confirmed": True}
    assert client.put("/api/v1/thresholds", json=body).status_code == 401
    assert client.put("/api/v1/thresholds", json=body, headers={"Authorization": "Bearer mauvais"}).json()["error"]["code"] == "unauthorized"
    monkeypatch.delenv("ADMIN_TOKEN")
    r = client.put("/api/v1/thresholds", json=body, headers=AUTH)
    assert r.status_code == 503 and r.json()["error"]["code"] == "writes_disabled"       # sûr par défaut


def test_put_thresholds_creates_version_and_history_then_reset(client):
    body = {"changes": [{"key": "events_for_40", "to": 3}], "reason": "essai de sensibilité", "confirmed": True, "expected_policy_version": "seuils-v1"}
    r = client.put("/api/v1/thresholds", json=body, headers=AUTH)
    assert r.status_code == 200 and r.json()["policy_version"] == "seuils-v2"
    h = client.get("/api/v1/thresholds/history").json()
    assert h[0]["actor"] == "David" and (h[0]["from"], h[0]["to"], h[0]["key"]) == (2, 3, "events_for_40")
    # version périmée : 409 ; hors bornes : 422 ; format d'erreur du contrat
    stale = client.put("/api/v1/thresholds", json=body, headers=AUTH)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "stale_policy_version"
    bad = client.put("/api/v1/thresholds", json={**body, "expected_policy_version": "seuils-v2", "changes": [{"key": "events_for_40", "to": 99}]}, headers=AUTH)
    assert bad.status_code == 422 and set(bad.json()["error"]) == {"code", "message"}
    r = client.post("/api/v1/thresholds/reset", json={"reason": "retour aux valeurs du plan", "confirmed": True, "expected_policy_version": "seuils-v2"}, headers=AUTH)
    assert r.status_code == 200 and r.json()["policy_version"] == "seuils-v3"
    assert [x["kind"] for x in client.get("/api/v1/thresholds/history").json()] == ["retour_plan", "modification"]
    versions = client.get("/api/v1/thresholds/versions").json()
    assert [v["label"] for v in versions] == ["seuils-v3", "seuils-v2", "seuils-v1"]


def test_gauge_not_evaluated_then_shape_and_unknown_territory(client, sources):
    assert client.get("/api/v1/gauge").json()["error"]["code"] == "not_evaluated"
    assert client.get("/api/v1/gauge?territory=ZZ").status_code == 404
    bad = client.get("/api/v1/gauge/history?days=0")
    assert bad.status_code == 422 and set(bad.json()["error"]) == {"code", "message"}      # même format d'erreur partout
    evaluate(sources, T0 + timedelta(minutes=10))
    g = client.get("/api/v1/gauge").json()
    assert g["territory"]["id"] == "FR" and g["status"] == "non_calculable" and g["palier"] is None      # inconnu, jamais 0
    assert g["policy"]["version"] == "seuils-v1" and g["trend_24h"]["direction"] == "non_comparable"
    d = client.get("/api/v1/gauge/detail?territory=flanc-est").json()
    assert [c["palier"] for c in d["criteria"]] == [0, 10, 25, 40, 55, 70, 85, 100] and d["coverage"]["profile_satisfied"] is False
    h = client.get("/api/v1/gauge/history?territory=FR&days=365").json()
    assert h["points"][0]["palier"] is None and h["points"][0]["status"] == "non_calculable"


def test_events_dossiers_and_sources_status(client, sources):
    coverage_ok(sources, T0 + timedelta(minutes=10))
    ioda_outage(sources)
    process(sources)
    evaluate(sources, T0 + timedelta(minutes=10))
    g = client.get("/api/v1/gauge").json()
    assert g["status"] == "calculable" and g["palier"] == 25
    evs = client.get("/api/v1/events").json()
    assert len(evs) == 1
    e = evs[0]
    assert e["id"].startswith("EV-") and e["layer"] == "reseaux" and e["reading_status"] == "retenu" and e["fictional"] is False
    assert e["location"]["kind"] == "point" and e["location"]["precision"] == "pays" and e["effect"]["palier"] == 25
    assert e["sources"][0]["official"] is False and e["independent_origins"] == 1
    assert client.get(f"/api/v1/events/{e['id']}").json()["id"] == e["id"]
    assert {d["id"] for d in client.get("/api/v1/dossiers").json()} == {"D-CIV", "D-REG", "D-EXT"}
    src = {s["id"]: s for s in client.get("/api/v1/sources/status").json()}
    assert src["ioda-fr"]["verdict"] == "SKIPPED"                                    # jamais interrogée dans ce test
    assert src["sgdsn-vigipirate"]["state"] == "desactivee" and "Gcore" in src["sgdsn-vigipirate"]["verdict_reason"]
    assert src["france-diplomatie-rss"]["verdict"] == "SKIPPED" and "403" in src["france-diplomatie-rss"]["verdict_reason"]
    assert {"id", "name", "state", "last_attempt", "verdict", "verdict_reason"} <= set(src["ioda-fr"])


def test_sources_status_maps_health_states(client, sources):
    from app.db import session_scope
    from app.models import ConnectorHealth
    with session_scope(sources) as s:
        for sid, st in (("ioda-fr", "ok"), ("easa-czib", "degraded"), ("france24-fr", "failing"), ("cert-fr-alertes", "blocked"), ("cert-fr-actualite", "rate_limited")):
            h = s.get(ConnectorHealth, sid)
            h.state, h.last_error = st, f"erreur {st}"
    m = {s["id"]: (s["state"], s["verdict"]) for s in client.get("/api/v1/sources/status").json()}
    assert m["ioda-fr"] == ("ok", "OK") and m["easa-czib"] == ("retard", "OK") and m["france24-fr"] == ("indisponible", "FAIL")
    assert m["cert-fr-alertes"] == ("indisponible", "BLOCKED") and m["cert-fr-actualite"] == ("indisponible", "FAIL")


def test_human_review_endpoint_drives_the_gauge(client, sources):
    coverage_ok(sources, T0 + timedelta(minutes=10))
    add_source(sources, "media-h")
    put(sources, "media-h", "h", "Attaque à Mayotte", "Une attaque de drones a visé un entrepôt à Mayotte, selon des témoins.", published="Wed, 28 Oct 2026 11:00:00 GMT")
    process(sources)
    ev = events(sources, event_type="hostile_act_alleged")[0]
    pending = client.get("/api/v1/reviews").json()
    assert any(r["event_id"] == f"EV-{ev.id}" or r["kind"] == "claim_qualification" for r in pending)
    assert client.post(f"/api/v1/events/EV-{ev.id}/review", json={"qualification": "armed_attack", "details": FULL, "note": "sources croisées"}).status_code == 401
    bad = client.post(f"/api/v1/events/EV-{ev.id}/review", json={"qualification": "armed_attack", "details": {}, "note": "sources croisées"}, headers=AUTH)
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "annotation_incomplete"
    ok = client.post(f"/api/v1/events/EV-{ev.id}/review", json={"qualification": "armed_attack", "details": FULL, "note": "sources croisées et recoupées"}, headers=AUTH)
    assert ok.status_code == 201 and ok.json()["actor"] == "David"
    assert client.get("/api/v1/reviews").json() == [] or all(r["kind"] != "claim_qualification" for r in client.get("/api/v1/reviews").json())
    evaluate(sources, T0 + timedelta(minutes=20))
    assert client.get("/api/v1/gauge").json()["palier"] == 85
    detail = client.get(f"/api/v1/events/EV-{ev.id}").json()
    assert detail["annotations"][0]["qualification"] == "armed_attack"
    assert client.post("/api/v1/events/EV-99999/review", json={"qualification": "resolved", "note": "sans objet ici"}, headers=AUTH).status_code == 404
