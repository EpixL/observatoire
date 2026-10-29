"""Détection des pages de défi anti-robot (Gcore, Cloudflare…).

Une telle page répond « 200 » mais ne contient PAS la ressource : la stocker comme version d'un document, ou la
compter comme un succès, serait un faux positif grave. On la classe `blocked`. Aucun contournement (pas de faux
User-Agent de navigateur, pas d'exécution de JavaScript, pas de cookies) : on cherche une autre source officielle
ou on désactive la source avec son motif.
"""
from __future__ import annotations

import re

STRONG = [
    ("gcore", re.compile(r"<title>\s*gcore\s*</title>|browser validation page", re.I)),
    ("cloudflare", re.compile(r"just a moment\.\.\.|cf-browser-verification|challenge-platform|attention required!? \| cloudflare", re.I)),
    ("checking-browser", re.compile(r"checking your browser before accessing|ddos protection by", re.I)),
]
WEAK = re.compile(r"please enable (?:javascript|cookies)|enable javascript and cookies|are you a robot|captcha", re.I)


def looks_like_challenge(body: bytes) -> str | None:
    head = body[:200_000].decode("utf-8", errors="replace")
    for name, rx in STRONG:
        if rx.search(head):
            return name
    # Marqueurs faibles : seulement sur une page très courte (une vraie page éditoriale en contient rarement un seul).
    visible = re.sub(r"<[^>]+>", " ", head)
    if len(visible.strip()) < 1500 and WEAK.search(head):
        return "generic-js-cookie-wall"
    return None
