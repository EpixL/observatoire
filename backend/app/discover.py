"""Découverte de flux RSS/Atom d'une page (balises <link rel="alternate">, liens « RSS/flux »)."""
from __future__ import annotations

from urllib.parse import urljoin

from bs4 import BeautifulSoup

from app.collectors.http import PoliteClient
from app.models import Source


def find_feeds(html: bytes, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    found: dict[str, dict] = {}
    for link in soup.find_all("link", rel=lambda v: v and "alternate" in v):
        t = (link.get("type") or "").lower()
        if "rss" in t or "atom" in t or "json" in t:
            u = urljoin(base_url, link.get("href", ""))
            found[u] = {"url": u, "type": t, "title": link.get("title"), "via": "link-alternate"}
    for a in soup.find_all("a", href=True):
        label = (a.get_text(" ", strip=True) + " " + a["href"]).lower()
        if any(k in label for k in ("rss", "atom", "flux", "feed", "syndication")):
            u = urljoin(base_url, a["href"])
            found.setdefault(u, {"url": u, "type": None, "title": a.get_text(" ", strip=True)[:80], "via": "lien"})
    return list(found.values())


def discover(source: Source, http: PoliteClient) -> list[dict]:
    r = http.get(source.canonical_url, allowed_domains=source.allowed_domains)
    if r.kind != "ok":
        raise RuntimeError(f"{source.canonical_url} : {r.error or r.kind}")
    return find_feeds(r.body, r.final_url)
