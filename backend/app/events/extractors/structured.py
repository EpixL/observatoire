"""Extracteurs de champs maîtrisés (vocabulaire fixe, formats stables) : plus fiables que la prose,
mais toujours des DÉCLARATIONS de leur auteur (l'avis d'un ministère, un bulletin EASA…), sauf les mesures
techniques (IODA) qui sont des observations d'un capteur. Les changements sont détectés en comparant
à la version précédente du même document : un premier relevé est une BASE, jamais un « changement »."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from app.events.extractors.common import DocCtx, fold, parse_date_in
from app.events.schemas import Category, Certainty, ClaimType, DeclarantKind, ExtractedClaim, Extraction, OfficialScope, Precision

# ---------------------------------------------------------------------------------------------------------------------
# France Diplomatie — niveaux de conseil
LEVELS = [  # (motif sur texte « fold », niveau, libellé) — ordre : du plus spécifique au moins
    (re.compile(r"formellement deconseille"), 4, "formellement déconseillé"),
    (re.compile(r"deconseille sauf raison imperative"), 3, "déconseillé sauf raison impérative"),
    (re.compile(r"vigilance renforcee"), 2, "vigilance renforcée"),
    (re.compile(r"vigilance normale"), 1, "vigilance normale"),
]
DEPARTURE = re.compile(r"\b(quitter le territoire|depart (?:recommande|conseille)|invites? a quitter|leave the country)\b")


def _line_spans(text: str):
    pos = 0
    for line in text.split("\n"):
        yield pos, pos + len(line), line
        pos += len(line) + 1


def _advice_by_subject(text: str, ctx: DocCtx) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for a, b, line in _line_spans(text):
        f = fold(line)
        for rx, level, label in LEVELS:
            m = rx.search(f)
            if not m:
                continue
            zones = ctx.gazetteer.codes(line)
            places = ctx.gazetteer.find(line)
            label_txt = re.split(r"\s*[:\-–]\s*", line, maxsplit=1)[0].strip()
            subject = (places[0].text.casefold() if places else label_txt.casefold())
            out[subject] = {"level": level, "label": label, "zones": zones, "place": places[0].text if places else label_txt,
                            "a": a, "b": b, "line": line, "departure": bool(DEPARTURE.search(f))}
            break
    return out


def extract_diplomatie(ctx: DocCtx) -> Extraction:
    ex = Extraction()
    cur = _advice_by_subject(ctx.version.text, ctx)
    prev = _advice_by_subject(ctx.prev_version.text, ctx) if ctx.prev_version is not None else None
    for subject, d in cur.items():
        common = dict(
            claim_type=ClaimType.declaration, statement=d["line"], place_text=d["place"], zone_codes=d["zones"],
            declarant=ctx.source.organisation, declarant_kind=DeclarantKind.official, official_scope=OfficialScope.own_decision,
            certainty=Certainty.structured, quote=d["line"], quote_start=d["a"], quote_end=d["b"],
        )
        params = {"subject": subject, "level": d["level"], "level_label": d["label"], "departure_recommended": d["departure"]}
        ex.claims.append(ExtractedClaim(category=Category.travel_advice_state, params=params, key_extra=f"{subject}|{d['level']}",
                                        rule_id="diplomatie.level_state", **common))
        if prev is not None:
            before = prev.get(subject)
            if before is None or before["level"] != d["level"]:
                direction = "added" if before is None else ("up" if d["level"] > before["level"] else "down")
                ex.claims.append(ExtractedClaim(
                    category=Category.travel_advice_change,
                    params={**params, "from_level": before["level"] if before else None, "direction": direction},
                    key_extra=f"{subject}|{before['level'] if before else None}->{d['level']}",
                    rule_id="diplomatie.level_change", **common))
    return ex


# ---------------------------------------------------------------------------------------------------------------------
# EASA — Conflict Zone Information Bulletins : un document par bulletin (champs fournis par le connecteur `easa_czib`)
def extract_czib(ctx: DocCtx) -> Extraction:
    ex = Extraction()
    s = ctx.version.structured or {}
    cid = s.get("czib_id")
    if not cid:
        ex.flags.append("czib_fields_missing")
        return ex
    prev = (ctx.prev_version.structured or {}) if ctx.prev_version is not None else None
    text = ctx.version.text
    title = s.get("title") or ""
    zones = ctx.gazetteer.codes(title)
    places = ctx.gazetteer.find(title)
    base = dict(
        claim_type=ClaimType.declaration, statement=text.replace("\n", " — "), place_text=places[0].text if places else title or None,
        zone_codes=zones, declarant="EASA", declarant_kind=DeclarantKind.official, official_scope=OfficialScope.own_decision,
        certainty=Certainty.structured, quote=text, quote_start=0, quote_end=len(text),
    )
    params = {"czib_id": cid, "revision": s.get("revision", 0), "valid_until": s.get("valid_until"), "status": s.get("status"),
              "issued": s.get("issued"), "revised": s.get("revised"), "url": s.get("url")}
    key = f"{cid}|r{params['revision']}|{params['valid_until']}|{params['status']}"
    ex.claims.append(ExtractedClaim(category=Category.airspace_advisory_state, params={**params, "change": "baseline"},
                                    key_extra=key, rule_id="czib.state", **base))
    if prev is None:
        if not ctx.in_baseline:  # bulletin apparu APRÈS le premier relevé : vraie création
            ex.claims.append(ExtractedClaim(category=Category.airspace_advisory, params={**params, "change": "created"},
                                            key_extra=f"{cid}|created|r{params['revision']}", rule_id="czib.created", **base))
        return ex
    if params["revision"] > prev.get("revision", 0):
        ex.claims.append(ExtractedClaim(category=Category.airspace_advisory,
                                        params={**params, "change": "revised", "from_revision": prev.get("revision", 0)},
                                        key_extra=f"{cid}|revised|r{params['revision']}", rule_id="czib.revised", **base))
    elif params["valid_until"] != prev.get("valid_until"):
        # Prolongation de validité seule : pas un changement de risque (plan §3).
        old, new_ = prev.get("valid_until"), params["valid_until"]
        direction = "extended" if (old and new_ and new_ > old) else ("shortened" if old and new_ else "changed")
        ex.claims.append(ExtractedClaim(category=Category.czib_validity_extended,
                                        params={**params, "change": "validity_only", "extension_only": True,
                                                "direction": direction, "from_valid_until": old},
                                        key_extra=f"{cid}|validity|{new_}", rule_id="czib.validity", **base))
    elif params["status"] != prev.get("status"):
        ex.claims.append(ExtractedClaim(category=Category.airspace_advisory,
                                        params={**params, "change": "status_changed", "from_status": prev.get("status")},
                                        needs_review=True, review_reasons=["status_change_semantics_unconfirmed"],
                                        key_extra=f"{cid}|status|{params['status']}", rule_id="czib.status", **base))
    return ex


# ---------------------------------------------------------------------------------------------------------------------
# Vigipirate
POSTURES = [
    (re.compile(r"urgence attentat"), 3, "Urgence attentat"),
    (re.compile(r"securite renforcee|risque attentat"), 2, "Sécurité renforcée – risque attentat"),
    (re.compile(r"vigilance"), 1, "Vigilance"),
]


def _posture(text: str):
    f = fold(text)
    m = re.search(r"posture en cours\s*:\s*([^.\n]+)", f)
    if not m:
        return None
    seg = m.group(1)
    for rx, level, label in POSTURES:
        if rx.search(seg):
            return {"level": level, "label": label, "a": m.start(), "b": m.end()}
    return None


def extract_vigipirate(ctx: DocCtx) -> Extraction:
    ex = Extraction()
    cur = _posture(ctx.version.text)
    if cur is None:
        ex.flags.append("posture_not_found")
        return ex
    prev = _posture(ctx.prev_version.text) if ctx.prev_version is not None else None
    quote = ctx.version.text[cur["a"]:cur["b"]]
    base = dict(claim_type=ClaimType.declaration, statement=quote, place_text="France", zone_codes=["FR"], declarant=ctx.source.organisation,
                declarant_kind=DeclarantKind.official, official_scope=OfficialScope.own_decision, certainty=Certainty.structured,
                quote=quote, quote_start=cur["a"], quote_end=cur["b"])
    params = {"level": cur["level"], "level_label": cur["label"]}
    ex.claims.append(ExtractedClaim(category=Category.security_posture_state, params=params, key_extra=f"{cur['level']}", rule_id="vigipirate.state", **base))
    if prev is not None and prev["level"] != cur["level"]:
        ex.claims.append(ExtractedClaim(category=Category.security_posture_change,
                                        params={**params, "from_level": prev["level"], "direction": "up" if cur["level"] > prev["level"] else "down"},
                                        key_extra=f"{prev['level']}->{cur['level']}", rule_id="vigipirate.change", **base))
    return ex


# ---------------------------------------------------------------------------------------------------------------------
# CERT-FR
CERT_ID = re.compile(r"CERTFR-\d{4}-(ALE|AVI|ACT|CTI|IOC|DUR)-\d+")
CERT_KIND = {"ALE": "alerte", "AVI": "avis", "ACT": "actualité", "CTI": "menace", "IOC": "indicateurs", "DUR": "durcissement"}


def extract_cert(ctx: DocCtx) -> Extraction:
    ex = Extraction()
    text = ctx.version.text
    m = CERT_ID.search(text)
    id_elsewhere = CERT_ID.search(f"{ctx.document.external_id} {ctx.document.canonical_url}")
    if m is None and id_elsewhere is not None:  # l'identifiant est dans le lien/guid, pas dans le texte : citation = titre
        title = (ctx.version.title or text.split("\n")[0])
        ts = text.find(title)
        quote, qs, qe = (title, ts, ts + len(title)) if ts >= 0 else (text.split("\n")[0], 0, len(text.split("\n")[0]))
        params = {"cert_id": id_elsewhere.group(0), "kind": CERT_KIND[id_elsewhere.group(1)]}
    elif m:
        a, b = m.span()
        line_end = text.find("\n", b)
        line_end = len(text) if line_end == -1 else line_end
        line_start = text.rfind("\n", 0, a) + 1
        quote, qs, qe = text[line_start:line_end], line_start, line_end
        params = {"cert_id": m.group(0), "kind": CERT_KIND[m.group(1)]}
    else:
        quote = (ctx.version.title or text.split("\n")[0])[:300]
        qs = text.find(quote)
        if qs < 0:
            quote, qs = text.split("\n")[0], 0
            qe = len(quote)
        else:
            qe = qs + len(quote)
        params = {"cert_id": None, "kind": "inconnu"}
    params["is_update"] = bool((ctx.version.structured or {}).get("is_update"))
    params["cve_count"] = len(set(re.findall(r"CVE-\d{4}-\d{4,7}", text)))
    params["not_geopolitical_indicator"] = True  # le nombre de CVE / un score n'est pas un indicateur d'escalade (plan §3)
    ex.claims.append(ExtractedClaim(
        category=Category.cyber_advisory, claim_type=ClaimType.declaration, statement=quote, place_text="France", zone_codes=["FR"],
        declarant=ctx.source.organisation, declarant_kind=DeclarantKind.official, official_scope=OfficialScope.own_decision,
        certainty=Certainty.structured, params=params, quote=quote, quote_start=qs, quote_end=qe,
        key_extra=str(params["cert_id"] or quote), rule_id="cert.advisory"))
    if ctx.prev_version is not None and ctx.version.change_kind == "material":
        # Mise à jour d'un avis existant ([MàJ]) : nouvelle version du MÊME document, donc une affirmation de plus dans le même dossier.
        ex.claims.append(ExtractedClaim(
            category=Category.cyber_advisory, claim_type=ClaimType.declaration, statement=quote, place_text="France", zone_codes=["FR"],
            declarant=ctx.source.organisation, declarant_kind=DeclarantKind.official, official_scope=OfficialScope.own_decision,
            certainty=Certainty.structured, params={**params, "change": "updated"}, quote=quote, quote_start=qs, quote_end=qe,
            key_extra=f"{params['cert_id'] or quote}|v{ctx.version.version_no}", rule_id="cert.updated"))
    return ex


# ---------------------------------------------------------------------------------------------------------------------
# IODA — mesure technique : observation d'un capteur, pas une attaque
def extract_ioda(ctx: DocCtx) -> Extraction:
    ex = Extraction()
    s = ctx.version.structured or {}
    start = s.get("start_epoch")
    if not isinstance(start, (int, float)):
        ex.flags.append("ioda_missing_start")
        return ex
    first_line = ctx.version.text.split("\n")[0]
    code = s.get("entity_code") or ""
    zone = [code] if len(code) == 2 else []
    score = s.get("score")
    dur = s.get("duration_s")
    t0 = datetime.fromtimestamp(start, tz=timezone.utc)
    ex.claims.append(ExtractedClaim(
        category=Category.internet_outage, claim_type=ClaimType.observation, statement=first_line,
        place_text=s.get("location"), zone_codes=zone, occurred_at=t0, occurred_precision=Precision.instant,
        period_start=t0, period_end=datetime.fromtimestamp(start + dur, tz=timezone.utc) if isinstance(dur, (int, float)) else None,
        declarant="IODA", declarant_kind=DeclarantKind.measure, certainty=Certainty.structured,
        params={"datasource": s.get("datasource"), "score": score, "duration_s": dur, "not_evidence_of_cyberattack": True},
        quote=first_line, quote_start=0, quote_end=len(first_line), key_extra=ctx.document.external_id, rule_id="ioda.outage"))
    return ex
