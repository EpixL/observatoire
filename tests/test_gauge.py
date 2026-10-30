"""Lot 3 — jauge 0-100 par paliers, couverture, seuils versionnés (plan §6, §13)."""
from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.db import session_scope
from app.gauge import policy
from app.gauge.policy import PolicyError
from app.models import Event, IndexPolicyVersion, IndexSnapshot, ThresholdChange

from corpus_helpers import T0, add_source, claims, events, process, put
from gauge_helpers import CFG, FULL, annotate_event, coverage_ok, evaluate, ioda_outage, official_closure, pal, vigipirate


def now(h=0, m=10):
    return T0 + timedelta(hours=h, minutes=m)


# ---------------------------------------------------------------------------------------------------------------------
# Seuils versionnés
def test_v1_is_the_plan_and_every_change_creates_a_new_dated_version(sources):
    with session_scope(sources) as s:
        v1 = policy.current_policy(s, CFG, T0)
        assert (v1.label, v1.kind, v1.params["events_for_40"]) == ("seuils-v1", "plan", 2)
        v2 = policy.change_thresholds(s, CFG, [{"key": "events_for_40", "to": 3}, {"key": "downgrade_evals", "to": 1}],
                                      "essai sur les oscillations", True, "seuils-v1", "David", T0 + timedelta(hours=1))
        assert (v2.label, v2.params["events_for_40"], v2.params["downgrade_evals"]) == ("seuils-v2", 3, 1)
        state = policy.thresholds_state(s, CFG, T0)
        item = next(i for i in state["items"] if i["key"] == "events_for_40")
        assert (item["value"], item["plan_value"]) == (3, 2)             # valeur courante ET valeur du plan toujours renvoyées
        assert {h["key"] for h in state["history"]} == {"events_for_40", "downgrade_evals"}
        assert state["history"][0]["actor"] == "David" and state["history"][0]["policy_version"] == "seuils-v2"
        assert s.get(IndexPolicyVersion, v1.id).params["events_for_40"] == 2   # l'ancienne version n'a pas bougé


@pytest.mark.parametrize("changes,reason,confirmed,expected,status,code", [
    ([{"key": "events_for_40", "to": 3}], "assez long", False, None, 422, "confirmation_required"),
    ([{"key": "events_for_40", "to": 3}], "court", True, None, 422, "reason_required"),
    ([{"key": "events_for_40", "to": 9}], "motif suffisant", True, None, 422, "out_of_bounds"),
    ([{"key": "anomaly_mad_k", "to": 3.2}], "motif suffisant", True, None, 422, "off_step"),
    ([{"key": "inconnu", "to": 1}], "motif suffisant", True, None, 422, "unknown_key"),
    ([{"key": "events_for_40", "to": 2}], "motif suffisant", True, None, 422, "no_change"),
    ([{"key": "events_for_40", "to": 3}], "motif suffisant", True, "seuils-v7", 409, "stale_policy_version"),
    ([], "motif suffisant", True, None, 422, "no_change"),
])
def test_threshold_guards_are_enforced_server_side(sources, changes, reason, confirmed, expected, status, code):
    with session_scope(sources) as s:
        with pytest.raises(PolicyError) as e:
            policy.change_thresholds(s, CFG, changes, reason, confirmed, expected, "David", T0)
        assert (e.value.status, e.value.code) == (status, code)


def test_reset_restores_plan_values_as_one_more_change_and_keeps_history(sources):
    with session_scope(sources) as s:
        policy.change_thresholds(s, CFG, [{"key": "origins_for_25", "to": 3}], "essai de prudence", True, None, "David", T0)
        v3 = policy.reset_to_plan(s, CFG, "retour aux valeurs du plan", True, "seuils-v2", "David", T0 + timedelta(hours=2))
        assert v3.kind == "retour_plan" and v3.params == {k: float(v) for k, v in CFG.plan_params().items()} and v3.label == "seuils-v3"
        kinds = [h["kind"] for h in policy.history(s, CFG)]
        assert kinds == ["retour_plan", "modification"]                     # rien n'est effacé
        with pytest.raises(PolicyError) as e:
            policy.reset_to_plan(s, CFG, "déjà fait", True, None, "David", T0)
        assert e.value.code == "already_plan"


