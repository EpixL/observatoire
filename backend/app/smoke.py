"""Test de fumée des vrais endpoints (à lancer SUR LE PI, où le réseau n'est pas filtré).

Ne touche pas à la base : une requête polie par source, parsing par le vrai connecteur, rapport JSON.
Option --save-fixtures : enregistre les réponses brutes réelles (à relire avant tout commit :
vérifier l'absence de secret/donnée personnelle) pour remplacer les fixtures fictives.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from app.collectors import CONNECTORS
from app.collectors.base import ConditionalState
from app.collectors.http import PoliteClient
from app.collectors.registry import SourceConfig
from app.config import Settings
from app.models import Source
from app.normalization.dates import parse_publication_date, utcnow


def _latest(items) -> str:
    """Titre de l'élément le plus RÉCENT (les flux CERT-FR mélangent des articles de 2014 et de 2026 : le premier n'est pas le plus récent)."""
    dated = [(parse_publication_date(i.published_raw).value, i) for i in items]
    dated = [(d, i) for d, i in dated if d is not None]
    return (max(dated, key=lambda t: t[0])[1] if dated else items[0]).title


def smoke_one(cfg: SourceConfig, http: PoliteClient, save_dir: Path | None) -> dict:
    src = Source(**cfg.model_dump())
    t0 = time.monotonic()
    row: dict = {"source_id": cfg.id, "endpoint_url": cfg.endpoint_url or cfg.canonical_url, "enabled": cfg.enabled}
    if not (cfg.endpoint_url or cfg.access_mode == "html_page"):
        return {**row, "verdict": "SKIPPED", "detail": "pas d'endpoint connu : utiliser discover-feeds"}
    try:
        res = CONNECTORS[cfg.connector]().fetch(src, ConditionalState(None, None), http)
    except Exception as exc:  # le smoke doit toujours produire un rapport
        return {**row, "verdict": "FAIL", "detail": f"exception {type(exc).__name__}: {exc}"[:300]}
    row.update(
        http_status=res.http_status, final_url=res.final_url, outcome=res.outcome, items=len(res.items),
        observations=len(res.observations), duration_ms=int((time.monotonic() - t0) * 1000),
        sample_title=_latest(res.items)[:120] if res.items else None,
        undated_items=sum(1 for i in res.items if not i.published_raw) if cfg.access_mode == "feed" else None,
        etag_supported=bool(res.etag), last_modified_supported=bool(res.last_modified), error=res.error,
    )
    if res.outcome == "ok":
        row["verdict"] = "OK" if (res.items or cfg.connector == "ioda") else "OK_EMPTY"
    elif res.outcome in ("blocked", "domain_rejected", "rate_limited"):
        row["verdict"] = "BLOCKED"
    else:
        row["verdict"] = "FAIL"
    if save_dir and res.raw_body:
        save_dir.mkdir(parents=True, exist_ok=True)
        ext = {"feed": "xml", "html_page": "html", "json_api": "json"}[cfg.access_mode]
        (save_dir / f"{cfg.id}.{ext}").write_bytes(res.raw_body)
        row["saved"] = f"{cfg.id}.{ext}"
    return row


def run_smoke(configs: list[SourceConfig], settings: Settings, *, only: str | None, include_disabled: bool, save_dir: Path | None) -> dict:
    http = PoliteClient(user_agent=settings.user_agent, timeout_s=settings.http_timeout_s,
                        max_body_bytes=settings.max_body_bytes, respect_robots=settings.respect_robots, min_host_gap_s=2.0)
    try:
        rows = [smoke_one(c, http, save_dir) for c in configs if (only is None or c.id == only) and (c.enabled or include_disabled)]
    finally:
        http.close()
    return {"generated_at": utcnow().isoformat(), "user_agent": settings.user_agent, "results": rows}


def render(report: dict) -> str:
    lines = [f"{'SOURCE':<24} {'VERDICT':<8} {'HTTP':<5} {'ITEMS':<6} {'MS':<6} DÉTAIL"]
    for r in report["results"]:
        detail = r.get("error") or r.get("detail") or (r.get("sample_title") or "")
        lines.append(f"{r['source_id']:<24} {r['verdict']:<8} {str(r.get('http_status') or '-'):<5} {str(r.get('items', '-')):<6} {str(r.get('duration_ms', '-')):<6} {detail[:80]}")
    return "\n".join(lines)


def dump(report: dict, path: Path) -> None:
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
