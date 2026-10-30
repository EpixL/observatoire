"""Lot 1 — collecte : connecteurs sur fixtures FICTIVES servies par un faux serveur HTTP (aucun réseau)."""
from __future__ import annotations

import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.collectors.runner import due_source_ids, run_due, run_source, sanitize_error
from app.db import session_scope
from app.models import ConnectorHealth, Document, DocumentVersion, FetchRun, Observation, Source

from conftest import fixture_bytes, make_client


def serve(routes: dict, calls: list | None = None):
    """routes : url -> (status, headers, body) ou callable(request) -> httpx.Response."""
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        entry = routes.get(str(request.url))
        if entry is None:
            return httpx.Response(404, text="not found")
        if callable(entry):
            return entry(request)
        status, headers, body = entry
        return httpx.Response(status, headers=headers, content=body)
    return handler


CERT = "https://cert.cyber.gouv.fr/alerte/feed/"
VIGI = "https://www.sgdsn.gouv.fr/nos-missions/proteger-la-population/vigipirate"
DIPLO = "https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs"
EASA = "https://www.easa.europa.eu/en/domains/air-operations/czibs"
F24 = "https://www.france24.com/fr/rss"
XML = {"content-type": "application/rss+xml"}
HTML = {"content-type": "text/html; charset=utf-8"}


def health(factory, sid):
    with session_scope(factory) as s:
        h = s.get(ConnectorHealth, sid)
        s.expunge(h)
        return h


def test_feed_first_run_creates_documents_and_versions(sources, settings, clock, rng):
    http = make_client(serve({CERT: (200, {**XML, "etag": '"v1"'}, fixture_bytes("feeds/cert_fr_alertes.xml"))}))
    res = run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    assert res.outcome == "ok"
    with session_scope(sources) as s:
        docs = s.scalars(select(Document).order_by(Document.external_id)).all()
        assert [d.external_id for d in docs] == ["CERTFR-2026-ALE-001", "CERTFR-2026-ALE-002"]
        d = docs[0]
        assert d.first_seen_at == clock.now and d.version_count == 1
        v = s.get(DocumentVersion, d.current_version_id)
        assert v.change_kind == "initial" and v.available_at == clock.now
        assert v.published_at.isoformat().startswith("2026-10-27T13:30")  # +0100 -> UTC
        assert v.snapshot_path and (settings.snapshot_dir / v.snapshot_path).exists()
    h = health(sources, "cert-fr-alertes")
    assert h.state == "ok" and h.etag == '"v1"' and h.last_new_at == clock.now and h.consecutive_failures == 0


def test_conditional_get_sends_etag_and_304_creates_nothing(sources, settings, clock, rng):
    calls: list = []
    state = {"n": 0}

    def feed(request):
        state["n"] += 1
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304, headers={"etag": '"v1"'})
        return httpx.Response(200, headers={**XML, "etag": '"v1"'}, content=fixture_bytes("feeds/cert_fr_alertes.xml"))

    http = make_client(serve({CERT: feed}, calls))
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    clock.advance(minutes=20)
    res = run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    assert res.outcome == "not_modified"
    assert calls[-1].headers["if-none-match"] == '"v1"'
    with session_scope(sources) as s:
        assert len(s.scalars(select(DocumentVersion)).all()) == 2
        run = s.scalars(select(FetchRun).order_by(FetchRun.id.desc())).first()
        assert run.outcome == "not_modified" and run.new_documents == 0
    assert health(sources, "cert-fr-alertes").state == "ok"


