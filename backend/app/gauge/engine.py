"""Moteur de règles de la jauge — entièrement scripté, sans IA, sans somme de points (plan §6.3).

Le palier retenu est le plus élevé dont TOUTES les conditions sont remplies. Cent signaux faibles n'atteignent jamais un palier
supérieur à 10 ; plus de sources ou de capteurs ne font jamais monter un palier à eux seuls.

Les paliers 70/85/100 ne viennent QUE d'annotations humaines validées (prose = provisoire, plan §6.3). Les événements de
prose non revus restent « en attente de revue » : ils empêchent « 0 » mais ne font pas monter l'indice au-delà de 10.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events.dedup import count_independent_origins
from app.gauge.config import GaugeConfig, Territory
from app.models import Claim, Document, Event, EventClaim, EventLink, ManualAnnotation

RULES_VERSION = "regles-jauge-1.0"

FAMILY = {"authorities": "Autorités et mesures", "regional_facts": "Faits régionaux", "technical": "Mesure technique"}
HOSTILE_QUALS = {"grave_hostile_act": 70, "armed_attack": 85, "sustained_conflict": 100}
CORRECTIVE_QUALS = {"not_hostile", "resolved", "retracted", "confirmed_civil_incident"}
ALL_QUALS = set(HOSTILE_QUALS) | CORRECTIVE_QUALS | {"exercise_excluded"}
MAJOR_PENDING_TYPES = {"hostile_act_alleged", "nuclear_radiological_mention"}


@dataclass
class EV:
    id: int
    type: str
    zone: str | None
    title: str
    status: str
    ref_at: datetime
    last_update_at: datetime
    origin_count: int
    doc_ids: list[int]
    role: str = "ignored"      # material | weak | rhetoric | context | pending_major | ignored
    family: str | None = None
    direct: bool = False
    flags: set = field(default_factory=set)
    why: str = ""
    annotation: ManualAnnotation | None = None


@dataclass
class Criterion:
    palier: int
    criterion: str
    state: str = "non_rempli"   # rempli | non_rempli | non_evalue
    note: str = ""
    event_ids: list[int] = field(default_factory=list)


@dataclass
class EngineResult:
    palier: int | None           # plus haut palier dont les conditions sont remplies (None = aucun critère actif)
    rule_id: str
    criteria: list[Criterion]
    events: list[EV]
    floor: int                   # plus haut palier ANNOTÉ (70/85/100) : ne baisse que sur résolution documentée
    pending_major: list[EV]
    evidence_ids: list[int]


def valid_annotation(a: ManualAnnotation) -> bool:
    """Les faits, la zone, la période et l'acteur doivent être documentés séparément (plan §6.3)."""
    d = a.details or {}
    if a.qualification not in HOSTILE_QUALS:
        return True
    base = all(d.get(k) is True for k in ("facts_established", "zone_established", "period_established", "actor_established"))
    if a.qualification == "armed_attack":
        return base and d.get("state_actor") is True
    if a.qualification == "sustained_conflict":
        return base and d.get("state_actor") is True and d.get("campaign_established") is True
    return base


def _latest_annotations(session: Session, event_ids: list[int]) -> dict[int, ManualAnnotation]:
    out: dict[int, ManualAnnotation] = {}
    if not event_ids:
        return out
    for a in session.scalars(select(ManualAnnotation).where(ManualAnnotation.event_id.in_(event_ids)).order_by(ManualAnnotation.id)):
        out[a.event_id] = a   # la plus récente l'emporte ; l'historique reste en base
    return out