def test_policy_tables_are_append_only(sources):
    with session_scope(sources) as s:
        policy.change_thresholds(s, CFG, [{"key": "origins_for_25", "to": 3}], "essai de prudence", True, None, "David", T0)
    for sql in ("update index_policy_versions set reason='x'", "delete from index_policy_versions", "update threshold_changes set reason='x'",
                "delete from threshold_changes"):
        with pytest.raises(DBAPIError, match="ajout seul"):
            with session_scope(sources) as s:
                s.execute(text(sql))


# ---------------------------------------------------------------------------------------------------------------------
# Couverture : inconnu ≠ zéro
def test_aucun_flux_indice_inconnu_jamais_zero(sources):
    snaps = evaluate(sources, now())
    for t, snap in snaps.items():
        assert snap.status == "non_calculable" and snap.palier is None and snap.rule_id == "R-NC", t
        assert snap.last_known_palier is None
        assert not snap.details["coverage"]["profile_satisfied"]
        assert {f["state"] for f in snap.details["coverage"]["families"]} == {"indisponible"}


def test_reference_insuffisante_au_demarrage_donne_non_calculable(sources):
    coverage_ok(sources, now(), baseline_weeks=2)
    snap = evaluate(sources, now())["FR"]
    assert snap.status == "non_calculable"
    assert "référence insuffisante" in snap.details["coverage"]["baseline"]["detail"]


def test_une_famille_hors_service_empeche_zero(sources):
    coverage_ok(sources, now())
    with session_scope(sources) as s:
        from app.models import ConnectorHealth
        s.get(ConnectorHealth, "ioda-fr").last_success_at = T0 - timedelta(days=2)    # la mesure technique est périmée
    snap = evaluate(sources, now())["FR"]
    assert snap.status == "non_calculable"
    assert next(f for f in snap.details["coverage"]["families"] if f["id"] == "mesure_technique")["state"] == "indisponible"


def test_couverture_satisfaite_et_rien_a_signaler_donne_zero(sources):
    coverage_ok(sources, now())
    snap = evaluate(sources, now())["FR"]
    assert (snap.status, snap.palier, snap.rule_id) == ("calculable", 0, "R-P0")
    assert snap.last_known_palier == 0 and snap.details["criteria"][0]["state"] == "non_evalue"


# ---------------------------------------------------------------------------------------------------------------------
# Paliers 10 / 25 / 40 / 55
def test_cent_repetitions_de_rhetorique_plafonnees_au_palier_10(sources):
    coverage_ok(sources, now())
    for i in range(100):
        add_source(sources, f"m{i:03d}")
        put(sources, f"m{i:03d}", "r", f"Escalade verbale {i}", "Un responsable menace de frapper la France si les sanctions ne sont pas levées.",
            published="Wed, 28 Oct 2026 11:00:00 GMT", at=T0 + timedelta(seconds=i))
    process(sources)
    assert [e.event_type for e in events(sources)] == ["rhetoric"]
    snap = evaluate(sources, now())["FR"]
    assert pal(snap) == 10 and snap.details["criteria"][2]["state"] == "non_rempli"


def test_signal_isole_presse_une_origine_sans_confirmation_reste_a_10(sources):
    coverage_ok(sources, now())
    add_source(sources, "media-a")
    put(sources, "media-a", "1", "Mayotte : aéroport fermé", "L'aéroport de Mayotte est fermé.", published="Wed, 28 Oct 2026 11:00:00 GMT")
    process(sources)
    assert pal(evaluate(sources, now())["FR"]) == 10


def test_mesure_technique_ou_mesure_officielle_documentee_donne_25(sources):
    coverage_ok(sources, now())
    ioda_outage(sources)
    process(sources)
    snap = evaluate(sources, now())["FR"]
    assert pal(snap) == 25 and snap.details["criteria"][2]["state"] == "rempli"
    assert "ne prouve ni cyberattaque" in snap.details["events"][0]["why"]