def test_republished_identical_feed_without_etag_creates_no_new_version(sources, settings, clock, rng):
    http = make_client(serve({CERT: (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml"))}))
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    first_seen = clock.now
    clock.advance(hours=1)
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    with session_scope(sources) as s:
        assert len(s.scalars(select(DocumentVersion)).all()) == 2
        assert all(d.first_seen_at == first_seen and d.last_seen_at == clock.now for d in s.scalars(select(Document)))


def test_page_material_change_vs_cosmetic_vs_chrome(sources, settings, clock, rng):
    pages = {"body": fixture_bytes("pages/diplomatie_cv_v1.html")}
    http = make_client(serve({DIPLO: lambda r: httpx.Response(200, headers=HTML, content=pages["body"])}))
    run_source(sources, "france-diplomatie-cv", http, settings, clock=clock, rng=rng)

    def step(fixture):
        clock.advance(minutes=20)
        pages["body"] = fixture_bytes(fixture)
        run_source(sources, "france-diplomatie-cv", http, settings, clock=clock, rng=rng)
        with session_scope(sources) as s:
            return [v.change_kind for v in s.scalars(select(DocumentVersion).order_by(DocumentVersion.version_no))]

    assert step("pages/diplomatie_cv_v1_chrome.html") == ["initial"]          # menu/cookies : texte extrait identique
    assert step("pages/diplomatie_cv_v1_dateonly.html") == ["initial", "cosmetic"]  # seule la date « mis à jour » change
    assert step("pages/diplomatie_cv_v2_material.html") == ["initial", "cosmetic", "material"]
    with session_scope(sources) as s:
        doc = s.scalars(select(Document)).one()
        assert doc.version_count == 3
        v3 = s.get(DocumentVersion, doc.current_version_id)
        assert "formellement déconseillé" in v3.text.lower()
        assert doc.published_at is None and "missing" in doc.date_flags   # on n'invente pas de date
    h = health(sources, "france-diplomatie-cv")
    assert h.last_new_at == clock.now  # la nouveauté matérielle est enregistrée


def test_missing_date_future_date_flags(sources, settings, clock, rng):
    feed = fixture_bytes("feeds/france24_une.xml").replace(b"Wed, 28 Oct 2026 11:00:00 GMT", b"Fri, 01 Jan 2027 11:00:00 GMT")
    http = make_client(serve({F24: (200, XML, feed)}))
    run_source(sources, "france24-fr", http, settings, clock=clock, rng=rng)
    with session_scope(sources) as s:
        by_id = {d.external_id: d for d in s.scalars(select(Document))}
        assert "future" in by_id["fx-24-0001"].date_flags and by_id["fx-24-0001"].published_at is not None
        assert by_id["fx-24-0002"].published_at is None and by_id["fx-24-0002"].date_flags == ["missing"]
        assert by_id["fx-24-0001"].canonical_url == "https://www.france24.com/fr/europe/20261028-fermeture-aeroport-exemple"


def test_error_backoff_and_failing_state_after_two_cycles(sources, settings, clock, rng):
    http = make_client(serve({CERT: (500, {}, b"boom")}))
    delays = []
    for i in range(4):
        run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
        h = health(sources, "cert-fr-alertes")
        delays.append((h.next_run_at - clock.now).total_seconds())
        assert h.consecutive_failures == i + 1
        assert h.state == ("degraded" if i == 0 else "failing")
        clock.now = h.next_run_at
    assert delays[0] >= 900 and delays[0] <= 900 * 1.2          # jamais sous l'intervalle nominal
    assert delays[3] >= 480                                     # croissance exponentielle plafonnée
    with session_scope(sources) as s:
        assert s.scalars(select(Document)).first() is None      # aucune donnée fabriquée
        assert s.scalar(text("select count(*) from fetch_runs where outcome='error'")) == 4


def test_recovery_resets_failures(sources, settings, clock, rng):
    mode = {"ok": False}
    http = make_client(serve({CERT: lambda r: httpx.Response(200, headers=XML, content=fixture_bytes("feeds/cert_fr_alertes.xml")) if mode["ok"] else httpx.Response(502)}))
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    assert health(sources, "cert-fr-alertes").state == "failing"
    mode["ok"] = True
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    h = health(sources, "cert-fr-alertes")
    assert (h.state, h.consecutive_failures, h.last_error) == ("ok", 0, None)


def test_rate_limited_is_a_technical_state_and_honours_retry_after(sources, settings, clock, rng):
    http = make_client(serve({CERT: (429, {"retry-after": "7200"}, b"")}))
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    h = health(sources, "cert-fr-alertes")
    assert h.state == "rate_limited" and h.last_http_status == 429
    assert (h.next_run_at - clock.now) >= timedelta(seconds=7200)


def test_not_found_backs_off_hours(sources, settings, clock, rng):
    http = make_client(serve({}))  # tout renvoie 404
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    assert (health(sources, "cert-fr-alertes").next_run_at - clock.now) >= timedelta(hours=6)


def test_redirect_to_foreign_domain_is_rejected(sources, settings, clock, rng):
    def redirect(request):
        return httpx.Response(302, headers={"location": "https://evil.example/feed"})
    http = make_client(serve({CERT: redirect, "https://evil.example/feed": (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml"))}))
    res = run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    assert res.outcome == "domain_rejected"
    with session_scope(sources) as s:
        assert s.scalars(select(Document)).first() is None


def test_redirect_within_allowed_domains_is_followed(sources, settings, clock, rng):
    new = "https://www.cert.ssi.gouv.fr/alerte/feed/"
    http = make_client(serve({
        CERT: lambda r: httpx.Response(301, headers={"location": new}),
        new: (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml")),
    }))
    assert run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng).outcome == "ok"


def test_html_error_page_instead_of_feed_is_an_error_not_empty(sources, settings, clock, rng):
    http = make_client(serve({CERT: (200, HTML, b"<html><body>Maintenance</body></html>")}))
    res = run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    assert res.outcome == "error" and "flux" in res.error


def test_robots_disallow_blocks_html_pages_but_not_feeds(sources, settings, clock, rng):
    routes = {
        "https://www.diplomatie.gouv.fr/robots.txt": (200, {}, fixture_bytes("pages/robots_disallow_all.txt")),
        DIPLO: (200, HTML, fixture_bytes("pages/diplomatie_cv_v1.html")),
        CERT: (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml")),
    }
    http = make_client(serve(routes), respect_robots=True)
    assert run_source(sources, "france-diplomatie-cv", http, settings, clock=clock, rng=rng).outcome == "blocked"
    assert health(sources, "france-diplomatie-cv").state == "blocked"
    assert run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng).outcome == "ok"


def test_robots_allow_lets_pages_through(sources, settings, clock, rng):
    routes = {
        "https://www.diplomatie.gouv.fr/robots.txt": (200, {}, fixture_bytes("pages/robots_allow.txt")),
        DIPLO: (200, HTML, fixture_bytes("pages/diplomatie_cv_v1.html")),
    }
    http = make_client(serve(routes), respect_robots=True)
    assert run_source(sources, "france-diplomatie-cv", http, settings, clock=clock, rng=rng).outcome == "ok"


def only_france(factory, sid="ioda-fr"):
    """La config réelle interroge 9 entités ; ces tests de forme n'en servent qu'une."""
    with session_scope(factory) as s:
        src = s.get(Source, sid)
        src.options = {**src.options, "entities": [{"type": "country", "code": "FR"}]}


def test_ioda_events_documents_and_observations(sources, settings, clock, rng):
    only_france(sources)
    url = lambda r: httpx.Response(200, headers={"content-type": "application/json"}, content=fixture_bytes("json/ioda_events_fr.json"))
    seen = []
    def handler(request):
        seen.append(str(request.url))
        return url(request)
    http = make_client(handler)
    res = run_source(sources, "ioda-fr", http, settings, clock=clock, rng=rng)
    assert res.outcome == "ok" and "entityType=country&entityCode=FR" in seen[0]
    with session_scope(sources) as s:
        docs = s.scalars(select(Document)).all()
        assert len(docs) == 2
        v = s.get(DocumentVersion, docs[0].current_version_id)
        assert "ne prouve ni cyberattaque" in v.text and v.structured["datasource"] in ("bgp", "ping-slash24")
        assert docs[0].published_at is None   # IODA mesure : pas de date de publication inventée
        obs = s.scalars(select(Observation)).all()
        assert len(obs) == 2 and {o.metric for o in obs} == {"outage_event_score"}
    # rejouer la même réponse ne duplique ni documents ni observations
    clock.advance(minutes=15)
    run_source(sources, "ioda-fr", http, settings, clock=clock, rng=rng)
    with session_scope(sources) as s:
        assert len(s.scalars(select(Observation)).all()) == 2 and len(s.scalars(select(DocumentVersion)).all()) == 2


def test_ioda_unexpected_schema_is_error_never_empty_success(sources, settings, clock, rng):
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/json"}, content=fixture_bytes("json/ioda_bad_schema.json")))
    res = run_source(sources, "ioda-fr", http, settings, clock=clock, rng=rng)
    assert res.outcome == "error" and "schema_unexpected" in res.error
    assert health(sources, "ioda-fr").state == "degraded"


def test_ioda_quota_exhausted_is_rate_limited_not_zero_outages(sources, settings, clock, rng):
    http = make_client(lambda r: httpx.Response(429, headers={"retry-after": "3600"}))
    res = run_source(sources, "ioda-fr", http, settings, clock=clock, rng=rng)
    assert res.outcome == "rate_limited"
    assert health(sources, "ioda-fr").state == "rate_limited"
    with session_scope(sources) as s:
        assert s.scalars(select(Observation)).first() is None


def test_ioda_genuinely_empty_is_ok_with_no_documents(sources, settings, clock, rng):
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/json"}, content=fixture_bytes("json/ioda_events_empty.json")))
    res = run_source(sources, "ioda-fr", http, settings, clock=clock, rng=rng)
    assert res.outcome == "ok" and res.items == []


def test_connector_exception_is_isolated(sources, settings, clock, rng, monkeypatch):
    from app import collectors
    class Boom:
        def fetch(self, *a, **k):
            raise RuntimeError("bug du connecteur")
    monkeypatch.setitem(collectors.CONNECTORS, "feed", Boom)
    from app.collectors import runner
    monkeypatch.setattr(runner, "CONNECTORS", collectors.CONNECTORS)
    http = make_client(serve({}))
    res = run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    assert res.outcome == "error" and health(sources, "cert-fr-alertes").state == "degraded"


def test_run_due_respects_next_run_and_skips_disabled(sources, settings, clock, rng):
    http = make_client(serve({}))
    due = due_source_ids(sources, clock.now)
    assert "nato-news" not in due and "eeas-presse" not in due and len(due) == 6
    out = run_due(sources, http, settings, clock=clock, rng=rng)
    assert set(out) == set(due)
    assert due_source_ids(sources, clock.now) == []                       # tous reprogrammés dans le futur
    clock.advance(hours=8)
    assert len(due_source_ids(sources, clock.now)) == 6


def test_jitter_spreads_next_runs(sources, settings, clock):
    import random
    http = make_client(serve({CERT: (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml"))}))
    gaps = set()
    for seed in range(5):
        run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=random.Random(seed))
        gaps.add(round((health(sources, "cert-fr-alertes").next_run_at - clock.now).total_seconds()))
    assert len(gaps) > 1 and all(720 <= g <= 1080 for g in gaps)          # 900 s ± 20 %


def test_first_seen_at_is_immutable_and_versions_append_only(sources, settings, clock, rng):
    http = make_client(serve({CERT: (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml"))}))
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    with pytest.raises(DBAPIError, match="immuable"):
        with session_scope(sources) as s:
            s.execute(text("update documents set first_seen_at = now()"))
    with pytest.raises(DBAPIError, match="ajout seul"):
        with session_scope(sources) as s:
            s.execute(text("update document_versions set text = 'réécrit'"))


def test_sanitize_error_hides_secrets():
    assert "abc123" not in sanitize_error("GET https://x/api?key=abc123&b=2 failed")
    assert "s3cr3t" not in sanitize_error("https://x/?token=s3cr3t")


def test_registry_sync_is_idempotent_and_keeps_health(sources):
    from app.collectors.registry import load_source_configs, sync_sources
    from conftest import ROOT
    with session_scope(sources) as s:
        h = s.get(ConnectorHealth, "ioda-fr")
        h.consecutive_failures = 3
    with session_scope(sources) as s:
        out = sync_sources(s, load_source_configs(ROOT / "config" / "sources.yaml"))
        assert out == {"created": 0, "updated": 11}
    assert health(sources, "ioda-fr").consecutive_failures == 3


def test_verified_status_requires_dated_evidence_and_disabled_sources_say_why():
    from app.collectors.registry import load_source_configs
    from conftest import ROOT
    cfgs = load_source_configs(ROOT / "config" / "sources.yaml")
    for c in cfgs:
        if c.verification_status in ("verified", "partially_verified"):
            assert c.options.get("verified_on") == "2026-10-29", c.id          # preuve datée (smoke réel sur le Pi)
        if c.verification_status == "blocked_by_site":
            assert not c.enabled and c.options.get("disabled_reason"), c.id    # jamais de contournement : motif écrit
    assert len([c for c in cfgs if c.enabled]) >= 5
    assert next(c for c in cfgs if c.id == "france-diplomatie-cv").endpoint_url.endswith("conseils-aux-voyageurs")   # sans « / » final


def test_worker_loop_collects_then_builds_events(sources, settings, monkeypatch):
    """Câblage de production : un tour du worker = collecte des sources dues, puis traitement des événements."""
    import signal
    from app.collectors import runner
    from app.models import Claim, Event

    routes = {CERT: (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml"))}
    monkeypatch.setattr(runner, "PoliteClient", lambda **kw: make_client(serve(routes)))

    class StopLoop(Exception):
        pass

    def stop(_):
        raise StopLoop

    monkeypatch.setattr(runner.time, "sleep", stop)
    old = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
    try:
        with pytest.raises(StopLoop):
            runner.serve(sources, settings, tick_s=0)
    finally:
        for s, h in old.items():
            signal.signal(s, h)
    with session_scope(sources) as s:
        assert len(s.scalars(select(Document)).all()) == 2
        assert len(s.scalars(select(Claim)).all()) == 2 and len(s.scalars(select(Event)).all()) == 2


def test_purge_removes_only_expired_snapshots(sources, settings, clock, rng):
    import os, time
    http = make_client(serve({CERT: (200, XML, fixture_bytes("feeds/cert_fr_alertes.xml"))}))
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    snaps = list((settings.snapshot_dir / "cert-fr-alertes").rglob("*.gz"))
    assert len(snaps) == 1
    from app.collectors.runner import purge_all
    from app.normalization.dates import utcnow
    assert purge_all(sources, settings) == 0                               # récent : conservé
    old = time.time() - 120 * 86400
    os.utime(snaps[0], (old, old))
    assert purge_all(sources, settings) == 1 and not snaps[0].exists()      # > 90 j : supprimé
    with session_scope(sources) as s:
        assert s.scalars(select(DocumentVersion)).first().text                # le texte normalisé reste


def test_redirect_https_to_http_is_an_explicit_error(sources, settings, clock, rng):
    # Constaté sur le Pi : avec "/" final, 301 vers http:// ; le port 80 refuse la connexion.
    http = make_client(serve({DIPLO + "/": lambda r: httpx.Response(301, headers={"location": "http://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs"})}))
    from app.collectors.registry import load_source_configs
    from conftest import ROOT
    from app.models import Source
    from app.collectors.html_page import HtmlPageConnector
    from app.collectors.base import ConditionalState
    cfg = next(c for c in load_source_configs(ROOT / "config" / "sources.yaml") if c.id == "france-diplomatie-cv")
    src = Source(**{**cfg.model_dump(), "endpoint_url": DIPLO + "/"})
    res = HtmlPageConnector().fetch(src, ConditionalState(None, None), http)
    assert res.outcome == "domain_rejected" and "redirection non sécurisée" in res.error and "ConnectError" not in res.error


def test_gcore_challenge_page_is_blocked_never_stored(sources, settings, clock, rng):
    VIGI = "https://www.sgdsn.gouv.fr/nos-missions/proteger-la-population/vigipirate"
    http = make_client(serve({VIGI: (200, HTML, fixture_bytes("pages/gcore_challenge_real.html"))}))
    res = run_source(sources, "sgdsn-vigipirate", http, settings, clock=clock, rng=rng)
    assert res.outcome == "blocked" and "gcore" in res.error and "non contournée" in res.error
    h = health(sources, "sgdsn-vigipirate")
    assert h.state == "blocked" and h.last_success_at is None
    assert (h.next_run_at - clock.now) >= timedelta(hours=6)
    with session_scope(sources) as s:
        assert s.scalars(select(Document)).first() is None and s.scalars(select(DocumentVersion)).first() is None


def test_cloudflare_challenge_on_page_and_feed_is_blocked(sources, settings, clock, rng):
    body = fixture_bytes("pages/cloudflare_challenge_synthetic.html")
    http = make_client(serve({DIPLO: (200, HTML, body), CERT: (200, HTML, body)}))
    assert run_source(sources, "france-diplomatie-cv", http, settings, clock=clock, rng=rng).outcome == "blocked"
    assert run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng).outcome == "blocked"


def test_long_editorial_page_mentioning_captcha_is_not_a_challenge():
    from app.collectors.challenge import looks_like_challenge
    page = ("<html><body><main>" + "<p>Conseils aux voyageurs : situation sécuritaire détaillée. " * 80 + "Le site utilise un captcha. Please enable cookies.</p></main></body></html>").encode()
    assert looks_like_challenge(page) is None
    assert looks_like_challenge(fixture_bytes("pages/gcore_challenge_real.html")) == "gcore"


def test_expected_marker_missing_is_unexpected_format_not_success(sources, settings, clock, rng):
    other = b"<html><head><title>Autre</title></head><body><main><h1>Page sans rapport</h1><p>" + b"Contenu quelconque assez long pour ne pas etre vide. " * 3 + b"</p></main></body></html>"
    http = make_client(serve({DIPLO: (200, HTML, other)}))
    res = run_source(sources, "france-diplomatie-cv", http, settings, clock=clock, rng=rng)
    assert res.outcome == "error" and "format inattendu" in res.error
    with session_scope(sources) as s:
        assert s.scalars(select(Document)).first() is None


EASA_URL = "https://www.easa.europa.eu/en/domains/air-operations/czibs"


def test_easa_one_document_per_czib_with_real_row_fields(sources, settings, clock, rng):
    http = make_client(serve({EASA_URL: (200, HTML, fixture_bytes("pages/easa_real_rows.html"))}))
    res = run_source(sources, "easa-czib", http, settings, clock=clock, rng=rng)
    assert res.outcome == "ok" and len(res.items) == 2
    with session_scope(sources) as s:
        docs = {d.external_id: d for d in s.scalars(select(Document))}
        assert set(docs) == {"czib-2017-01", "czib-2026-03"}
        v = s.get(DocumentVersion, docs["czib-2017-01"].current_version_id)
        f = v.structured
        assert (f["czib_id"], f["revision"], f["title"], f["status"]) == ("2017-01", 21, "Airspace of Mali", "Active")
        assert (f["issued"], f["revised"], f["valid_until"]) == ("2017-03-31", "2026-09-30", "2027-04-30")      # JJ/MM/AAAA lus
        assert f["url"] == "https://www.easa.europa.eu/en/domains/air-operations/czibs/czib-2017-01r21"


def test_easa_empty_table_is_unexpected_format(sources, settings, clock, rng):
    http = make_client(serve({EASA_URL: (200, HTML, b"<html><body><main><h1>Conflict Zones Advisories</h1><table></table></main></body></html>")}))
    res = run_source(sources, "easa-czib", http, settings, clock=clock, rng=rng)
    assert res.outcome == "error" and "format inattendu" in res.error


def test_cert_feed_order_is_not_chronological_and_maj_keeps_original_date(sources, settings, clock, rng):
    http = make_client(serve({CERT: (200, XML, fixture_bytes("feeds/cert_fr_maj_mixed_order.xml"))}))
    run_source(sources, "cert-fr-alertes", http, settings, clock=clock, rng=rng)
    with session_scope(sources) as s:
        docs = {d.external_id: d for d in s.scalars(select(Document))}
        maj = docs["CERTFR-2024-ALE-9002"]
        assert maj.published_at.year == 2024 and "published_at_is_original_date" in maj.date_flags and "old_publication" not in maj.date_flags
        assert "old_publication" in docs["CERTFR-2015-ALE-9001"].date_flags
        assert docs["CERTFR-2024-ALE-9002"].version_count == 1 and docs["CERTFR-2026-ALE-9003"].date_flags == []
        v = s.get(DocumentVersion, maj.current_version_id)
        assert v.structured["is_update"] is True


def test_ioda_real_response_france_without_event_is_ok_and_empty(sources, settings, clock, rng):
    """Réponse RÉELLE relevée sur le Pi le 29/10/2026 (France, aucun événement) : enveloppe confirmée."""
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/json"}, content=fixture_bytes("json/ioda_real_empty_fr.json")))
    res = run_source(sources, "ioda-fr", http, settings, clock=clock, rng=rng)
    assert res.outcome == "ok" and res.items == [] and health(sources, "ioda-fr").state == "ok"