def _classify(session: Session, ev: EV, params: dict) -> None:
    claims = session.execute(
        select(Claim, EventClaim.role).join(EventClaim, EventClaim.claim_id == Claim.id).where(EventClaim.event_id == ev.id)).all()
    positive = [c for c, role in claims if not c.negated and role != "contradiction"]
    contradicted = any(role == "contradiction" for _, role in claims)
    if contradicted:
        ev.flags.add("contradicted")
    o25 = int(params["origins_for_25"])
    t = ev.type
    p = lambda c: c.params or {}

    if t in ("cyber_advisory", "weather_event", "airspace_advisory_extension"):
        ev.role, ev.why = "context", {"cyber_advisory": "alerte cyber : information, pas un indicateur d'escalade",
                                      "weather_event": "météo : variable d'explication",
                                      "airspace_advisory_extension": "prolongation de validité seule : pas un changement de risque"}[t]
        return
    if t == "military_exercise":
        ev.role, ev.why = "context", "exercice annoncé : contexte, pas une offensive"
        ev.flags.add("exercise")
        return
    if t == "rhetoric":
        ev.role, ev.why = "rhetoric", "rhétorique ou menace verbale : plafonnée au palier 10"
        return
    if t in MAJOR_PENDING_TYPES:
        ev.role, ev.why = "pending_major", "qualification hostile issue de prose : en attente de revue humaine"
        ev.family = "regional_facts"
        return
    if t == "travel_advice_change":
        if any(p(c).get("direction") in ("up", "added") and (p(c).get("level") or 0) >= 2 for c in positive):
            ev.role, ev.family, ev.direct, ev.why = "material", "authorities", True, "conseil aux voyageurs durci (décision de l'autorité)"
        else:
            ev.role, ev.why = "context", "conseil assoupli ou inchangé sur le fond"
        return
    if t == "airspace_advisory":
        if any(p(c).get("change") in ("created", "revised") for c in positive):
            ev.role, ev.family, ev.direct, ev.why = "material", "authorities", True, "bulletin de zone de conflit créé ou révisé (EASA)"
        else:
            ev.role, ev.why = "weak", "bulletin modifié sans portée établie"
            ev.family = "authorities"
        return
    if t == "security_posture_change":
        if any(p(c).get("direction") == "up" for c in positive):
            ev.role, ev.family, ev.direct, ev.why = "material", "authorities", True, "posture Vigipirate relevée"
            ev.flags.add("posture_up")
        else:
            ev.role, ev.why = "context", "posture abaissée"
        return
    if t == "internet_outage":
        ev.role, ev.family, ev.direct, ev.why = "material", "technical", True, "interruption Internet mesurée (IODA) ; ne prouve ni cyberattaque ni acte hostile"
        return
    if t in ("closure_restriction", "civil_disruption"):
        official = any(c.declarant_kind == "official" and c.official_scope in ("own_measure", "own_decision") for c in positive) or \
            any(c.confirmation == "official" for c in positive)
        if official or ev.origin_count >= o25:
            ev.role, ev.family = "material", ("authorities" if official else "regional_facts")
            ev.direct = official
            ev.why = "mesure confirmée par l'autorité" if official else f"{ev.origin_count} origines indépendantes rapportent le fait"
        else:
            ev.role, ev.family = "weak", "regional_facts"
            ev.why = f"{ev.origin_count} origine(s) indépendante(s) et sans confirmation officielle : signal isolé"
        return
    ev.role, ev.why = "ignored", f"type {t} sans règle de jauge"


def load_events(session: Session, territory: Territory, params: dict, now: datetime) -> list[EV]:
    rows = session.scalars(select(Event).where(Event.zone_code.in_(sorted(territory.zones)), Event.status != "historical").order_by(Event.id)).all()
    annotations = _latest_annotations(session, [e.id for e in rows])
    out: list[EV] = []
    for e in rows:
        docs = [d for (d,) in session.execute(select(Claim.document_id).join(EventClaim, EventClaim.claim_id == Claim.id)
                                              .where(EventClaim.event_id == e.id, EventClaim.role != "contradiction").distinct())]
        ev = EV(e.id, e.event_type, e.zone_code, e.title, e.status, e.ref_at, e.last_update_at, e.origin_count, docs)
        _classify(session, ev, params)
        a = annotations.get(e.id)
        if a is not None:
            ev.annotation = a
            if a.qualification in CORRECTIVE_QUALS:
                ev.role, ev.why = "ignored", f"corrigé par revue humaine ({a.qualification})"
                ev.flags.add("corrected")
            elif a.qualification in HOSTILE_QUALS:
                ev.role, ev.family, ev.direct = "grave", "regional_facts", True
                ev.why = f"qualifié « {a.qualification} » par revue humaine ({a.actor})"
                if not valid_annotation(a):
                    ev.role, ev.why = "pending_major", "annotation incomplète (faits, zone, période, acteur) : non retenue"
            elif a.qualification == "exercise_excluded":
                ev.flags.add("exercise_excluded")
        out.append(ev)
    return out


def _active(ev: EV, expiry_h: float, now: datetime) -> bool:
    return now - ev.last_update_at <= timedelta(hours=expiry_h)


def _components(ids: set[int], links: list[tuple[int, int]]) -> list[set[int]]:
    """Composantes connexes de `ids` dans le graphe de TOUS les liens de cause commune (transitivité : une même tempête reliée à
    deux événements les explique tous les deux, même si ces deux-là ne sont pas reliés directement)."""
    parent: dict[int, int] = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in links:
        parent[find(a)] = find(b)
    comps: dict[int, set[int]] = {}
    for i in ids:
        comps.setdefault(find(i), set()).add(i)
    return list(comps.values())