def test_plusieurs_origines_independantes_font_passer_une_fermeture_a_25(sources):
    coverage_ok(sources, now())
    for i, sid in enumerate(("m-a", "m-b")):
        add_source(sources, sid)
    put(sources, "m-a", "1", "Mayotte : aéroport fermé", "L'aéroport de Mayotte est fermé jusqu'à nouvel ordre, selon la préfecture locale.", published="Wed, 28 Oct 2026 11:00:00 GMT")
    put(sources, "m-b", "1", "Fermeture à Mayotte", "Les vols vers Mayotte sont suspendus : l'aéroport de Mayotte est fermé, indiquent des témoins sur place.",
        published="Wed, 28 Oct 2026 11:10:00 GMT", at=T0 + timedelta(minutes=3))
    process(sources)
    ev = events(sources, event_type="closure_restriction")
    assert len(ev) == 1 and ev[0].origin_count == 2
    assert pal(evaluate(sources, now())["FR"]) == 25


def test_convergence_40_deux_evenements_deux_familles_deux_origines(sources):
    coverage_ok(sources, now())
    ioda_outage(sources)                       # famille « mesure technique »
    official_closure(sources, at=T0 + timedelta(hours=2))   # famille « autorités »
    process(sources, T0 + timedelta(hours=3))
    snap = evaluate(sources, T0 + timedelta(hours=3, minutes=10))["FR"]
    assert pal(snap) == 40 and "2 familles" in snap.details["criteria"][3]["note"]


def test_convergence_refusee_si_une_meme_tempete_explique_tout(sources):
    coverage_ok(sources, now())
    add_source(sources, "media-w")
    put(sources, "media-w", "w", "Tempête sur la France", "Une violente tempête touche la France.", published="Wed, 28 Oct 2026 11:00:00 GMT", at=T0 - timedelta(hours=1))
    ioda_outage(sources, at=T0)
    official_closure(sources, at=T0 + timedelta(hours=1))
    process(sources, T0 + timedelta(hours=2))
    snap = evaluate(sources, T0 + timedelta(hours=2, minutes=10))["FR"]
    assert pal(snap) == 25
    assert "cause commune" in snap.details["criteria"][3]["note"]


def test_convergence_refusee_si_une_seule_famille(sources):
    coverage_ok(sources, now())
    ioda_outage(sources, at=T0, ext_suffix="bgp")
    ioda_outage(sources, at=T0 + timedelta(hours=1), ext_suffix="ping")
    process(sources)
    snap = evaluate(sources, now(2))["FR"]
    assert pal(snap) == 25          # même famille d'origine (IODA) : pas deux familles, pas deux origines indépendantes


def test_55_posture_relevee_et_precaution_mais_pas_si_un_exercice_est_annonce(sources):
    coverage_ok(sources, now())
    vigipirate(sources, "Vigilance", T0)
    process(sources, T0 + timedelta(minutes=1))
    vigipirate(sources, "Urgence attentat", T0 + timedelta(hours=1))
    official_closure(sources, at=T0 + timedelta(hours=1, minutes=5))
    process(sources, T0 + timedelta(hours=1, minutes=10))
    snap = evaluate(sources, T0 + timedelta(hours=1, minutes=20))["FR"]
    assert pal(snap) == 55
    # un exercice annoncé dans la même fenêtre : l'alternative doit être écartée par un humain
    add_source(sources, "gouv-def", kind="autorite", org="Ministère fictif de la Défense")
    put(sources, "gouv-def", "ex", "Exercice annoncé", "L'armée annonce un exercice de sécurité en France cette semaine.", published="Wed, 28 Oct 2026 13:00:00 GMT", at=T0 + timedelta(hours=1, minutes=30))
    process(sources, T0 + timedelta(hours=1, minutes=40))
    snap = evaluate(sources, T0 + timedelta(hours=1, minutes=50))["FR"]
    assert snap.raw_palier < 55 and snap.details["criteria"][4]["state"] == "non_evalue"      # critères : plus 55 ; palier publié : baisse en attente (hystérésis)


# ---------------------------------------------------------------------------------------------------------------------
# 70 / 85 / 100 : seulement après revue humaine ; périmètre
def hostile(sources, where="Mayotte", at=T0, sid="media-h"):
    add_source(sources, sid)
    put(sources, sid, f"h-{where}", f"Attaque à {where}", f"Une attaque de drones a visé un entrepôt à {where}, selon des témoins.",
        published="Wed, 28 Oct 2026 11:00:00 GMT", at=at)
    process(sources, at + timedelta(minutes=5))
    return events(sources, event_type="hostile_act_alleged")[-1]


