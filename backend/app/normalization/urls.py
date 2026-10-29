from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING_PREFIXES = ("utm_", "xtor", "at_", "mc_", "pk_", "piwik_")
_TRACKING_KEYS = {"fbclid", "gclid", "igshid", "ref", "ref_src", "cmpid", "ocid", "outputtype"}


def canonicalize_url(url: str) -> str:
    """URL stable pour la déduplication : hôte en minuscules, sans fragment ni paramètres de suivi."""
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    port = parts.port
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        host = f"{host}:{port}"
    query = sorted(
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_KEYS and not k.lower().startswith(_TRACKING_PREFIXES)
    )
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    return urlunsplit((scheme, host, path, urlencode(query), ""))


def host_allowed(url: str, allowed_domains: list[str]) -> bool:
    """Vrai si l'hôte est exactement un domaine autorisé ou l'un de ses sous-domaines."""
    host = (urlsplit(url).hostname or "").lower()
    return any(host == d.lower() or host.endswith("." + d.lower()) for d in allowed_domains)
