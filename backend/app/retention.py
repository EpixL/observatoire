"""Purge de l'historique normalisé au-delà de la rétention (décision de David : 12 mois).

Ce qui est conservé quoi qu'il arrive : les décisions humaines (`manual_annotations`), les événements qu'elles concernent et leurs
documents/affirmations/preuves (on ne supprime jamais ce sur quoi une décision s'appuie), les versions de seuils, leur historique et les
instantanés de jauge (ils portent déjà leur propre contexte). Une purge est un ordre explicite (CLI, ou tâche quotidienne du worker).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

DAYS_PER_MONTH = 30.4375


def purge_history(session: Session, now: datetime, *, months: int = 12, dry_run: bool = False) -> dict:
    cutoff = now - timedelta(days=round(months * DAYS_PER_MONTH))
    p = {"cutoff": cutoff}
    q = lambda sql: session.execute(text(sql), p)
    q("""create temp table _purge_docs on commit drop as
         select d.id from documents d
         where d.last_seen_at < :cutoff
           and not exists (select 1 from claims c join event_claims ec on ec.claim_id = c.id join manual_annotations a on a.event_id = ec.event_id
                           where c.document_id = d.id)""")
    q("create temp table _purge_claims on commit drop as select id from claims where document_id in (select id from _purge_docs)")
    q("create temp table _purge_versions on commit drop as select id from document_versions where document_id in (select id from _purge_docs)")
    n_docs = q("select count(*) from _purge_docs").scalar()
    counts = {"documents": n_docs, "claims": q("select count(*) from _purge_claims").scalar(),
              "versions": q("select count(*) from _purge_versions").scalar(), "cutoff": cutoff.isoformat()}
    if dry_run or not n_docs:
        counts["fetch_runs"] = q("select count(*) from fetch_runs where started_at < :cutoff").scalar()
        counts["observations"] = q("select count(*) from observations where observed_at < :cutoff").scalar()
        if dry_run:
            session.rollback()
            counts["dry_run"] = True
            return counts
    if n_docs:
        q("delete from evidence_links where claim_id in (select id from _purge_claims) or document_version_id in (select id from _purge_versions)")
        q("delete from reviews where claim_id in (select id from _purge_claims) or document_id in (select id from _purge_docs)")
        q("delete from event_claims where claim_id in (select id from _purge_claims)")
        q("delete from claims where id in (select id from _purge_claims)")
        q("""create temp table _purge_events on commit drop as
             select e.id from events e where not exists (select 1 from event_claims ec where ec.event_id = e.id)
               and not exists (select 1 from manual_annotations a where a.event_id = e.id)""")
        q("delete from event_links where event_a_id in (select id from _purge_events) or event_b_id in (select id from _purge_events)")
        q("delete from reviews where event_id in (select id from _purge_events)")
        counts["events"] = q("delete from events where id in (select id from _purge_events)").rowcount
        q("delete from document_origins where document_id in (select id from _purge_docs)")
        q("delete from origin_groups g where not exists (select 1 from document_origins o where o.group_id = g.id)")
        q("delete from version_processing where version_id in (select id from _purge_versions)")
        q("delete from document_versions where id in (select id from _purge_versions)")
        q("delete from documents where id in (select id from _purge_docs)")
    counts["fetch_runs"] = q("delete from fetch_runs where started_at < :cutoff").rowcount
    counts["observations"] = q("delete from observations where observed_at < :cutoff").rowcount
    return counts
