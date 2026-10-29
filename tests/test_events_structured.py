"""Lot 2 — extracteurs structurés, de la collecte (faux serveur HTTP, fixtures fictives) jusqu'aux événements."""
from __future__ import annotations

import httpx
from sqlalchemy import select

from app.collectors.runner import run_source
from app.db import session_scope
from app.events.provenance import verify_all
from app.models import Claim

from conftest import fixture_bytes, make_client
from corpus_helpers import claims, events, process

DIPLO = "https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs"
EASA = "https://www.easa.europa.eu/en/domains/air-operations/czibs"
VIGI = "https://www.sgdsn.gouv.fr/nos-missions/proteger-la-population/vigipirate"
CERT = "https://cert.cyber.gouv.fr/alerte/feed/"
HTML = {"content-type": "text/html"}


def page_server(state):
    return make_client(lambda r: httpx.Response(200, headers=HTML, content=state["body"]))


def collect_and_process(sources, settings, clock, rng, sid, http):
    run_source(sources, sid, http, settings, clock=clock, rng=rng)
    return process(sources, clock.now)


def test_conseil_voyageurs_premier_releve_est_une_base_pas_un_changement(sources, settings, clock, rng):
    state = {"body": fixture_bytes("pages/diplomatie_cv_v1.html")}
    collect_and_process(sources, settings, clock, rng, "france-diplomatie-cv", page_server(state))
    cats = sorted(c.category for c in claims(sources))
    assert cats == ["travel_advice_state", "travel_advice_state"]        # aucune « escalade » inventée au démarrage
    assert events(sources) == []                                         # une base n'est pas un événement


def test_conseil_voyageurs_changement_de_niveau_cree_un_evenement_trace(sources, settings, clock, rng):
    state = {"body": fixture_bytes("pages/diplomatie_cv_v1.html")}
    http = page_server(state)
    collect_and_process(sources, settings, clock, rng, "france-diplomatie-cv", http)
    clock.advance(minutes=20)
    state["body"] = fixture_bytes("pages/diplomatie_cv_v2_material.html")
    collect_and_process(sources, settings, clock, rng, "france-diplomatie-cv", http)
    ch = claims(sources, category="travel_advice_change")
    assert len(ch) == 1
    p = ch[0].params
    assert (p["from_level"], p["level"], p["direction"]) == (3, 4, "up") and p["departure_recommended"] is True
    assert ch[0].claim_type == "declaration" and ch[0].official_scope == "own_decision" and ch[0].certainty == "structured"
    ev = events(sources)
    assert [e.event_type for e in ev] == ["travel_advice_change"] and ev[0].status == "active"   # champs structurés : pas "à vérifier"
    with session_scope(sources) as s:
        assert verify_all(s)["bad"] == 0


def test_mise_a_jour_de_date_seule_ne_produit_aucun_changement(sources, settings, clock, rng):
    state = {"body": fixture_bytes("pages/diplomatie_cv_v1.html")}
    http = page_server(state)
    collect_and_process(sources, settings, clock, rng, "france-diplomatie-cv", http)
    clock.advance(minutes=20)
    state["body"] = fixture_bytes("pages/diplomatie_cv_v1_dateonly.html")
    out = collect_and_process(sources, settings, clock, rng, "france-diplomatie-cv", http)
    assert out["skipped_cosmetic"] == 1 and claims(sources, category="travel_advice_change") == [] and events(sources) == []


def _easa(sources, settings, clock, rng, state):
    return collect_and_process(sources, settings, clock, rng, "easa-czib", page_server(state))


