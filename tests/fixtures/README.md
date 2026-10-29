# Fixtures de test — provenance

**Toutes les fixtures de ce dossier sont FICTIVES.** Elles ont été écrites à la main à partir de la
*forme* connue des formats (RSS 2.0, pages HTML institutionnelles, JSON d'API), parce que le réseau de
l'environnement cloud bloque les domaines des sources réelles (voir `docs/source-register.md`).

- Aucune n'est une réponse enregistrée d'un vrai serveur.
- Les identifiants (CERTFR-2026-…, CZIB 2026-…), dates, pays, niveaux et contenus sont inventés pour les tests.
  Ils ne décrivent aucune situation réelle.
- Elles servent à tester le **code** (parsing, versionnage, déduplication), pas à valider les **endpoints**.
  La validation des vrais flux se fait sur le Pi : `scripts/smoke-collectors.sh`.
- Le schéma JSON « IODA » est une reconstruction de mémoire, à confirmer.
- Aucun secret, aucune donnée personnelle.

Quand David aura lancé le script de smoke sur le Pi, on pourra remplacer/compléter ces fichiers par de vraies
réponses enregistrées (sous-dossier `real/`, avec date et URL de capture).


## Fixtures issues du smoke RÉEL sur le Pi (29/10/2026)

Retour de la session homelab (smoke lancé par David). Seuls les éléments suivants sont **réels** ; tout le reste de ces fichiers est du gabarit fictif.

| Fichier | Réel | Fictif / reconstitué |
|---|---|---|
| `pages/gcore_challenge_real.html` | texte de la page anti-robot Gcore (titre « Gcore », « Browser Validation Page », « Please enable JavaScript / cookies ») | enveloppe HTML minimale |
| `pages/easa_real_rows.html` | classes CSS et contenu de **la ligne « Airspace of Mali / CZIB-2017-01R21 »** (dates 31/03/2017, 30/09/2026, 30/04/2027, statut Active, lien) | disposition exacte des cellules (reconstituée) ; 2e ligne « Testistan » entièrement fictive |
| `json/ioda_real_empty_fr.json` | réponse IODA France sans événement : enveloppe, `format: codf`, `data: []`, mention de copyright | champ `metadata` abrégé |
| `feeds/cert_fr_maj_mixed_order.xml` | titres et `pubDate` de 3 entrées observées : 1er item de 2015, « [MàJ] … FortiOS (09 février 2024) » daté 2024 | liens, identifiants, résumés, 3e entrée (fictive) |

Les autres fixtures (`ioda_events_fr.json`, pages Vigipirate/conseils, flux France 24) restent **fictives**.
