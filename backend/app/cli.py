"""Ligne de commande : python -m app.cli <commande>   (voir docs/runbook.md)."""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from sqlalchemy import select

from app.collectors.http import PoliteClient
from app.collectors.registry import load_source_configs, sync_sources
from app.collectors.runner import run_source, serve
from app.config import load_settings
from app.db import make_engine, make_session_factory, session_scope
from app.models import ConnectorHealth, Source


def _factory(settings):
    return make_session_factory(make_engine(settings.database_url))


def cmd_migrate(args, settings):
    from alembic import command
    from alembic.config import Config
    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    os.environ.setdefault("MIGRATION_DATABASE_URL", settings.database_url)
    command.upgrade(cfg, "head")
    print("migrations appliquées")


def cmd_sync(args, settings):
    with session_scope(_factory(settings)) as s:
        print(sync_sources(s, load_source_configs(settings.config_dir / "sources.yaml")))


def cmd_run_once(args, settings):
    factory = _factory(settings)
    http = PoliteClient(user_agent=settings.user_agent, timeout_s=settings.http_timeout_s,
                        max_body_bytes=settings.max_body_bytes, respect_robots=settings.respect_robots)
    with session_scope(factory) as s:
        ids = [args.source] if args.source else [r for r in s.scalars(select(Source.id).where(Source.enabled.is_(True)).order_by(Source.id))]
    for sid in ids:
        res = run_source(factory, sid, http, settings)
        print(f"{sid:<24} {res.outcome:<14} items={len(res.items)} {res.error or ''}")
    http.close()


def cmd_worker(args, settings):
    serve(_factory(settings), settings)


def cmd_health(args, settings):
    with session_scope(_factory(settings)) as s:
        rows = s.execute(select(Source, ConnectorHealth).join(ConnectorHealth, ConnectorHealth.source_id == Source.id).order_by(Source.id)).all()
        out = [{"source": src.id, "enabled": src.enabled, "state": h.state, "failures": h.consecutive_failures,
                "last_success": h.last_success_at and h.last_success_at.isoformat(), "last_new": h.last_new_at and h.last_new_at.isoformat(),
                "next_run": h.next_run_at and h.next_run_at.isoformat(), "http": h.last_http_status, "error": h.last_error,
                "verification": src.verification_status} for src, h in rows]
    if args.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        for o in out:
            print(f"{o['source']:<24} {o['state']:<13} fails={o['failures']} http={o['http']} new={o['last_new']} {o['error'] or ''}")


def cmd_smoke(args, settings):
    from app import smoke
    configs = load_source_configs(settings.config_dir / "sources.yaml")
    report = smoke.run_smoke(configs, settings, only=args.source, include_disabled=args.all,
                             save_dir=Path(args.save_fixtures) if args.save_fixtures else None)
    print(smoke.render(report))
    smoke.dump(report, Path(args.report))
    print(f"\nrapport : {args.report}")
    sys.exit(0 if all(r["verdict"] in ("OK", "OK_EMPTY", "SKIPPED") for r in report["results"]) else 1)


def cmd_discover(args, settings):
    from app import discover
    cfg = next(c for c in load_source_configs(settings.config_dir / "sources.yaml") if c.id == args.source)
    http = PoliteClient(user_agent=settings.user_agent, respect_robots=settings.respect_robots)
    for f in discover.discover(Source(**cfg.model_dump()), http):
        print(f"{f['via']:<14} {f['type'] or '-':<28} {f['url']}  {f['title'] or ''}")
    http.close()


def cmd_process(args, settings):
    from app.events.pipeline import process_pending
    with session_scope(_factory(settings)) as s:
        print(process_pending(s, limit=args.limit))


def cmd_verify(args, settings):
    from app.events.provenance import verify_all
    with session_scope(_factory(settings)) as s:
        report = verify_all(s)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    sys.exit(0 if report["bad"] == 0 else 1)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="observatoire")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    sub.add_parser("sync-sources").set_defaults(fn=cmd_sync)
    p = sub.add_parser("run-once"); p.add_argument("--source"); p.set_defaults(fn=cmd_run_once)
    sub.add_parser("worker").set_defaults(fn=cmd_worker)
    p = sub.add_parser("health"); p.add_argument("--json", action="store_true"); p.set_defaults(fn=cmd_health)
    p = sub.add_parser("smoke"); p.add_argument("--source"); p.add_argument("--all", action="store_true", help="inclut les sources désactivées")
    p.add_argument("--save-fixtures"); p.add_argument("--report", default="smoke-report.json"); p.set_defaults(fn=cmd_smoke)
    p = sub.add_parser("discover-feeds"); p.add_argument("source"); p.set_defaults(fn=cmd_discover)
    p = sub.add_parser("process"); p.add_argument("--limit", type=int, default=500); p.set_defaults(fn=cmd_process)
    sub.add_parser("verify-provenance").set_defaults(fn=cmd_verify)
    args = ap.parse_args(argv)
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args.fn(args, load_settings(require_db=args.cmd not in ("smoke", "discover-feeds")))


if __name__ == "__main__":
    main()
