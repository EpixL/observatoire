"""Déduplication des DOCUMENTS par origine (plan §4) : URL, puis empreinte, puis quasi-doublon textuel.

Ce que l'on compte ensuite, c'est le nombre de GROUPES D'ORIGINE, pas le nombre d'articles :
une dépêche reprise par dix médias reste une seule origine. Ici, similarité = recouvrement de séquences de
mots (calcul déterministe). Une similarité modérée ne fusionne rien : elle ouvre une revue.
Aucun embedding, aucune similarité « sémantique ».
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events.extractors.common import fold
from app.models import Document, DocumentOrigin, DocumentVersion, OriginGroup, Review

SHINGLE = 4
MIN_TOKENS = 12
NEAR_DUPLICATE = 0.80       # recouvrement >= 0.80 : même texte (reprise, copie)
WIRE_CUE = 0.40             # >= 0.40 ET même agence citée ET < 48 h : reprise de dépêche réécrite
PROPOSE = 0.50              # >= 0.50 sans agence commune : on PROPOSE (revue), on ne fusionne pas
WIRE_WINDOW = timedelta(hours=48)
CANDIDATE_WINDOW = timedelta(days=7)


def body_of(text: str) -> str:
    """Texte sans le titre (1re ligne) : deux médias reprennent la même dépêche sous des titres différents."""
    return text.split("\n", 1)[1] if "\n" in text else text


def tokens(text: str) -> list[str]:
    return re.findall(r"\w+", fold(text))


def shingles(toks: list[str]) -> set[tuple[str, ...]]:
    if len(toks) < SHINGLE:
        return {tuple(toks)} if toks else set()
    return {tuple(toks[i:i + SHINGLE]) for i in range(len(toks) - SHINGLE + 1)}


def overlap(a: str, b: str) -> float:
    """Coefficient de recouvrement |A∩B| / min(|A|,|B|) sur le corps, ou sur le texte complet (le plus haut).
    Textes trop courts (< 12 mots) : égalité stricte seulement (pas de fausse proximité)."""
    best = 0.0
    for ta, tb in ((tokens(body_of(a)), tokens(body_of(b))), (tokens(a), tokens(b))):
        if min(len(ta), len(tb)) < MIN_TOKENS:
            if ta and ta == tb:
                best = max(best, 1.0)
            continue
        sa, sb = shingles(ta), shingles(tb)
        best = max(best, len(sa & sb) / min(len(sa), len(sb)))
    return best


def _group_of(session: Session, doc_id: int) -> int | None:
    row = session.get(DocumentOrigin, doc_id)
    return row.group_id if row else None


def _merge_groups(session: Session, keep: int, others: set[int]) -> None:
    for g in others - {keep}:
        for o in session.scalars(select(DocumentOrigin).where(DocumentOrigin.group_id == g)):
            o.group_id = keep
        session.flush()
        session.delete(session.get(OriginGroup, g))
    session.flush()


def assign_origin(session: Session, doc: Document, version: DocumentVersion, wire: str | None, now: datetime) -> DocumentOrigin:
    existing = session.get(DocumentOrigin, doc.id)
    if existing is not None:
        return existing

    candidates = session.execute(
        select(Document, DocumentVersion)
        .join(DocumentVersion, DocumentVersion.id == Document.current_version_id)
        .where(Document.id != doc.id,
               Document.first_seen_at >= doc.first_seen_at - CANDIDATE_WINDOW,
               Document.first_seen_at <= doc.first_seen_at + CANDIDATE_WINDOW)
    ).all()

    matches: list[tuple[Document, str, float]] = []
    proposals: list[tuple[Document, float]] = []
    for other, other_v in candidates:
        if other.canonical_url == doc.canonical_url:
            matches.append((other, "url", 1.0))
            continue
        if other_v.content_hash == version.content_hash:
            matches.append((other, "exact_hash", 1.0))
            continue
        sim = overlap(version.text, other_v.text)
        if sim >= NEAR_DUPLICATE:
            matches.append((other, "near_duplicate", sim))
        elif sim >= WIRE_CUE:
            # Mieux vaut sous-compter l'indépendance que la surestimer : même agence citée + même fenêtre = même origine.
            other_wire = _wire_of(session, other.id)
            if wire and other_wire == wire and abs(other.first_seen_at - doc.first_seen_at) <= WIRE_WINDOW:
                matches.append((other, "wire_cue", sim))
            elif sim >= PROPOSE:
                proposals.append((other, sim))

    if matches:
        matches.sort(key=lambda m: (-m[2], m[0].id))
        best, method, sim = matches[0]
        gid = _group_of(session, best.id)
        if gid is None:  # le document apparié n'avait pas encore de groupe (processus antérieur à ce lot)
            g = OriginGroup(method=method, wire_agency=wire, representative_document_id=best.id)
            session.add(g)
            session.flush()
            session.add(DocumentOrigin(document_id=best.id, group_id=g.id, method="seed"))
            gid = g.id
        other_groups = {g for m in matches[1:] if (g := _group_of(session, m[0].id)) is not None}
        if other_groups:
            _merge_groups(session, gid, other_groups)
        row = DocumentOrigin(document_id=doc.id, group_id=gid, method=method, similarity=round(sim, 3))
        session.add(row)
        group = session.get(OriginGroup, gid)
        if wire and not group.wire_agency:
            group.wire_agency = wire
        session.flush()
        return row

    g = OriginGroup(method="seed", wire_agency=wire, representative_document_id=doc.id)
    session.add(g)
    session.flush()
    row = DocumentOrigin(document_id=doc.id, group_id=g.id, method="seed")
    session.add(row)
    for other, sim in proposals[:3]:
        session.add(Review(kind="possible_same_origin", document_id=doc.id,
                           reason=f"recouvrement {sim:.2f} avec le document {other.id} ({other.source_id}) : même origine ? non fusionné automatiquement",
                           created_at=now))
    session.flush()
    return row


def _wire_of(session: Session, doc_id: int) -> str | None:
    row = session.get(DocumentOrigin, doc_id)
    if row is None:
        return None
    g = session.get(OriginGroup, row.group_id)
    return g.wire_agency if g else None


def count_independent_origins(session: Session, doc_ids: list[int]) -> int:
    """Origines indépendantes parmi ces documents : composantes connexes où deux documents sont reliés
    s'ils partagent un groupe d'origine OU la même famille d'origine (registre des sources)."""
    from app.models import Source
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    for d in doc_ids:
        doc = session.get(Document, d)
        src = session.get(Source, doc.source_id)
        node = f"d:{d}"
        find(node)
        gid = _group_of(session, d)
        if gid is not None:
            union(node, f"g:{gid}")
        union(node, f"f:{src.origin_family}")
    return len({find(f"d:{d}") for d in doc_ids})