def test_czib_premier_releve_est_une_base_puis_nouveau_bulletin_et_prolongation_distingues(sources, settings, clock, rng):
    state = {"body": fixture_bytes("pages/easa_real_rows.html")}
    http = page_server(state)
    collect_and_process(sources, settings, clock, rng, "easa-czib", http)
    base = claims(sources)
    assert {c.category for c in base} == {"airspace_advisory_state"} and len(base) == 2 and events(sources) == []   # arriéré = base
    mali = next(c for c in base if c.params["czib_id"] == "2017-01")
    assert mali.zone_codes == ["ML"] and mali.params["revision"] == 21 and mali.params["valid_until"] == "2027-04-30"

    clock.advance(minutes=30)   # hors de la fenêtre de base : un bulletin apparu maintenant est une vraie création
    new_row = fixture_bytes("pages/easa_real_rows.html").replace(b"</tbody>", b"""<tr><td class="views-field views-field-field-easa-conflict-zone-up-date">29/10/2026</td>
<td class="views-field views-field-field-easa-conflict-zone-revdate">29/10/2026</td><td class="views-field views-field-field-easa-conflict-zone-until">29/04/2027</td>
<td><div class="cz-title">Airspace of Fictivia</div><div class="czib_number">CZIB-2026-09</div><div class="cz-status">Active</div><a href="/en/domains/air-operations/czibs/czib-2026-09">d</a></td></tr></tbody>""")
    state["body"] = new_row
    collect_and_process(sources, settings, clock, rng, "easa-czib", http)
    created = claims(sources, category="airspace_advisory")
    assert len(created) == 1 and created[0].params["czib_id"] == "2026-09" and created[0].params["change"] == "created"

    clock.advance(minutes=30)
    state["body"] = new_row.replace(b"30/04/2027", b"31/10/2027")      # même révision R21, validité repoussée
    collect_and_process(sources, settings, clock, rng, "easa-czib", http)
    ext = claims(sources, category="czib_validity_extended")
    assert len(ext) == 1 and ext[0].params["extension_only"] and ext[0].params["direction"] == "extended" and ext[0].params["valid_until"] == "2027-10-31"
    assert sorted(e.event_type for e in events(sources)) == ["airspace_advisory", "airspace_advisory_extension"]   # prolongation ≠ risque
    with session_scope(sources) as s:
        assert verify_all(s)["bad"] == 0


def test_czib_nouvelle_revision_est_un_changement_de_fond(sources, settings, clock, rng):
    state = {"body": fixture_bytes("pages/easa_real_rows.html")}
    http = page_server(state)
    collect_and_process(sources, settings, clock, rng, "easa-czib", http)
    clock.advance(minutes=30)
    state["body"] = fixture_bytes("pages/easa_real_rows.html").replace(b"CZIB-2017-01R21", b"CZIB-2017-01R22").replace(b"30/09/2026", b"29/10/2026")
    collect_and_process(sources, settings, clock, rng, "easa-czib", http)
    rev = claims(sources, category="airspace_advisory")
    assert len(rev) == 1 and rev[0].params["change"] == "revised" and (rev[0].params["from_revision"], rev[0].params["revision"]) == (21, 22)
    with session_scope(sources) as s:
        from app.models import Document
        d = next(x for x in s.scalars(select(Document)) if x.external_id == "czib-2017-01")
        assert d.version_count == 2          # une nouvelle révision = nouvelle version matérielle du même bulletin


def test_vigipirate_changement_de_posture(sources, settings, clock, rng):
    state = {"body": fixture_bytes("pages/vigipirate_v1.html")}
    http = page_server(state)
    collect_and_process(sources, settings, clock, rng, "sgdsn-vigipirate", http)
    assert [c.params["level"] for c in claims(sources, category="security_posture_state")] == [1] and events(sources) == []
    clock.advance(minutes=20)
    state["body"] = fixture_bytes("pages/vigipirate_v2_urgence.html")
    collect_and_process(sources, settings, clock, rng, "sgdsn-vigipirate", http)
    ch = claims(sources, category="security_posture_change")[0]
    assert (ch.params["from_level"], ch.params["level"], ch.params["direction"]) == (1, 3, "up") and ch.zone_codes == ["FR"]
    ev = events(sources)[0]
    assert ev.event_type == "security_posture_change" and ev.zone_code == "FR"


def test_cert_fr_alerte_cyber_n_est_pas_un_indicateur_geopolitique(sources, settings, clock, rng):
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/rss+xml"}, content=fixture_bytes("feeds/cert_fr_alertes.xml")))
    collect_and_process(sources, settings, clock, rng, "cert-fr-alertes", http)
    cs = claims(sources, category="cyber_advisory")
    assert sorted(c.params["cert_id"] for c in cs) == ["CERTFR-2026-ALE-001", "CERTFR-2026-ALE-002"]
    assert all(c.params["not_geopolitical_indicator"] and c.zone_codes == ["FR"] for c in cs)
    assert len(events(sources)) == 2         # une alerte = un événement distinct (jamais fusionnées entre elles)


