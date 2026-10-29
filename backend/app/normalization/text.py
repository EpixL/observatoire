"""Extraction de texte et détection de changement substantiel.

Principe du plan §5 : ignorer menus, cookies, mise en page, corrections typographiques et
changement de date de mise à jour seul ; conserver tout changement de contenu (y compris
une date de validité modifiée, qui est une information).
"""
from __future__ import annotations

import difflib
import hashlib
import re
import unicodedata

from bs4 import BeautifulSoup

_DROP_TAGS = ("script", "style", "noscript", "nav", "footer", "header", "aside", "form", "iframe", "svg", "template")
_BOILERPLATE_HINT = re.compile(r"cookie|consent|banner|breadcrumb|menu|newsletter|share|social", re.I)
_BLOCK_TAGS = ("p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "div", "section", "article", "br", "td", "th")

_MONTHS = (
    "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre"
    "|january|february|march|april|may|june|july|august|september|october|november|december"
)
_DATE = (
    r"(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?(?:z|[+-]\d{2}:?\d{2})?)?"
    rf"|\d{{1,2}}(?:er)? (?:{_MONTHS}) \d{{4}}|(?:{_MONTHS}) \d{{1,2}},? \d{{4}})(?: (?:à |at )?\d{{1,2}}[h:]\d{{2}})?"
)
_UPDATE_LABEL = re.compile(
    rf"(?:mis(?:e)? à jour|derni[eè]re mise à jour|derni[eè]re modification|modifi[ée]e? le|updated|last updated|last modified)"
    rf"(?: le| on| :|:)? ?{_DATE}",
    re.I,
)


def html_to_text(html: str | bytes, *, selector: str | None = None) -> str:
    soup = BeautifulSoup(html, "lxml")
    root = soup.select_one(selector) if selector else None
    root = root or soup.body or soup
    for tag in root.find_all(_DROP_TAGS):
        tag.decompose()
    for tag in root.find_all(attrs={"class": _BOILERPLATE_HINT}) + root.find_all(attrs={"id": _BOILERPLATE_HINT}):
        tag.decompose()
    for tag in root.find_all(_BLOCK_TAGS):
        tag.append("\n")
    return normalize_text(root.get_text())


def normalize_text(text: str) -> str:
    """Normalisation douce, conservant le contenu : Unicode NFC, espaces, guillemets typographiques."""
    text = unicodedata.normalize("NFC", text)
    for a, b in ((" ", " "), (" ", " "), ("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'), ("«", '"'), ("»", '"'), ("–", "-"), ("—", "-")):
        text = text.replace(a, b)
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def substantive_form(text: str) -> str:
    """Forme comparée pour décider d'un changement matériel (sans libellés « mis à jour le … »)."""
    t = normalize_text(text).casefold()
    t = _UPDATE_LABEL.sub(" ", t)
    t = re.sub(r"[^\w\s%°/.:-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def sha256_hex(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def content_hash(text: str) -> str:
    return sha256_hex(normalize_text(text))


def substantive_hash(text: str) -> str:
    return sha256_hex(substantive_form(text))


def classify_change(old_text: str, new_text: str) -> str:
    """'cosmetic' ou 'material'.

    cosmetic : formes substantives identiques, ou seules des fautes de frappe sont corrigées
    (remplacement mot à mot, ≤ 2 caractères d'écart, sans chiffre). Tout ajout, retrait de mot
    ou changement de chiffre est matériel (« Formellement déconseillé » → « Déconseillé »).
    """
    a, b = substantive_form(old_text), substantive_form(new_text)
    if a == b:
        return "cosmetic"
    ta, tb = a.split(), b.split()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if tag != "replace" or (i2 - i1) != (j2 - j1):
            return "material"
        for x, y in zip(ta[i1:i2], tb[j1:j2]):
            if any(c.isdigit() for c in x + y):
                return "material"
            if abs(len(x) - len(y)) > 2 or difflib.SequenceMatcher(None, x, y).ratio() < 0.75:
                return "material"
    return "cosmetic"