def evaluate(session: Session, cfg: GaugeConfig, territory: Territory, params: dict, now: datetime) -> EngineResult:
    events = load_events(session, territory, params, now)
    expiry = float(params["weak_signal_expiry_h"])
    window = timedelta(hours=float(params["convergence_window_h"]))
    n40, f40 = int(params["events_for_40"]), int(params["families_for_40"])

    live = [e for e in events if e.role != "ignored" and (e.role == "grave" or _active(e, expiry, now))]
    material = [e for e in live if e.role == "material"]
    weak = [e for e in live if e.role in ("weak", "rhetoric")]
    pending = [e for e in events if e.role == "pending_major"]
    grave = [e for e in events if e.role == "grave"]

    crit = {p.value: Criterion(p.value, p.label) for p in cfg.paliers}

    # 0 est géré par le moteur d'instantané (couverture) ; ici : le plus haut palier dont les critères sont remplis.
    c = crit[0]
    c.state, c.note = "non_evalue", "dépend de la couverture et de l'absence de situation majeure en attente (voir couverture)"

    c = crit[10]
    sig = material + weak + pending      # une qualification hostile en attente de revue ne s'éteint pas d'elle-même : au moins le palier 10
    if sig:
        c.state, c.event_ids = "rempli", sorted({e.id for e in sig})
        c.note = "observation pertinente vérifiable ; la rhétorique seule est plafonnée à ce palier" if not material else "observations pertinentes"
    else:
        c.note = "aucune observation pertinente active"

    c = crit[25]
    if material:
        c.state, c.event_ids = "rempli", sorted(e.id for e in material)
        c.note = "acte matériel ou mesure documentée : " + " ; ".join(sorted({e.why for e in material})[:3])
    else:
        c.note = "aucun acte matériel documenté (preuve directe ou origines indépendantes en nombre suffisant)"

    # 40 : cluster d'événements matériels, même zone, même fenêtre, plusieurs familles, origines indépendantes, pas une cause commune unique
    c = crit[40]
    links = [(l.event_a_id, l.event_b_id) for l in session.scalars(select(EventLink).where(EventLink.link_type == "possible_common_cause"))]
    best_note = f"moins de {n40} événements matériels distincts"
    by_zone: dict[str | None, list[EV]] = {}
    for e in material:
        by_zone.setdefault(e.zone, []).append(e)
    for zone, evs in by_zone.items():
        evs.sort(key=lambda e: e.ref_at)
        for i, first in enumerate(evs):
            cluster = [e for e in evs[i:] if e.ref_at - first.ref_at <= window]
            fams = {e.family for e in cluster if e.family}
            if len(cluster) < n40:
                continue
            if len(fams) < f40:
                best_note = f"{len(cluster)} événements mais {len(fams)} famille(s) d'indicateurs sur {f40} requises"
                continue
            origins = count_independent_origins(session, sorted({d for e in cluster for d in e.doc_ids}))
            if origins < 2:
                best_note = f"{len(cluster)} événements mais {origins} origine indépendante : pas de convergence"
                continue
            comps = _components({e.id for e in cluster}, links)
            if len(comps) == 1 and len(cluster) > 1:
                best_note = "un lien de cause commune ordinaire (météo, panne) relie tous ces événements : examen requis, convergence non retenue"
                continue
            c.state, c.event_ids = "rempli", sorted(e.id for e in cluster)
            c.note = f"{len(cluster)} événements matériels, {len(fams)} familles, {origins} origines indépendantes, zone {zone}, fenêtre {window.total_seconds() / 3600:g} h"
            break
        if c.state == "rempli":
            break
    if c.state != "rempli":
        c.note = best_note

    # 55 : posture relevée + mesure civile/diplomatique de précaution + alternative exercice examinée
    c = crit[55]
    posture = [e for e in material if "posture_up" in e.flags]
    precaution = [e for e in material if e.type in ("travel_advice_change", "airspace_advisory") or (e.type == "closure_restriction" and e.direct)]
    exercises = [e for e in events if "exercise" in e.flags and _active(e, expiry, now)]
    if posture and precaution:
        near = [(a, b) for a in posture for b in precaution if abs(a.ref_at - b.ref_at) <= window]
        if near:
            ex_open = [e for e in exercises if "exercise_excluded" not in e.flags and
                       any(abs(e.ref_at - a.ref_at) <= window for a, _ in near)]
            ex_cleared = any("exercise_excluded" in x.flags for x in events)
            if ex_open and not ex_cleared:
                c.state, c.note = "non_evalue", "exercice annoncé dans la même fenêtre : alternative à écarter par revue humaine (qualification « exercise_excluded »)"
            else:
                c.state = "rempli"
                c.event_ids = sorted({a.id for a, _ in near} | {b.id for _, b in near})
                c.note = "posture relevée et mesure de précaution liée ; alternative exercice/défense examinée"
        else:
            c.note = "posture et précaution présentes mais hors de la fenêtre commune"
    else:
        c.note = "pas de changement de posture documenté associé à une mesure de précaution"

    # 70 / 85 / 100 : annotations humaines validées uniquement
    for pal in (70, 85, 100):
        c = crit[pal]
        hit = [e for e in grave if e.annotation and HOSTILE_QUALS[e.annotation.qualification] >= pal]
        if hit:
            c.state, c.event_ids = "rempli", sorted(e.id for e in hit)
            c.note = "établi par revue humaine : " + "; ".join(sorted({e.annotation.qualification for e in hit}))
        elif pending:
            c.state, c.note = "non_evalue", f"{len(pending)} événement(s) hostile(s) alléguée(s) en attente de revue humaine : non retenus"
        else:
            c.note = "aucune qualification humaine correspondante"

    filled = [k for k, v in crit.items() if v.state == "rempli" and k > 0]
    palier = max(filled) if filled else None
    floor = max([HOSTILE_QUALS[e.annotation.qualification] for e in grave], default=0)
    rule_id = f"R-P{palier}" if palier is not None else "R-P0"
    ids = crit[palier].event_ids if palier is not None else []
    return EngineResult(palier, rule_id, [crit[p.value] for p in cfg.paliers], events, floor, pending, ids)