def test_ioda_mesure_devient_observation_structuree_sans_cyberattaque(sources, settings, clock, rng):
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/json"}, content=fixture_bytes("json/ioda_events_fr.json")))
    collect_and_process(sources, settings, clock, rng, "ioda-fr", http)
    cs = claims(sources, category="internet_outage")
    assert len(cs) == 2 and all(c.claim_type == "observation" and c.certainty == "structured" and c.declarant_kind == "measure" for c in cs)
    assert all(c.params["not_evidence_of_cyberattack"] for c in cs) and all(c.zone_codes == ["FR"] for c in cs)
    assert all(c.occurred_precision == "instant" for c in cs)
    ev = events(sources)
    assert len(ev) == 1 and ev[0].event_type == "internet_outage" and ev[0].document_count == 2   # deux signaux, même pays, même jour
    assert ev[0].origin_count == 1                                       # même famille d'origine (ioda) : une seule origine
    assert ev[0].status == "active"


def test_retraitement_est_idempotent(sources, settings, clock, rng):
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/rss+xml"}, content=fixture_bytes("feeds/cert_fr_alertes.xml")))
    collect_and_process(sources, settings, clock, rng, "cert-fr-alertes", http)
    n_claims, n_events = len(claims(sources)), len(events(sources))
    again = process(sources, clock.now)
    assert again == {"processed": 0, "skipped_cosmetic": 0, "errors": 0}
    assert (len(claims(sources)), len(events(sources))) == (n_claims, n_events)


def test_aucun_historique_fictif_sans_collecte(sources):
    out = process(sources)
    assert out["processed"] == 0 and claims(sources) == [] and events(sources) == []


def test_cert_arriere_ancien_et_maj_du_premier_releve_ne_sont_pas_des_nouveautes(sources, settings, clock, rng):
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/rss+xml"}, content=fixture_bytes("feeds/cert_fr_maj_mixed_order.xml")))
    collect_and_process(sources, settings, clock, rng, "cert-fr-alertes", http)
    by_id = {c.params["cert_id"]: c for c in claims(sources, category="cyber_advisory")}
    assert by_id["CERTFR-2015-ALE-9001"].stale                              # avis de 2015 : arriéré
    assert by_id["CERTFR-2024-ALE-9002"].stale and "update_date_unknown_in_baseline_backlog" in by_id["CERTFR-2024-ALE-9002"].review_reasons
    assert not by_id["CERTFR-2026-ALE-9003"].stale                          # vraiment récent : nouveauté
    active = [e for e in events(sources) if e.status != "historical"]
    assert len(active) == 1 and active[0].novelty == "new"                   # l'ordre du flux n'a aucune importance


def test_cert_maj_apres_le_premier_releve_est_une_nouvelle_version_datee_de_maintenant(sources, settings, clock, rng):
    base = fixture_bytes("feeds/cert_fr_maj_mixed_order.xml")
    plain = base.replace("[MàJ] ".encode(), b"")
    state = {"body": plain}
    http = make_client(lambda r: httpx.Response(200, headers={"content-type": "application/rss+xml"}, content=state["body"]))
    collect_and_process(sources, settings, clock, rng, "cert-fr-alertes", http)
    clock.advance(hours=3)
    state["body"] = base                         # l'avis 2024 réapparaît avec « [MàJ] », pubDate = date d'origine
    collect_and_process(sources, settings, clock, rng, "cert-fr-alertes", http)
    with session_scope(sources) as s:
        from app.models import Document
        d = next(x for x in s.scalars(select(Document)) if x.external_id == "CERTFR-2024-ALE-9002")
        assert d.version_count == 2 and "published_at_is_original_date" in d.date_flags and "old_publication" not in d.date_flags
        assert [v.change_kind for v in d.versions] == ["initial", "material"]
    upd = [c for c in claims(sources, category="cyber_advisory") if c.params.get("change") == "updated"]
    assert len(upd) == 1 and not upd[0].stale
    ev = next(e for e in events(sources) if e.id and e.status != "historical" and e.ref_at == clock.now)
    assert ev.ref_at.year == 2026             # datée de la mise à jour observée, pas de 2024
