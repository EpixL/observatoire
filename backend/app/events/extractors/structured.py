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
# EASA — Conflict Zone Information Bulletins
CZIB = re.compile(r"czib[\s-]*(\d{4})-(\d{2,3})(?:\s*r(\d+))?")


def _czib_rows(text: str, ctx: DocCtx) -> dict[str, dict]:
    """Un bulletin = bloc de lignes depuis la ligne portant son identifiant jusqu'à l'identifiant suivant
    (la structure réelle de la page est à confirmer sur le Pi : identifiant et description peuvent être sur des lignes distinctes)."""
    marks = []
    for a, b, line in _line_spans(text):
        m = CZIB.search(fold(line))
        if m:
            marks.append((a, m))
    rows: dict[str, dict] = {}
    for i, (a, m) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        block = text[a:min(end, a + 600)].rstrip()
        f = fold(block)
        cid = f"{m[1]}-{m[2]}"
        until = None
        mu = re.search(r"valid until (.+)", f)
        if mu:
            until, _, _ = parse_date_in(mu.group(1), None)
        places = ctx.gazetteer.find(block)
        rows[cid] = {"id": cid, "revision": int(m[3]) if m[3] else 0, "valid_until": until, "zones": ctx.gazetteer.codes(block),
                     "place": places[0] if places else None, "a": a, "b": a + len(block), "line": block}
    return rows


def extract_czib(ctx: DocCtx) -> Extraction:
    ex = Extraction()
    cur = _czib_rows(ctx.version.text, ctx)
    prev = _czib_rows(ctx.prev_version.text, ctx) if ctx.prev_version is not None else None
    for cid, r in cur.items():
        base = dict(
            claim_type=ClaimType.declaration, statement=r["line"], place_text=r["place"].text if r["place"] else None,
            zone_codes=r["zones"], declarant="EASA", declarant_kind=DeclarantKind.official, official_scope=OfficialScope.own_decision,
            certainty=Certainty.structured, quote=r["line"], quote_start=r["a"], quote_end=r["b"],
        )
        vu = r["valid_until"].date().isoformat() if r["valid_until"] else None
        params = {"czib_id": cid, "revision": r["revision"], "valid_until": vu}
        ex.claims.append(ExtractedClaim(category=Category.airspace_advisory_state, params={**params, "change": "baseline"},
                                        key_extra=f"{cid}|r{r['revision']}|{vu}", rule_id="czib.state", **base))
        if prev is None:
            continue
        before = prev.get(cid)
        if before is None:
            ex.claims.append(ExtractedClaim(category=Category.airspace_advisory, params={**params, "change": "created"},
                                            key_extra=f"{cid}|created|r{r['revision']}", rule_id="czib.created", **base))
        elif r["revision"] > before["revision"]:
            ex.claims.append(ExtractedClaim(category=Category.airspace_advisory,
                                            params={**params, "change": "revised", "from_revision": before["revision"]},
                                            key_extra=f"{cid}|revised|r{r['revision']}", rule_id="czib.revised", **base))
        elif r["valid_until"] != before["valid_until"]:
            # Prolongation de validité seule : pas un changement de risque (plan §3).
            ex.claims.append(ExtractedClaim(category=Category.czib_validity_extended,
                                            params={**params, "change": "validity_only", "extension_only": True,
                                                    "from_valid_until": before["valid_until"].date().isoformat() if before["valid_until"] else None},
                                            key_extra=f"{cid}|validity|{vu}", rule_id="czib.validity", **base))
    if prev is not None:
        for cid, r in prev.items():
            if cid not in cur:
                head = ctx.version.text.split("\n")[0]
                ex.claims.append(ExtractedClaim(
                    category=Category.czib_removed_from_list, claim_type=ClaimType.declaration,
                    statement=f"CZIB {cid} n'apparaît plus dans la liste (ce n'est pas la preuve d'un retrait)",
                    zone_codes=r["zones"], declarant="EASA", declarant_kind=DeclarantKind.official, official_scope=OfficialScope.none,
                    certainty=Certainty.structured, needs_review=True, review_reasons=["absent_from_listing_not_proof_of_withdrawal"],
                    params={"czib_id": cid, "change": "absent"}, quote=head, quote_start=0, quote_end=len(head),
                    key_extra=f"{cid}|absent", rule_id="czib.absent"))
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
    if m:
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
    params["cve_count"] = len(set(re.findall(r"CVE-\d{4}-\d{4,7}", text)))
    params["not_geopolitical_indicator"] = True  # le nombre de CVE / un score n'est pas un indicateur d'escalade (plan §3)
    ex.claims.append(ExtractedClaim(
        category=Category.cyber_advisory, claim_type=ClaimType.declaration, statement=quote, place_text="France", zone_codes=["FR"],
        declarant=ctx.source.organisation, declarant_kind=DeclarantKind.official, official_scope=OfficialScope.own_decision,
        certainty=Certainty.structured, params=params, quote=quote, quote_start=qs, quote_end=qe,
        key_extra=str(params["cert_id"] or quote), rule_id="cert.advisory"))
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
