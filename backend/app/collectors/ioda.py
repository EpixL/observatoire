"""Connecteur IODA (interruptions Internet) — API JSON v2.

ATTENTION : schéma NON vérifié depuis l'environnement cloud (réseau filtré). Le parseur est
volontairement défensif : si la forme de la réponse n'est pas celle attendue, on lève une
erreur technique visible (`schema_unexpected`) au lieu de produire une liste vide qui ressemblerait
à « aucune interruption ». À valider sur le Pi avec scripts/smoke-collectors.sh.

Hypothèse de travail (à confirmer) : GET {base}/outages/events?entityType=country&entityCode=FR&from=<epoch>&until=<epoch>
renvoie {"data": [{"location": "country/FR", "start": <epoch>, "duration": <s>, "score": <float>, "datasource": "bgp", ...}]}.

Une perturbation détectée n'est PAS une cyberattaque (plan §3) : le texte produit le rappelle.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from app.collectors.base import ConditionalState, FetchedItem, FetchResult, ObservationIn, outcome_from_http
from app.collectors.http import PoliteClient
from app.models import Source
from app.normalization.dates import utcnow


class SchemaUnexpected(Exception):
    pass


def _events_list(payload: Any) -> list[dict[str, Any]]:
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, dict):
        data = data.get("events", data.get("data"))
    if not isinstance(data, list) or not all(isinstance(e, dict) for e in data):
        raise SchemaUnexpected("champ 'data' absent ou non liste d'objets")
    return data


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_events(payload: Any, entity_type: str, entity_code: str) -> tuple[list[FetchedItem], list[ObservationIn]]:
    items: list[FetchedItem] = []
    observations: list[ObservationIn] = []
    for ev in _events_list(payload):
        start = ev.get("start")
        if not isinstance(start, (int, float)):
            raise SchemaUnexpected(f"événement sans 'start' numérique : clés={sorted(ev)}")
        location = str(ev.get("location") or f"{entity_type}/{entity_code}")
        datasource = str(ev.get("datasource") or ev.get("method") or "inconnu")
        score = ev.get("score")
        bucket = int(math.floor(math.log10(score))) if isinstance(score, (int, float)) and score > 0 else None
        lines = [
            "Interruption Internet détectée par IODA (mesure technique ; ne prouve ni cyberattaque ni acte hostile).",
            f"Entité : {location}",
            f"Début : {_iso(start)}",
            f"Source de mesure : {datasource}",
            f"Ordre de grandeur du score : {'inconnu' if bucket is None else f'10^{bucket}'}",
        ]
        items.append(
            FetchedItem(
                external_id=f"ioda|{location}|{int(start)}|{datasource}",
                url=f"https://ioda.inetintel.cc.gatech.edu/{entity_type}/{entity_code}",
                title=f"Interruption Internet — {location} ({datasource})",
                text="\n".join(lines),
                published_raw=None,  # IODA mesure, il ne « publie » pas : occurred_at = début de l'événement
                structured={"entity_type": entity_type, "entity_code": entity_code, "location": location,
                            "start_epoch": int(start), "duration_s": ev.get("duration"), "score": score,
                            "datasource": datasource, "raw": ev},
            )
        )
        observations.append(
            ObservationIn(entity_type, entity_code, "outage_event_score", datetime.fromtimestamp(start, tz=timezone.utc),
                          float(score) if isinstance(score, (int, float)) else None,
                          {"datasource": datasource, "duration_s": ev.get("duration")})
        )
    return items, observations


class IodaConnector:
    def fetch(self, source: Source, state: ConditionalState, http: PoliteClient) -> FetchResult:
        base = (source.endpoint_url or "").rstrip("/")
        if not base:
            return FetchResult(outcome="error", error="endpoint_url non renseigné", min_backoff_s=6 * 3600)
        lookback = int(source.options.get("lookback_hours", 48))
        now = utcnow()
        frm, until = int((now - timedelta(hours=lookback)).timestamp()), int(now.timestamp())
        items: list[FetchedItem] = []
        observations: list[ObservationIn] = []
        errors: list[str] = []
        worst: FetchResult | None = None
        last_status: int | None = None
        last_body: bytes | None = None
        for ent in source.options.get("entities", []):
            url = f"{base}/outages/events?entityType={ent['type']}&entityCode={ent['code']}&from={frm}&until={until}"
            r = http.get(url, allowed_domains=source.allowed_domains, check_robots=False)
            last_status = r.status
            last_body = r.body or last_body
            if r.kind != "ok":
                outcome, floor = outcome_from_http(r.status, r.kind)
                errors.append(f"{ent['type']}/{ent['code']}: {r.error}")
                worst = FetchResult(outcome=outcome, http_status=r.status, final_url=r.final_url, error="; ".join(errors),
                                    retry_after_s=r.retry_after_s, min_backoff_s=floor)
                continue
            try:
                it, ob = parse_events(json.loads(r.body), ent["type"], ent["code"])
            except (json.JSONDecodeError, SchemaUnexpected) as exc:
                errors.append(f"schema_unexpected {ent['type']}/{ent['code']}: {exc}")
                worst = FetchResult(outcome="error", http_status=r.status, final_url=r.final_url, error="; ".join(errors), min_backoff_s=1800)
                continue
            items += it
            observations += ob
        if worst is not None:
            worst.items, worst.observations = items, observations  # on garde ce qui a été lu
            return worst
        return FetchResult(outcome="ok", http_status=last_status, items=items, observations=observations, raw_body=last_body)
