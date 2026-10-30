"""Chargement de la configuration du lot 3 : échelle + seuils du plan, territoires, profils de couverture."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml


@dataclass(frozen=True)
class ThresholdDef:
    key: str
    label: str
    description: str
    unit: str
    plan: float
    min: float
    max: float
    step: float
    affects: str


@dataclass(frozen=True)
class Palier:
    value: int
    label: str
    definition: str


@dataclass(frozen=True)
class Territory:
    id: str
    label: str
    zones: frozenset[str]
    default: bool = False


@dataclass(frozen=True)
class Family:
    id: str
    label: str
    essential: tuple[tuple[str, str | None], ...]   # (source, secours éventuel)


@dataclass(frozen=True)
class Profile:
    baseline_source: str
    families: tuple[Family, ...]


@dataclass(frozen=True)
class GaugeConfig:
    paliers: tuple[Palier, ...]
    thresholds: tuple[ThresholdDef, ...]
    territories: tuple[Territory, ...]
    profiles: dict[str, Profile]

    def threshold(self, key: str) -> ThresholdDef:
        return next(t for t in self.thresholds if t.key == key)

    def plan_params(self) -> dict[str, float]:
        return {t.key: t.plan for t in self.thresholds}

    def territory(self, tid: str) -> Territory | None:
        return next((t for t in self.territories if t.id == tid), None)


@lru_cache(maxsize=4)
def load_gauge_config(config_dir: str) -> GaugeConfig:
    root = Path(config_dir)
    scale = yaml.safe_load((root / "index-scale.yaml").read_text(encoding="utf-8"))
    terr = yaml.safe_load((root / "territories.yaml").read_text(encoding="utf-8"))
    prof = yaml.safe_load((root / "coverage-profiles.yaml").read_text(encoding="utf-8"))
    paliers = tuple(Palier(p["value"], p["label"], p["definition"]) for p in scale["paliers"])
    assert [p.value for p in paliers] == [0, 10, 25, 40, 55, 70, 85, 100], "les huit paliers du plan ne sont pas modifiables"
    thresholds = tuple(ThresholdDef(t["key"], t["label"], t["description"], t["unit"], t["plan"], t["min"], t["max"], t["step"], t["affects"])
                       for t in scale["thresholds"])
    territories = tuple(Territory(t["id"], t["label"], frozenset(t["zones"]), bool(t.get("default"))) for t in terr["territories"])
    profiles = {
        tid: Profile(p["baseline_source"], tuple(
            Family(f["id"], f["label"], tuple((e["source"], e.get("backup")) for e in f["essential"])) for f in p["families"]))
        for tid, p in prof["profiles"].items()
    }
    return GaugeConfig(paliers, thresholds, territories, profiles)
