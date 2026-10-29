"""Connecteur EASA — liste des Conflict Zone Information Bulletins (tableau HTML).

Structure confirmée par un extrait RÉEL relevé sur le Pi le 29/10/2026 (une ligne par bulletin) :
  td.views-field-field-easa-conflict-zone-up-date   31/03/2017   (émission)
  td.views-field-field-easa-conflict-zone-revdate   30/09/2026   (dernière révision)
  td.views-field-field-easa-conflict-zone-until     30/04/2027   (validité)
  div.cz-title "Airspace of Mali" · div.czib_number "CZIB-2017-01R21" · div.cz-status "Active" · a[href]
Un document par bulletin (identité = année-numéro, SANS la révision) : une nouvelle révision ou une prolongation
de validité devient une nouvelle VERSION du même document. Dates au format JJ/MM/AAAA.
Pagination éventuelle de la liste : non vérifiée.
"""
from __future__ import annotations

import re
from datetime import date
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from app.collectors.base import ConditionalState, FetchedItem, FetchResult, outcome_from_http
from app.collectors.html_page import challenge_result
from app.collectors.http import PoliteClient
from app.models import Source

CZIB_NUM = re.compile(r"CZIB[-\s]*(\d{4})-(\d{2,3})(?:\s*R(\d+))?", re.I)


def _date(cell) -> str | None:
    if cell is None:
        return None
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", cell.get_text(" ", strip=True))
    if not m:
        return None
    try:
        return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return None


def parse_czib_table(body: bytes, base_url: str) -> list[FetchedItem]:
    soup = BeautifulSoup(body, "lxml")
    items: list[FetchedItem] = []
    for row in soup.find_all("tr"):
        num = row.select_one(".czib_number")
        if num is None:
            continue
        m = CZIB_NUM.search(num.get_text(" ", strip=True))
        if not m:
            continue
        year, no, rev = m[1], m[2], int(m[3]) if m[3] else 0
        cid = f"{year}-{no}"
        title_el = row.select_one(".cz-title")
        status_el = row.select_one(".cz-status")
        link = row.find("a", href=True)
        fields = {
            "czib_id": cid, "revision": rev,
            "title": title_el.get_text(" ", strip=True) if title_el else "",
            "status": status_el.get_text(" ", strip=True) if status_el else None,
            "issued": _date(row.select_one("td[class*=conflict-zone-up-date]")),
            "revised": _date(row.select_one("td[class*=conflict-zone-revdate]")),
            "valid_until": _date(row.select_one("td[class*=conflict-zone-until]")),
            "url": urljoin(base_url, link["href"]) if link else base_url,
        }
        text = "\n".join([
            f"CZIB-{cid}R{rev}" if rev else f"CZIB-{cid}",
            fields["title"],
            f"Statut : {fields['status'] or 'inconnu'}",
            f"Émission : {fields['issued'] or 'inconnue'}",
            f"Révision : {fields['revised'] or 'inconnue'}",
            f"Validité jusqu'au : {fields['valid_until'] or 'inconnue'}",
        ])
        items.append(FetchedItem(external_id=f"czib-{cid}", url=fields["url"], title=f"CZIB-{cid} — {fields['title']}",
                                 text=text, published_raw=None, structured=fields))
    return items


class EasaCzibConnector:
    def fetch(self, source: Source, state: ConditionalState, http: PoliteClient) -> FetchResult:
        url = source.endpoint_url or source.canonical_url
        r = http.get(url, allowed_domains=source.allowed_domains, etag=state.etag, last_modified=state.last_modified)
        if r.kind == "not_modified":
            return FetchResult(outcome="not_modified", http_status=304, final_url=r.final_url, etag=r.etag or state.etag, last_modified=r.last_modified or state.last_modified)
        if r.kind != "ok":
            outcome, floor = outcome_from_http(r.status, r.kind)
            return FetchResult(outcome=outcome, http_status=r.status, final_url=r.final_url, error=r.error, retry_after_s=r.retry_after_s, min_backoff_s=floor)
        blocked = challenge_result(r)
        if blocked:
            return blocked
        items = parse_czib_table(r.body, r.final_url)
        if not items:  # jamais « aucun bulletin » : une liste vide est un format inattendu
            return FetchResult(outcome="error", http_status=r.status, final_url=r.final_url, min_backoff_s=1800,
                               error="format inattendu : aucune ligne .czib_number dans la page")
        return FetchResult(outcome="ok", http_status=r.status, final_url=r.final_url, items=items, etag=r.etag, last_modified=r.last_modified, raw_body=r.body)
