"""Outils d'exploitation : smoke (rapport sans toucher la base) et découverte de flux."""
from __future__ import annotations

import httpx

from app.collectors.registry import load_source_configs
from app.discover import find_feeds
from app.smoke import render, run_smoke

from conftest import ROOT, fixture_bytes, make_client


def test_find_feeds_link_alternate_and_anchor():
    html = b"""<html><head><link rel="alternate" type="application/rss+xml" title="Flux" href="/rss.xml"></head>
    <body><a href="/syndication/feed">Flux RSS</a><a href="/autre">Autre</a></body></html>"""
    urls = {f["url"]: f["via"] for f in find_feeds(html, "https://exemple.invalid/page")}
    assert urls == {"https://exemple.invalid/rss.xml": "link-alternate", "https://exemple.invalid/syndication/feed": "lien"}


def test_smoke_reports_verdicts_without_database(settings, tmp_path):
    cfgs = [c for c in load_source_configs(ROOT / "config" / "sources.yaml") if c.id in ("cert-fr-alertes", "ioda-fr", "france24-fr", "nato-news")]

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "cert.cyber.gouv.fr":
            return httpx.Response(200, headers={"content-type": "application/rss+xml", "etag": '"x"'}, content=fixture_bytes("feeds/cert_fr_alertes.xml"))
        if host == "api.ioda.inetintel.cc.gatech.edu":
            return httpx.Response(200, content=fixture_bytes("json/ioda_bad_schema.json"))
        return httpx.Response(429)

    import app.smoke as smoke
    http = make_client(handler)
    rows = {c.id: smoke.smoke_one(c, http, tmp_path / "raw") for c in cfgs}
    assert rows["cert-fr-alertes"]["verdict"] == "OK" and rows["cert-fr-alertes"]["items"] == 2 and rows["cert-fr-alertes"]["etag_supported"]
    assert rows["ioda-fr"]["verdict"] == "FAIL" and "schema_unexpected" in rows["ioda-fr"]["error"]
    assert rows["france24-fr"]["verdict"] == "BLOCKED"            # 429 = quota, pas « pas de nouvelles »
    assert rows["nato-news"]["verdict"] == "SKIPPED"
    assert (tmp_path / "raw" / "cert-fr-alertes.xml").exists()
    report = {"results": list(rows.values())}
    assert "cert-fr-alertes" in render(report)


def test_smoke_sample_title_is_the_most_recent_item_not_the_first():
    from app.collectors.base import FetchedItem
    from app.smoke import _latest
    items = [FetchedItem("a", "u", "Vieil article (2015)", "t", published_raw="Fri, 24 Jul 2015 10:00:00 +0200"),
             FetchedItem("b", "u", "Article récent", "t", published_raw="Wed, 28 Oct 2026 08:00:00 +0100"),
             FetchedItem("c", "u", "Sans date", "t")]
    assert _latest(items) == "Article récent"
    assert _latest([FetchedItem("c", "u", "Sans date", "t")]) == "Sans date"