def test_attaque_alleguee_en_prose_reste_en_attente_de_revue_et_ne_depasse_pas_10(sources):
    coverage_ok(sources, now())
    ev = hostile(sources)
    snap = evaluate(sources, now())["FR"]
    assert pal(snap) == 10 and snap.details["coverage"]["pending_major_review"] == 1
    assert snap.details["criteria"][6]["state"] == "non_evalue"


def test_attaque_isolee_etablie_85_pas_100_puis_conflit_durable_100(sources):
    coverage_ok(sources, now())
    ev = hostile(sources)
    annotate_event(sources, ev.id, "armed_attack", FULL)
    snap = evaluate(sources, now())["FR"]
    assert pal(snap) == 85
    annotate_event(sources, ev.id, "sustained_conflict", {**FULL, "campaign_established": True}, at=T0 + timedelta(hours=1))
    assert pal(evaluate(sources, now(1))["FR"]) == 100


def test_annotation_incomplete_est_refusee(sources):
    ev = hostile(sources)
    with pytest.raises(PolicyError) as e:
        annotate_event(sources, ev.id, "armed_attack", {"facts_established": True})
    assert e.value.code == "annotation_incomplete"
    with pytest.raises(PolicyError) as e:
        annotate_event(sources, ev.id, "armed_attack", {**FULL, "state_actor": False})
    assert e.value.code == "annotation_incomplete"
    with pytest.raises(PolicyError) as e:
        annotate_event(sources, ev.id, "sustained_conflict", FULL)             # durable : exige campaign_established
    assert e.value.code == "annotation_incomplete"
    with pytest.raises(PolicyError) as e:
        annotate_event(sources, ev.id, "armed_attack", FULL, note="x")
    assert e.value.code == "note_required"


def test_attaque_hors_de_france_ne_declenche_pas_85_pour_la_jauge_france(sources):
    coverage_ok(sources, now())
    ev = hostile(sources, where="Ukraine", sid="media-u")
    annotate_event(sources, ev.id, "armed_attack", FULL)
    snaps = evaluate(sources, now())
    assert pal(snaps["FR"]) == 0 and pal(snaps["flanc-est"]) == 85          # zone secondaire : concernée ; France : non


def test_85_ne_baisse_pas_parce_que_le_temps_passe_mais_sur_correction_documentee(sources):
    coverage_ok(sources, now())
    ev = hostile(sources)
    annotate_event(sources, ev.id, "armed_attack", FULL)
    assert pal(evaluate(sources, now())["FR"]) == 85
    later = T0 + timedelta(days=40)
    coverage_ok(sources, later)
    assert pal(evaluate(sources, later)["FR"]) == 85                          # 40 jours sans nouvelle publication : inchangé
    annotate_event(sources, ev.id, "retracted", {}, note="rectification officielle : aucune attaque", at=later + timedelta(minutes=1))
    snap = evaluate(sources, later + timedelta(minutes=5))["FR"]
    assert pal(snap) == 0                                                      # correction factuelle : immédiat (pas d'hystérésis)


def test_fait_grave_avec_couverture_partielle_reste_publie_avec_badge(sources):
    ev = hostile(sources)                        # aucune couverture
    annotate_event(sources, ev.id, "armed_attack", FULL)
    snap = evaluate(sources, now())["FR"]
    assert (snap.status, snap.palier, snap.partial_coverage) == ("calculable", 85, True)
    assert "couverture-partielle" in snap.rule_id


def test_le_zero_n_est_jamais_affiche_par_une_couverture_partielle_sans_fait_grave(sources):
    ioda_outage(sources); process(sources)
    snap = evaluate(sources, now())["FR"]
    assert snap.status == "non_calculable" and snap.palier is None      # le palier observé par les critères (25) n'est pas publié
    assert snap.raw_palier == 25 and snap.rule_id == "R-NC"


# ---------------------------------------------------------------------------------------------------------------------
# Hystérésis, tendance, version des seuils
def test_hausse_immediate_baisse_apres_deux_reevaluations_stables(sources):
    coverage_ok(sources, now())
    ioda_outage(sources)
    process(sources)
    assert pal(evaluate(sources, now())["FR"]) == 25
    # le signal expire (168 h) : critères = 0, mais la baisse doit être confirmée
    later = T0 + timedelta(days=9)
    coverage_ok(sources, later)
    s1 = evaluate(sources, later)["FR"]
    assert (s1.palier, s1.raw_palier) == (25, 0) and "baisse-en-attente" in s1.rule_id
    assert s1.details["pending_downgrade"] == {"target": 0, "count": 1, "needed": 2}
    s2 = evaluate(sources, later + timedelta(minutes=5))["FR"]
    assert (s2.palier, s2.raw_palier) == (0, 0)


