"""Client HTTP « poli » : User-Agent identifié, requêtes conditionnelles, robots.txt, écart minimal par hôte.

Aucun contournement : pas de rotation d'IP/UA, pas de paywall, HTTPS uniquement.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from urllib import robotparser
from urllib.parse import urljoin, urlsplit

import httpx

from app.normalization.urls import host_allowed


@dataclass
class HttpResult:
    status: int | None
    final_url: str
    body: bytes
    content_type: str
    etag: str | None
    last_modified: str | None
    retry_after_s: int | None
    error: str | None = None
    kind: str = "ok"  # ok | not_modified | http_error | network_error | domain_rejected | insecure_redirect | robots_blocked | too_large


def _parse_retry_after(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return max(0, int(value.strip()))
    except ValueError:
        return None  # date HTTP : ignorée, le backoff exponentiel prend le relais


class PoliteClient:
    def __init__(
        self,
        *,
        user_agent: str,
        timeout_s: float = 20.0,
        max_body_bytes: int = 5_000_000,
        respect_robots: bool = True,
        min_host_gap_s: float = 2.0,
        transport: httpx.BaseTransport | None = None,
        sleep=time.sleep,
        monotonic=time.monotonic,
    ) -> None:
        self._client = httpx.Client(
            headers={"User-Agent": user_agent, "Accept": "application/rss+xml, application/atom+xml, application/json, text/html;q=0.8, */*;q=0.5"},
            timeout=timeout_s,
            follow_redirects=False,  # redirections suivies à la main : on contrôle chaque saut (HTTPS, liste blanche)
            transport=transport,
        )
        self._user_agent = user_agent
        self._max = max_body_bytes
        self._respect_robots = respect_robots
        self._gap = min_host_gap_s
        self._last_by_host: dict[str, float] = {}
        self._robots: dict[str, tuple[float, robotparser.RobotFileParser | None]] = {}
        self._sleep = sleep
        self._now = monotonic

    def close(self) -> None:
        self._client.close()

    def _throttle(self, host: str) -> None:
        last = self._last_by_host.get(host)
        if last is not None:
            wait = self._gap - (self._now() - last)
            if wait > 0:
                self._sleep(wait)
        self._last_by_host[host] = self._now()

    def _robots_allows(self, url: str) -> bool | None:
        """True/False ; None si robots.txt est injoignable (RFC 9309 : on s'abstient)."""
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        cached = self._robots.get(origin)
        if cached is None or self._now() - cached[0] > 86_400:
            parser: robotparser.RobotFileParser | None
            try:
                self._throttle(parts.netloc)
                r = self._client.get(f"{origin}/robots.txt", follow_redirects=True)
                if r.status_code >= 500:
                    parser = None
                else:
                    parser = robotparser.RobotFileParser()
                    if r.status_code >= 400:
                        parser.parse([])  # pas de robots.txt : tout est permis
                    else:
                        parser.parse(r.text.splitlines())
            except httpx.HTTPError:
                parser = None
            self._robots[origin] = (self._now(), parser)
            cached = self._robots[origin]
        parser = cached[1]
        if parser is None:
            return None
        return parser.can_fetch(self._user_agent, url)

    def get(
        self,
        url: str,
        *,
        allowed_domains: list[str],
        etag: str | None = None,
        last_modified: str | None = None,
        check_robots: bool = True,
    ) -> HttpResult:
        if not url.startswith("https://") or not host_allowed(url, allowed_domains):
            return HttpResult(None, url, b"", "", None, None, None, f"URL hors liste blanche : {url}", "domain_rejected")
        if self._respect_robots and check_robots:
            allowed = self._robots_allows(url)
            if allowed is None:
                return HttpResult(None, url, b"", "", None, None, None, "robots.txt injoignable (abstention)", "robots_blocked")
            if not allowed:
                return HttpResult(None, url, b"", "", None, None, None, "interdit par robots.txt", "robots_blocked")
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        current = url
        for _hop in range(6):
            self._throttle(urlsplit(current).netloc)
            try:
                with self._client.stream("GET", current, headers=headers) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                        target = urljoin(current, r.headers["location"])
                        if not target.startswith("https://"):
                            # ex. https -> http : le port 80 est souvent fermé ; on le dit clairement plutôt qu'un ConnectError opaque
                            return HttpResult(r.status_code, target, b"", "", None, None, None,
                                              f"redirection non sécurisée (HTTP {r.status_code} vers {target}) : refusée, HTTPS uniquement", "insecure_redirect")
                        if not host_allowed(target, allowed_domains):
                            return HttpResult(r.status_code, target, b"", "", None, None, None, f"redirection hors liste blanche : {target}", "domain_rejected")
                        current = target
                        continue
                    final_url = current
                    chunks: list[bytes] = []
                    size = 0
                    for chunk in r.iter_bytes():
                        size += len(chunk)
                        if size > self._max:
                            return HttpResult(r.status_code, final_url, b"", "", None, None, None, f"corps > {self._max} octets", "too_large")
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    common = dict(
                        final_url=final_url,
                        content_type=r.headers.get("content-type", ""),
                        etag=r.headers.get("etag"),
                        last_modified=r.headers.get("last-modified"),
                        retry_after_s=_parse_retry_after(r.headers.get("retry-after")),
                    )
                    if r.status_code == 304:
                        return HttpResult(304, body=b"", kind="not_modified", **common)
                    if r.status_code >= 400:
                        return HttpResult(r.status_code, body=b"", error=f"HTTP {r.status_code}", kind="http_error", **common)
                    return HttpResult(r.status_code, body=body, **common)
            except httpx.HTTPError as exc:
                return HttpResult(None, current, b"", "", None, None, None, f"{type(exc).__name__}: {exc}"[:300], "network_error")
        return HttpResult(None, current, b"", "", None, None, None, "trop de redirections", "network_error")
