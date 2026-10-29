"""Connecteur RSS/Atom (feedparser). Une entrée = un document ; texte = titre + résumé nettoyé."""
from __future__ import annotations

import hashlib

import feedparser

from app.collectors.base import ConditionalState, FetchedItem, FetchResult, outcome_from_http
from app.collectors.http import PoliteClient
from app.models import Source
from app.normalization.text import html_to_text, normalize_text


def parse_feed(body: bytes, base_url: str) -> list[FetchedItem] | None:
    """None si le contenu n'est pas un flux exploitable (page HTML d'erreur, etc.)."""
    parsed = feedparser.parse(body)
    # `version` vide = ce n'est pas un flux RSS/Atom (ex. page HTML de maintenance). Un flux valide mais
    # sans entrée, lui, est légitime. On ne confond jamais « pas un flux » et « aucune nouveauté ».
    if not parsed.version or (parsed.bozo and not parsed.entries):
        return None
    items: list[FetchedItem] = []
    for entry in parsed.entries:
        link = entry.get("link") or ""
        title = normalize_text(html_to_text(entry.get("title", "") or "")) if entry.get("title") else ""
        summary_html = entry.get("summary", "") or ""
        content = entry.get("content")
        if content:
            summary_html = content[0].get("value", summary_html)
        summary = html_to_text(summary_html) if summary_html else ""
        published = entry.get("published") or entry.get("updated")
        ext = entry.get("id") or link
        if not ext:
            ext = "sha256:" + hashlib.sha256(f"{title}|{published}".encode()).hexdigest()
        text = "\n".join(part for part in (title, summary) if part)
        items.append(
            FetchedItem(
                external_id=str(ext),
                url=link or base_url,
                title=title,
                text=text,
                published_raw=published,
                structured={
                    "authors": [a.get("name") for a in entry.get("authors", []) if a.get("name")],
                    "tags": [t.get("term") for t in entry.get("tags", []) if t.get("term")],
                    "feed_title": parsed.feed.get("title"),
                },
            )
        )
    return items


class FeedConnector:
    def fetch(self, source: Source, state: ConditionalState, http: PoliteClient) -> FetchResult:
        if not source.endpoint_url:
            return FetchResult(outcome="error", error="endpoint_url non renseigné (voir discover-feeds)", min_backoff_s=6 * 3600)
        r = http.get(
            source.endpoint_url,
            allowed_domains=source.allowed_domains,
            etag=state.etag,
            last_modified=state.last_modified,
            check_robots=False,  # les flux RSS sont publiés pour être lus par des machines
        )
        if r.kind == "not_modified":
            return FetchResult(outcome="not_modified", http_status=304, final_url=r.final_url, etag=r.etag or state.etag, last_modified=r.last_modified or state.last_modified)
        if r.kind != "ok":
            outcome, floor = outcome_from_http(r.status, r.kind)
            return FetchResult(outcome=outcome, http_status=r.status, final_url=r.final_url, error=r.error, retry_after_s=r.retry_after_s, min_backoff_s=floor)
        items = parse_feed(r.body, source.canonical_url)
        if items is None:
            return FetchResult(outcome="error", http_status=r.status, final_url=r.final_url, error="réponse non reconnue comme flux RSS/Atom", min_backoff_s=1800)
        return FetchResult(outcome="ok", http_status=r.status, final_url=r.final_url, items=items, etag=r.etag, last_modified=r.last_modified, raw_body=r.body)