def test_tendance_non_comparable_apres_changement_de_seuils_et_stable_sinon(sources):
    coverage_ok(sources, now(-30))
    a = evaluate(sources, T0 - timedelta(hours=30))["FR"]
    coverage_ok(sources, T0)
    b = evaluate(sources, T0)["FR"]
    with session_scope(sources) as s:
        from app.gauge.snapshots import gauge_state
        g = gauge_state(s, CFG, s.get(IndexSnapshot, b.id))
    assert g["trend_24h"]["direction"] == "stable" and g["trend_7d"]["direction"] == "non_comparable"      # 7 j : pas assez d'historique
    with session_scope(sources) as s:
        policy.change_thresholds(s, CFG, [{"key": "events_for_40", "to": 3}], "essai de sensibilité", True, None, "David", T0 + timedelta(minutes=1))
    coverage_ok(sources, T0 + timedelta(hours=25))
    c = evaluate(sources, T0 + timedelta(hours=25))["FR"]
    with session_scope(sources) as s:
        g = gauge_state(s, CFG, s.get(IndexSnapshot, c.id))
        assert g["trend_24h"]["direction"] == "non_comparable" and "seuils modifiés" in g["trend_24h"]["reason"]
        assert g["policy"]["version"] == "seuils-v2"


def test_chaque_calcul_enregistre_la_version_des_seuils_utilisee(sources):
    coverage_ok(sources, now())
    a = evaluate(sources, now())["FR"]
    with session_scope(sources) as s:
        policy.change_thresholds(s, CFG, [{"key": "downgrade_evals", "to": 1}], "réagir plus vite", True, None, "David", now(0, 20))
    b = evaluate(sources, now(0, 30))["FR"]
    with session_scope(sources) as s:
        labels = {x.id: s.get(IndexPolicyVersion, x.policy_version_id).label for x in (a, b)}
    assert labels == {a.id: "seuils-v1", b.id: "seuils-v2"}


def test_seuil_modifie_change_reellement_le_resultat_et_le_plan_reste_restaurable(sources):
    coverage_ok(sources, now())
    ioda_outage(sources, ext_suffix="bgp", at=T0)
    official_closure(sources, at=T0 + timedelta(hours=1))
    process(sources, T0 + timedelta(hours=2))
    assert pal(evaluate(sources, T0 + timedelta(hours=2, minutes=5))["FR"]) == 40
    with session_scope(sources) as s:
        policy.change_thresholds(s, CFG, [{"key": "events_for_40", "to": 3}], "exiger trois événements", True, None, "David", T0 + timedelta(hours=2, minutes=6))
    snap = evaluate(sources, T0 + timedelta(hours=2, minutes=7))["FR"]
    assert snap.raw_palier == 25 and snap.palier == 40                           # 2 événements < 3 requis ; la baisse attend d'être confirmée
    with session_scope(sources) as s:
        policy.reset_to_plan(s, CFG, "retour aux valeurs du plan", True, None, "David", T0 + timedelta(hours=2, minutes=9))
    assert evaluate(sources, T0 + timedelta(hours=2, minutes=10))["FR"].raw_palier == 40


# ---------------------------------------------------------------------------------------------------------------------
def test_les_trois_dossiers_ne_sont_pas_additionnes_a_la_jauge(sources):
    coverage_ok(sources, now())
    ioda_outage(sources)
    process(sources)
    snap = evaluate(sources, now())["FR"]
    d = {x["id"]: x for x in snap.details["dossiers"]}
    assert set(d) == {"D-CIV", "D-REG", "D-EXT"}
    assert d["D-CIV"]["state"] == "actif" and d["D-REG"]["state"] == "veille" and d["D-EXT"]["state"] == "veille"
    assert d["D-CIV"]["rule_interpretation"]["hypotheses"] == []        # moteur d'hypothèses : pas encore fait, dit explicitement


def test_dossiers_indetermines_sans_couverture(sources):
    snap = evaluate(sources, now())["FR"]
    assert {x["state"] for x in snap.details["dossiers"]} == {"indetermine"}
