"""Connecteur page HTML : un document = une page ; les versions portent les changements de contenu."""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from app.collectors.base import ConditionalState, FetchedItem, FetchResult, outcome_from_http
from app.collectors.http import PoliteClient
from app.models import Source
from app.normalization.text import html_to_text, normalize_text
from app.normalization.urls import canonicalize_url

_UPDATED_RE = re.compile(
    r"(?:mis(?:e)? à jour|derni[eè]re mise à jour|updated|last updated)\s*(?:le|on|:)?\s*([0-9]{1,2}[ /.-][^\n]{3,30})",
    re.I,
)


def parse_page(body: bytes, url: str, selector: str | None) -> FetchedItem:
    soup = BeautifulSoup(body, "lxml")
    title = ""
    if soup.title and soup.title.string:
        title = normalize_text(soup.title.string)
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        title = normalize_text(h1.get_text())
    text = html_to_text(body, selector=selector)
    updated = _UPDATED_RE.search(text)
    return FetchedItem(
        external_id=canonicalize_url(url),
        url=url,
        title=title,
        text=text,
        published_raw=None,  # la date d'une page n'est pas une date de publication fiable
        structured={"page_updated_raw": updated.group(1).strip() if updated else None, "selector": selector},
    )


class HtmlPageConnector:
    def fetch(self, source: Source, state: ConditionalState, http: PoliteClient) -> FetchResult:
        url = source.endpoint_url or source.canonical_url
        r = http.get(url, allowed_domains=source.allowed_domains, etag=state.etag, last_modified=state.last_modified)
        if r.kind == "not_modified":
            return FetchResult(outcome="not_modified", http_status=304, final_url=r.final_url, etag=r.etag or state.etag, last_modified=r.last_modified or state.last_modified)
        if r.kind != "ok":
            outcome, floor = outcome_from_http(r.status, r.kind)
            return FetchResult(outcome=outcome, http_status=r.status, final_url=r.final_url, error=r.error, retry_after_s=r.retry_after_s, min_backoff_s=floor)
        selector = source.options.get("content_selector")
        item = parse_page(r.body, r.final_url, selector)
        if len(item.text) < 40:
            return FetchResult(outcome="error", http_status=r.status, final_url=r.final_url, error="page quasi vide (structure changée ou page d'erreur ?)", min_backoff_s=1800)
        # L'identité du document reste l'URL demandée (stable même si le site redirige).
        item.external_id = canonicalize_url(url)
        return FetchResult(outcome="ok", http_status=r.status, final_url=r.final_url, items=[item], etag=r.etag, last_modified=r.last_modified, raw_body=r.body)
