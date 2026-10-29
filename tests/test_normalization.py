from datetime import datetime, timezone

from app.normalization.dates import parse_publication_date
from app.normalization.text import classify_change, html_to_text, substantive_hash
from app.normalization.urls import canonicalize_url, host_allowed

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def test_date_rfc822_with_offset_converted_to_utc():
    d = parse_publication_date("Wed, 28 Oct 2026 10:00:00 +0100", reference=NOW)
    assert d.value == datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc) and d.flags == []


def test_date_without_timezone_is_flagged_not_silently_fixed():
    d = parse_publication_date("2026-10-28T10:00:00", reference=NOW)
    assert "no_timezone" in d.flags and d.raw == "2026-10-28T10:00:00"
    assert d.value == datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)  # Europe/Paris supposé, signalé


def test_future_date_is_flagged_and_kept():
    d = parse_publication_date("2027-01-01T00:00:00Z", reference=NOW)
    assert "future" in d.flags and d.value is not None


def test_unparseable_and_missing():
    assert parse_publication_date("hier soir", reference=NOW).flags == ["unparseable"]
    assert parse_publication_date(None, reference=NOW).flags == ["missing"]


def test_old_publication_flag():
    assert "old_publication" in parse_publication_date("Mon, 01 Jan 2024 10:00:00 GMT", reference=NOW).flags


def test_canonical_url_strips_tracking_fragment_and_trailing_slash():
    assert canonicalize_url("HTTPS://WWW.Exemple.fr:443/a/b/?utm_source=x&b=2&a=1#frag") == "https://www.exemple.fr/a/b?a=1&b=2"


def test_host_allowed_exact_or_subdomain_only():
    assert host_allowed("https://www.diplomatie.gouv.fr/x", ["diplomatie.gouv.fr"])
    assert not host_allowed("https://diplomatie.gouv.fr.evil.example/x", ["diplomatie.gouv.fr"])
    assert not host_allowed("https://evildiplomatie.gouv.fr/x", ["diplomatie.gouv.fr"])


def test_date_only_update_is_cosmetic():
    assert classify_change("Vigilance renforcée. Mis à jour le 12 mars 2026", "Vigilance renforcée. Mis à jour le 14 mars 2026") == "cosmetic"
    assert substantive_hash("A. Mis à jour le 1/2/2026") == substantive_hash("A. Mis à jour le 5/2/2026")


def test_typo_fix_is_cosmetic_but_word_removed_is_material():
    assert classify_change("La frontière est fermée", "La frontiere est fermée") == "cosmetic"
    assert classify_change("Formellement déconseillé", "Déconseillé") == "material"


def test_validity_date_change_is_material():
    assert classify_change("Fermé jusqu'au 15 mars", "Fermé jusqu'au 30 mars") == "material"


def test_html_to_text_drops_menu_cookie_footer():
    html = "<body><nav>Menu</nav><div class='cookie-banner'>cookies</div><main><p>Contenu utile</p></main><footer>pied</footer></body>"
    assert html_to_text(html, selector="main") == "Contenu utile"
    assert html_to_text(html) == "Contenu utile"
