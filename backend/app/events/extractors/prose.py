"""Extracteur de prose — volontairement conservateur (plan §6.7).

« Contient le mot attaque » n'est JAMAIS transformé en « attaque avérée » : tout ce qui sort d'ici est une
DÉCLARATION provisoire (celle de l'article, de l'autorité ou de la personne citée), jamais une observation.
Les qualifications hostiles sont toujours marquées « à vérifier ». Ce qui n'est pas compris reste dans la file
des documents à qualifier. Aucun LLM, aucune inférence.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.events.extractors.common import DocCtx, fold, parse_date_in
from app.events.schemas import (
    Category, Certainty, ClaimType, DeclarantKind, ExtractedClaim, Extraction, HOSTILE_CATEGORIES, OfficialScope, Precision,
)

EXTRACTOR = "prose/1"

# ---- lexique (sur texte « fold » : minuscules, sans accents) -------------------------------------------------------
ATTACK = re.compile(r"\b(attaq\w*|frappe[sr]?\b|frappes\b|bombard\w*|missiles?|drones?|explosions?|incursions?|raids?|strikes?|shelling|bombing|assault|invasion|cyberattaque\w*)")
SABOTAGE = re.compile(r"\b(sabotage\w*|saboteurs?|sabotaged?)\b")
CLOSURE_VERB = re.compile(r"\b(ferm\w+|suspen\w+|interdit\w*|interdiction\w*|restrictions?|clos\w*|closed|closures?|suspended|banned|prohibited|no-fly)\b")
CLOSURE_OBJ = re.compile(r"\b(aeroports?|aerodromes?|espace aerien|frontieres?|ports?|gares?|ponts?|routes?|autoroutes?|airports?|airspace|borders?|crossings?|railways?)\b")
OUTAGE_VERB = re.compile(r"\b(pannes?|coupures?|interruptions?|blackouts?|black-out|outages?|power cuts?|deconnect\w*)\b")
OUTAGE_OBJ = re.compile(r"\b(electricite|courant|electriques?|reseau electrique|internet|telephon\w*|mobiles?|telecom\w*|power|grid|network|reseau)\b")
WEATHER = re.compile(r"\b(tempetes?|orages?|inondations?|crues?|neige|verglas|canicule|ouragans?|cyclones?|tornades?|storms?|floods?\w*|hurricanes?|snow)\b")
EXERCISE = re.compile(r"\b(exercices?|manoeuvres?|simulations?|simule\w*|entrainements?|drills?|exercises?|wargames?)\b")
THREAT = re.compile(r"\b(menac\w*|threat\w*|risque d[e']|ultimatum|avertit|warns?)\b")
CONDITIONAL = re.compile(r"\b(pourrai\w*|pourrait|au cas ou|eventuel\w*|hypothe\w*|scenario|could|would|might|should|si\b)")
NUCLEAR = re.compile(r"\b(nucleaire\w*|radiolog\w*|radioactiv\w*|radiations?|nuclear|radiological)\b")
NEGATION = re.compile(
    r"\b(aucune?s?|pas d['e ]|pas de|(?:ne|n')\s?(?:\w+\s){0,3}?(?:pas|plus|jamais)|sans|dement\w*|nie[nt]?s?|ecarte\w*|exclu\w*|infirm\w*|"
    r"non confirme\w*|no|not|denies|denied|rejects?|ruled out|without|nothing)\b"
)
NEG_LATE = re.compile(r"\b(n['e] ?(?:est|a|sont|ont)(?: \w+)? pas|non (?:confirme|avere|etabli)|pas (?:confirme|avere|etabli)|has not been|have not been|remains? unconfirmed)\b")
REPORT_VERB = re.compile(
    r"\b(affirm\w+|annonc\w+|indiqu\w+|declar\w+|evoqu\w+|assur\w+|confirm\w+|dement\w+|accus\w+|attribu\w+|impute\w*|"
    r"says?|said|announced?|claims?|claimed|states?|stated|alleges?|denies|denied|accuses?|blames?|attributes?)\b"
)
ATTRIBUTION = re.compile(r"\b(attribu\w+|impute\w*|accus\w+|blames?|attributes?|attributed|accuses?)\b")
OWN_MEASURE_VERB = re.compile(r"\b(annonc\w+|decid\w+|ferm\w+|interdit\w*|suspend\w*|instaur\w+|ordonn\w+|announces?|announced|closes|closed|suspends?|bans?)\b")
INJECTION = re.compile(
    r"(ignore[zr]? (?:toutes? )?(?:les |tes |vos )?(?:instructions|consignes)|ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts?)|"
    r"disregard (?:the |all )?(?:above|previous)|system prompt|you are now|tu es maintenant|nouvelles instructions|as an ai|en tant qu'ia|<\s*system\s*>|"
    r"classe (?:cet|cette|ce) \w+ (?:au )?niveau)", re.I)
WIRE = re.compile(r"\((afp|reuters|ap|dpa|ansa|efe|tass|xinhua|anadolu)\)|\b(?:selon|source|d'apres|according to) (?:l[' ]|the )?(afp|reuters|ap|associated press)\b", re.I)
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")

FACILITY_KIND = {"aeroport": "airport", "aerodrome": "airport", "airport": "airport", "espace aerien": "airspace", "airspace": "airspace",
                 "frontiere": "border", "border": "border", "crossing": "border", "port": "port", "gare": "station", "railway": "station"}
SERVICE_KIND = {"electricite": "power", "courant": "power", "electrique": "power", "power": "power", "grid": "power",
                "internet": "internet", "telephon": "telecom", "mobile": "telecom", "telecom": "telecom", "network": "network", "reseau": "network"}


@dataclass
class Sentence:
    start: int
    end: int
    text: str


def split_sentences(text: str) -> list[Sentence]:
    out, pos = [], 0
    for m in list(SENT_SPLIT.finditer(text)) + [None]:
        end = m.start() if m else len(text)
        raw = text[pos:end]
        stripped = raw.strip()
        if stripped:
            lead = len(raw) - len(raw.lstrip())
            out.append(Sentence(pos + lead, pos + lead + len(stripped), stripped))
        pos = m.end() if m else len(text)
    return out


_LATE_STOP = re.compile(r"[,;]| si | mais | alors | tandis | while | but | although ")


def _negated(f: str, cue_start: int) -> bool:
    """Négation portant sur le terme repéré : juste avant (70 car.) ou juste après dans le même groupe de mots
    (« attaque n'est pas confirmée »). La négation d'une autre proposition (« … si les sanctions ne sont pas
    levées ») ne compte pas."""
    before = f[max(0, cue_start - 70):cue_start]
    if NEGATION.search(before):
        return True
    tail = _LATE_STOP.split(f[cue_start:cue_start + 60], maxsplit=1)[0]
    return bool(NEG_LATE.search(tail))


def _declarant(sentence_text: str, f: str, ctx: DocCtx) -> tuple[str | None, str | None]:
    """(déclarant, personne citée). Repli : l'organisme de la source (média ou autorité)."""
    m = re.search(r"\b(?:selon|d'apres|according to) (?:l[' ]|la |le |les |the )?([^,;.]{3,60})", f)
    if m:
        s, e = m.span(1)
        return sentence_text[s:e].strip(), None
    v = REPORT_VERB.search(f)
    if v:
        pre = sentence_text[max(0, v.start() - 70):v.start()]
        pre = re.split(r"[,;:]| et | mais | alors que | tandis que | que ", pre)[-1].strip()
        pre = re.sub(r"^(?:a|ont|has|have)\s+", "", pre).strip()
        if re.match(r"^(?:le |la |les |l'|l’)?(?:ministere|gouvernement|armee|autorites?|prefecture|police|porte-parole|presidence|operateur|compagnie|agence|ambassade|otan|nato|state|ministry|government|army|spokes\w+)", fold(pre)) or (pre[:1].isupper() and len(pre.split()) <= 6):
            return pre, pre
    return ctx.source.organisation, None


def _declarant_kind(ctx: DocCtx) -> DeclarantKind:
    return DeclarantKind.official if ctx.source.source_type in ("autorite", "operateur") else (
        DeclarantKind.measure if ctx.source.source_type == "mesure" else DeclarantKind.media)


def _claim(ctx, sent: Sentence, quote_rel: tuple[int, int], category: Category, text: str, f: str, *, negated: bool,
           conditional: bool, extra_params: dict | None = None, declarant=None, speaker=None, scope=OfficialScope.none,
           rule: str, ref_time) -> ExtractedClaim:
    a, b = sent.start + quote_rel[0], sent.start + quote_rel[1]
    quote = ctx.version.text[a:b]
    zones = ctx.gazetteer.codes(quote)
    places = ctx.gazetteer.find(quote)
    zone_from_context = False
    if not zones:  # lieu absent de la phrase : titre, puis document s'il ne parle que d'une seule zone
        zones = ctx.gazetteer.codes(ctx.version.title or "")
        if not zones:
            whole = ctx.gazetteer.codes(ctx.version.text)
            zones = whole if len(whole) == 1 else []
        zone_from_context = bool(zones)
    occ, prec, dflags = parse_date_in(fold(quote), ref_time)
    needs_review = category in HOSTILE_CATEGORIES or conditional
    reasons: list[str] = []
    if category in HOSTILE_CATEGORIES:
        reasons.append("prose_qualification_provisional")
    if conditional:
        reasons.append("conditional_or_hypothetical")
    reasons += dflags
    params = dict(extra_params or {})
    if zone_from_context:
        params["zone_from_context"] = True
    actors = [a_ for a_ in ctx.gazetteer.actors(quote) if a_ not in zones]
    if actors:
        params["actors"] = actors
    return ExtractedClaim(
        category=category, claim_type=ClaimType.declaration, statement=quote, place_text=places[0].text if places else None,
        zone_codes=zones, occurred_at=occ, occurred_precision=prec, negated=negated, conditional=conditional,
        quoted_speaker=speaker, declarant=declarant, declarant_kind=_declarant_kind(ctx), official_scope=scope,
        certainty=Certainty.provisional, needs_review=needs_review, review_reasons=reasons, params=params,
        quote=quote, quote_start=a, quote_end=b, rule_id=rule,
    )


def extract_prose(ctx: DocCtx) -> Extraction:
    text = ctx.version.text
    out = Extraction()
    if INJECTION.search(text):
        # La phrase d'injection est une DONNÉE : elle ne change rien à l'extraction (aucune instruction exécutée).
        out.flags.append("prompt_injection_suspected")
    wire = WIRE.search(text)
    if wire:
        out.flags.append(f"wire:{(wire.group(1) or wire.group(2)).lower()}")
    doc_pub = ctx.document.published_at if "future" not in (ctx.document.date_flags or []) else None
    ref_time = doc_pub or ctx.document.first_seen_at
    title_exercise = bool(EXERCISE.search(fold(ctx.version.title or "")))

    for sent in split_sentences(text):
        st = sent.text
        f = fold(st)
        if INJECTION.search(st):
            continue  # la phrase d'injection elle-même n'est jamais extraite comme affirmation
        declarant, speaker = _declarant(st, f, ctx)
        measure_scope = OfficialScope.own_measure if (ctx.source.source_type in ("autorite", "operateur") and OWN_MEASURE_VERB.search(f)) else OfficialScope.none

        # --- attribution : « … et l'attribue à l'État X » = AFFIRMATION DISTINCTE (plan §4) ---
        attr = ATTRIBUTION.search(f)
        main_end = len(st)
        if attr:
            clause_start = attr.start()
            lead = re.search(r"(?:\bet |, )(?:l'|la |le |les |en )?$", f[:clause_start])
            if lead:
                clause_start = lead.start()
            main_end = clause_start
            clause = st[attr.start():]
            attributed = ctx.gazetteer.actors(clause)
            if not attributed:
                m = re.search(r"\ba (?:l'|la |le )?(?:etat |État |Etat |pays |gouvernement )?([A-ZÉ][\w-]+)", clause)
                attributed = [m.group(1)] if m else []
            neg = _negated(f, attr.start())
            out.claims.append(_claim(
                ctx, sent, (clause_start if lead else attr.start(), len(st)), Category.attribution_statement, st, f,
                negated=neg, conditional=bool(CONDITIONAL.search(f[attr.start():])), declarant=declarant, speaker=speaker,
                scope=OfficialScope.attribution, rule="prose.attribution", ref_time=ref_time,
                extra_params={"attributed_to": attributed, "attribution_by": declarant},
            ))

        main_f, main_t = f[:main_end], st[:main_end]
        if not main_t.strip():
            continue
        exercise = bool(EXERCISE.search(main_f))
        conditional = bool(CONDITIONAL.search(main_f))
        threat = bool(THREAT.search(main_f))

        def add(cat, span, rule, params=None, scope=OfficialScope.none, neg=None, cond=None):
            c0 = span[0]
            n = _negated(main_f, c0) if neg is None else neg
            out.claims.append(_claim(ctx, sent, (c0, span[1]), cat, st, f, negated=n,
                                     conditional=conditional if cond is None else cond,
                                     declarant=declarant, speaker=speaker, scope=scope, rule=rule,
                                     ref_time=ref_time, extra_params=params))

        span = (0, main_end)
        if exercise:
            add(Category.military_exercise, span, "prose.exercise", {"mentions_attack_wording": bool(ATTACK.search(main_f))}, neg=False, cond=False)
        else:
            sab = SABOTAGE.search(main_f)
            atk = ATTACK.search(main_f)
            if sab:
                add(Category.sabotage_alleged, span, "prose.sabotage", None, neg=_negated(main_f, sab.start()))
            if atk and not sab:
                cat = Category.threat_statement if (threat or conditional) and not _negated(main_f, atk.start()) else Category.attack_alleged
                add(cat, span, "prose.attack", {"cue": atk.group(1)}, neg=_negated(main_f, atk.start()),
                    cond=conditional if cat is Category.attack_alleged else bool(conditional))
            clo, cobj = CLOSURE_VERB.search(main_f), CLOSURE_OBJ.search(main_f)
            if clo and cobj:
                add(Category.closure_restriction, span, "prose.closure", {"facility": FACILITY_KIND.get(cobj.group(1).rstrip("s"), cobj.group(1))},
                    scope=measure_scope, neg=_negated(main_f, clo.start()))
            ov, oo = OUTAGE_VERB.search(main_f), OUTAGE_OBJ.search(main_f)
            if ov and oo:
                service = next((v for k, v in SERVICE_KIND.items() if oo.group(1).startswith(k)), oo.group(1))
                add(Category.outage_reported, span, "prose.outage", {"service": service}, neg=_negated(main_f, ov.start()))
            w = WEATHER.search(main_f)
            if w:
                add(Category.weather_event, span, "prose.weather", {"phenomenon": w.group(1)}, neg=_negated(main_f, w.start()))
            n = NUCLEAR.search(main_f)
            if n:
                add(Category.nuclear_radiological_mention, span, "prose.nuclear",
                    {"threat_wording": threat, "kind": "mention_only"}, neg=_negated(main_f, n.start()))

    if title_exercise:
        for c in out.claims:
            c.params["exercise_context_in_title"] = True
            c.needs_review = True
            if "exercise_context_in_title" not in c.review_reasons:
                c.review_reasons.append("exercise_context_in_title")
    return out
