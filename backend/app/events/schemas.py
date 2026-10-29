"""Schémas du lot 2 : une affirmation extraite est un objet validé (pas de champ libre non contrôlé).

Principe du plan §4 : séparer faits, déclarations et attributions. Un texte libre ne produit JAMAIS
une « observation » : au mieux une déclaration provisoire, à vérifier.
"""
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ClaimType(StrEnum):
    observation = "observation"   # mesure/fait structuré d'un capteur ou d'un opérateur
    declaration = "declaration"   # quelqu'un déclare/annonce (y compris l'article qui rapporte)
    inference = "inference"       # réservé : jamais produit par ce lot (pas d'IA, pas d'inférence)


class DeclarantKind(StrEnum):
    official = "official"
    measure = "measure"
    media = "media"


class OfficialScope(StrEnum):
    own_decision = "own_decision"
    own_measure = "own_measure"
    attribution = "attribution"    # accusation : prouve ce que l'auteur dit, pas la réalité
    none = "none"


class Certainty(StrEnum):
    structured = "structured"
    provisional = "provisional"


class Precision(StrEnum):
    instant = "instant"
    day = "day"
    month = "month"
    year = "year"
    unknown = "unknown"


class Category(StrEnum):
    # états et changements structurés
    travel_advice_state = "travel_advice_state"
    travel_advice_change = "travel_advice_change"
    airspace_advisory_state = "airspace_advisory_state"
    airspace_advisory = "airspace_advisory"
    czib_validity_extended = "czib_validity_extended"
    czib_removed_from_list = "czib_removed_from_list"
    security_posture_state = "security_posture_state"
    security_posture_change = "security_posture_change"
    cyber_advisory = "cyber_advisory"
    internet_outage = "internet_outage"
    # prose (qualification provisoire)
    closure_restriction = "closure_restriction"
    outage_reported = "outage_reported"
    weather_event = "weather_event"
    attack_alleged = "attack_alleged"
    sabotage_alleged = "sabotage_alleged"
    threat_statement = "threat_statement"
    military_exercise = "military_exercise"
    attribution_statement = "attribution_statement"
    nuclear_radiological_mention = "nuclear_radiological_mention"


# Catégories qui créent/alimentent un événement, et type d'événement correspondant.
# (Les « états » de référence — niveau de conseil au premier relevé — ne sont pas des événements.)
EVENT_TYPE: dict[Category, str] = {
    Category.travel_advice_change: "travel_advice_change",
    Category.airspace_advisory: "airspace_advisory",
    Category.czib_validity_extended: "airspace_advisory_extension",
    Category.security_posture_change: "security_posture_change",
    Category.cyber_advisory: "cyber_advisory",
    Category.internet_outage: "internet_outage",
    Category.closure_restriction: "closure_restriction",
    Category.outage_reported: "civil_disruption",
    Category.weather_event: "weather_event",
    Category.attack_alleged: "hostile_act_alleged",
    Category.sabotage_alleged: "hostile_act_alleged",
    Category.threat_statement: "rhetoric",
    Category.military_exercise: "military_exercise",
    Category.nuclear_radiological_mention: "nuclear_radiological_mention",
}

# Qualifications hostiles issues de prose : toujours provisoires + revue humaine (plan §6.3).
HOSTILE_CATEGORIES = {Category.attack_alleged, Category.sabotage_alleged, Category.nuclear_radiological_mention,
                      Category.attribution_statement}

# Fenêtre de rapprochement par type d'événement (heures). Un conseil aux voyageurs vit des semaines ;
# une fermeture ou une panne, quelques jours.
MATCH_WINDOW_H: dict[str, int] = {
    "travel_advice_change": 24 * 30, "airspace_advisory": 24 * 30, "airspace_advisory_extension": 24 * 30,
    "security_posture_change": 24 * 30, "cyber_advisory": 24 * 7, "internet_outage": 24,
    "closure_restriction": 48, "civil_disruption": 24, "weather_event": 48, "hostile_act_alleged": 48,
    "rhetoric": 48, "military_exercise": 72, "nuclear_radiological_mention": 48,
}


class ExtractedClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category
    claim_type: ClaimType
    statement: str = Field(min_length=3, max_length=2000)
    subject: str | None = None
    action: str | None = None
    place_text: str | None = None
    zone_codes: list[str] = []
    occurred_at: datetime | None = None
    occurred_precision: Precision = Precision.unknown
    period_start: datetime | None = None
    period_end: datetime | None = None
    negated: bool = False
    conditional: bool = False
    quoted_speaker: str | None = None
    declarant: str | None = None
    declarant_kind: DeclarantKind
    official_scope: OfficialScope = OfficialScope.none
    certainty: Certainty
    needs_review: bool = False
    review_reasons: list[str] = []
    params: dict[str, Any] = {}
    # provenance : extrait EXACT du texte conservé de la version, avec ses positions
    quote: str = Field(min_length=1)
    quote_start: int = Field(ge=0)
    quote_end: int = Field(gt=0)
    rule_id: str
    key_extra: str = ""   # discriminant de l'empreinte (valeur de niveau, identifiant CZIB…)

    @model_validator(mode="after")
    def _consistent(self):
        if self.quote_end - self.quote_start != len(self.quote):
            raise ValueError("positions de la citation incohérentes")
        if self.claim_type is ClaimType.inference:
            raise ValueError("ce lot ne produit aucune inférence")
        if self.claim_type is ClaimType.observation and self.certainty is not Certainty.structured:
            raise ValueError("une observation doit provenir d'un champ structuré")
        if self.category in HOSTILE_CATEGORIES and self.certainty is Certainty.provisional and not self.needs_review:
            raise ValueError("qualification hostile issue de prose : revue humaine obligatoire")
        return self


class Extraction(BaseModel):
    claims: list[ExtractedClaim] = []
    flags: list[str] = []          # ex. prompt_injection_suspected
    date_warnings: list[str] = []
