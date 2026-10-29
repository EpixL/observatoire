"""Gazetier déterministe : repère des lieux dans un texte par correspondance de mots entiers."""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml


@dataclass(frozen=True)
class PlaceMatch:
    code: str
    text: str
    start: int
    end: int


class Gazetteer:
    def __init__(self, data: dict):
        self.french_territory: set[str] = set(data["french_territory"])
        self.parent: dict[str, str] = {z["code"]: z["parent"] for z in data["zones"] if z.get("parent")}
        self.region: dict[str, str] = {z["code"]: z.get("region", "") for z in data["zones"]}
        pairs = [(name, z["code"]) for z in data["zones"] for name in z["names"]]
        pairs.sort(key=lambda p: -len(p[0]))  # le nom le plus long gagne (« Corée du Nord » avant « Corée »)
        self._lookup = {name.casefold(): code for name, code in pairs}
        alternation = "|".join(re.escape(n) for n, _ in pairs)
        self._re = re.compile(rf"(?<![\w-])({alternation})(?![\w-])", re.IGNORECASE)
        # Acteurs : noms de pays ET gentilés (« missile russe » désigne un acteur russe, pas un lieu).
        apairs = pairs + [(d, z["code"]) for z in data["zones"] for d in z.get("demonyms", [])]
        apairs.sort(key=lambda p: -len(p[0]))
        self._alookup = {n.casefold(): c for n, c in apairs}
        aalt = "|".join(re.escape(n) for n, _ in apairs)
        self._are = re.compile(rf"(?<![\w-])({aalt})(?![\w-])", re.IGNORECASE)

    def find(self, text: str) -> list[PlaceMatch]:
        out: list[PlaceMatch] = []
        for m in self._re.finditer(text):
            out.append(PlaceMatch(self._lookup[m.group(1).casefold()], m.group(1), m.start(1), m.end(1)))
        return out

    def codes(self, text: str) -> list[str]:
        seen: list[str] = []
        for m in self.find(text):
            if m.code not in seen:
                seen.append(m.code)
        return seen

    def actors(self, text: str) -> list[str]:
        seen: list[str] = []
        for m in self._are.finditer(text):
            code = self._alookup[m.group(1).casefold()]
            if code not in seen:
                seen.append(code)
        return seen

    def is_french_territory(self, code: str | None) -> bool:
        return code in self.french_territory if code else False

    def root(self, code: str) -> str:
        """Code de rattachement (outre-mer -> FR). Sert à regrouper les événements d'un même territoire."""
        return self.parent.get(code, code)


@lru_cache(maxsize=4)
def load_gazetteer(path: str | Path) -> Gazetteer:
    return Gazetteer(yaml.safe_load(Path(path).read_text(encoding="utf-8")))
