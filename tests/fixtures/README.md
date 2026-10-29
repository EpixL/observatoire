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
