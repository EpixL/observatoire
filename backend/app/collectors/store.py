"""Stockage des documents et versions (append-only), snapshots bruts, observations."""
from __future__ import annotations

import gzip
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.collectors.base import FetchedItem, FetchResult
from app.models import Document, DocumentVersion, Observation, Source
from app.normalization.dates import parse_publication_date
from app.normalization.text import classify_change, content_hash, normalize_text, sha256_hex, substantive_hash
from app.normalization.urls import canonicalize_url


@dataclass
class IngestCounts:
    items_seen: int = 0
    new_documents: int = 0
    new_versions: int = 0       # versions matérielles (hors première)
    cosmetic_versions: int = 0


def write_snapshot(snapshot_dir: Path, source_id: str, body: bytes, now: datetime) -> tuple[str, str]:
    """Écrit le corps brut compressé, nommé par son empreinte (dédupliqué). Retourne (chemin relatif, sha256)."""
    digest = sha256_hex(body)
    rel = Path(source_id) / f"{now:%Y}" / f"{now:%m}" / f"{digest[:24]}.gz"
    target = snapshot_dir / rel
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        with gzip.open(tmp, "wb") as fh:
            fh.write(body)
        tmp.replace(target)
    return str(rel), digest


def purge_snapshots(snapshot_dir: Path, source_id: str, retention_days: int, now: datetime) -> int:
    """Supprime les snapshots plus vieux que la rétention (le texte normalisé reste en base)."""
    removed = 0
    base = snapshot_dir / source_id
    if not base.exists():
        return 0
    cutoff = now.timestamp() - retention_days * 86400
    for f in base.rglob("*.gz"):
        if f.stat().st_mtime < cutoff:
            f.unlink()
            removed += 1
    return removed


def ingest(session: Session, source: Source, result: FetchResult, now: datetime, snapshot_dir: Path | None) -> IngestCounts:
    counts = IngestCounts()
    snapshot: tuple[str, str] | None = None
    tz = source.options.get("default_tz", "Europe/Paris")

    for item in result.items:
        counts.items_seen += 1
        text = normalize_text(item.text)
        chash, shash = content_hash(text), substantive_hash(text)
        doc = session.scalar(select(Document).where(Document.source_id == source.id, Document.external_id == item.external_id))
        pub = parse_publication_date(item.published_raw, default_tz=tz, reference=now)
        if item.structured.get("is_update") and "old_publication" in pub.flags:
            # La date fournie est celle de l'avis d'origine, pas celle de cette mise à jour : on le dit, sans la jeter.
            pub.flags = [f for f in pub.flags if f != "old_publication"] + ["published_at_is_original_date"]

        if doc is None:
            kind, version_no = "initial", 1
            flags = list(pub.flags)
            doc = Document(
                source_id=source.id, external_id=item.external_id, canonical_url=canonicalize_url(item.url),
                title=item.title, first_seen_at=now, last_seen_at=now, published_at=pub.value,
                published_at_raw=pub.raw, date_flags=flags, version_count=0,
            )
            session.add(doc)
            session.flush()
            counts.new_documents += 1
        else:
            doc.last_seen_at = now
            current = session.get(DocumentVersion, doc.current_version_id)
            if current is not None and current.content_hash == chash:
                continue  # rien de neuf
            kind = "cosmetic" if (current is not None and (current.substantive_hash == shash or classify_change(current.text, text) == "cosmetic")) else "material"
            version_no = doc.version_count + 1
            doc.title = item.title or doc.title
            if item.structured.get("is_update"):  # cette version est une mise à jour : la date du document reste celle de l'origine
                doc.date_flags = [f for f in (doc.date_flags or []) if f != "old_publication"] + (
                    ["published_at_is_original_date"] if "published_at_is_original_date" not in (doc.date_flags or []) else [])
            if doc.published_at is None and pub.value is not None:
                doc.published_at, doc.published_at_raw, doc.date_flags = pub.value, pub.raw, list(pub.flags)

        if snapshot is None and result.raw_body is not None and snapshot_dir is not None:
            snapshot = write_snapshot(snapshot_dir, source.id, result.raw_body, now)
        version = DocumentVersion(
            document_id=doc.id, version_no=version_no, change_kind=kind, retrieved_at=now, available_at=now,
            published_at=pub.value, final_url=result.final_url or item.url, http_status=result.http_status,
            etag=result.etag, last_modified=result.last_modified, title=item.title, text=text,
            content_hash=chash, substantive_hash=shash,
            raw_hash=snapshot[1] if snapshot else None, snapshot_path=snapshot[0] if snapshot else None,
            structured=item.structured,
        )
        session.add(version)
        session.flush()
        doc.version_count = version_no
        doc.current_version_id = version.id
        if kind == "material":
            counts.new_versions += 1
        elif kind == "cosmetic":
            counts.cosmetic_versions += 1

    for ob in result.observations:
        stmt = pg_insert(Observation).values(
            source_id=source.id, entity_type=ob.entity_type, entity_code=ob.entity_code, metric=ob.metric,
            observed_at=ob.observed_at, retrieved_at=now, value=ob.value, meta=ob.meta,
        ).on_conflict_do_nothing(index_elements=["source_id", "entity_type", "entity_code", "metric", "observed_at"])
        session.execute(stmt)
    return counts
