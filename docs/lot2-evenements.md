# Lot 2 — événements : ce que fait le code, et ce qu'il ne fait pas

## Chaîne de traitement

`document_versions` (lot 1) → **origine** (déduplication) → **extraction déterministe** → **affirmations** (`claims`)
→ **événements** (`events`) → liens proposés / file de revue. Commande : `python -m app.cli process`
(le worker l'exécute automatiquement après chaque tour de collecte). Retraiter est sans effet (idempotent).

## Principes

1. **Pas d'IA, pas de score.** Aucune inférence : le type `inference` est refusé par le schéma. Aucun palier de jauge n'est calculé (lot 3).
2. **Observation ≠ déclaration.** Seule une mesure structurée (IODA) est une *observation*. Tout le reste est une *déclaration*
   de son auteur (un ministère, un article, une personne citée). Un texte libre n'est jamais mieux qu'une déclaration provisoire.
3. **Une affirmation = un fait, une déclaration ou une attribution.** « Un aéroport est fermé », « le ministère évoque un sabotage »
   et « il l'attribue à l'État X » sont trois affirmations distinctes ; chacune a son statut de confirmation.
4. **Les qualifications hostiles issues de prose sont toujours « à vérifier »** (`needs_review`), jamais promues automatiquement.
5. **Provenance exacte.** Chaque affirmation pointe une citation et sa position dans le texte conservé d'une version précise
   (`evidence_links`). `python -m app.cli verify-provenance` contrôle que chaque citation est bien là (code retour ≠ 0 sinon).
6. **On compte des origines, pas des articles.** Deux documents sont de même origine s'ils partagent l'URL canonique, l'empreinte,
   un fort recouvrement de texte (≥ 0,8), ou la même agence citée avec un recouvrement ≥ 0,4 sous 48 h. Les documents d'une même
   *famille d'origine* du registre (ex. deux flux CERT-FR) sont aussi comptés une fois. En cas de doute entre deux erreurs, on
   préfère **sous-compter** l'indépendance plutôt que la surestimer. Un recouvrement de 0,5 à 0,8 sans agence commune ouvre une revue (`possible_same_origin`), sans fusion.
7. **La nouveauté est une propriété du contenu.** Un article dont la date est ancienne (> 7 jours avant notre première observation)
   crée un événement `historical` (motif `republication`) qui n'alimente jamais un événement en cours.
8. **Un démenti rejoint le dossier** de l'événement qu'il contredit (rôle `contradiction`), sans réécrire l'affirmation initiale.
9. **Les « causes communes » sont PROPOSÉES** (`event_links`, statut `proposed`) : même zone, fenêtre 24 h, avec une explication ordinaire
   candidate (météo, panne électrique/réseau). Elles ne prouvent rien ; elles préviennent le lot 3 de ne pas compter ces événements comme indépendants.
10. **Un premier relevé est une base, pas un changement** : au premier passage, un niveau de conseil ou une liste CZIB produit des
    états de référence (`*_state`), jamais d'événement. Seule la comparaison à la version précédente crée un changement.
    Une prolongation de validité seule (EASA) est une catégorie à part (`czib_validity_extended`).
11. **Dates** : tout en UTC ; une date future, sans fuseau, illisible ou absente est *marquée* (`date_flags`), jamais corrigée en silence.
    Une date future n'est jamais utilisée comme temps de référence.

## Tables ajoutées (migration 0002)

`claims`, `evidence_links`, `events`, `event_claims`, `event_links`, `origin_groups`, `document_origins`, `reviews`
(file de revue humaine : `claim_qualification`, `unqualified_document`, `prompt_injection_suspected`, `possible_same_origin`,
`attribution_without_event`), `version_processing`.

## Extracteurs

| Famille | Mode | Produit |
|---|---|---|
| France Diplomatie (page) | niveaux de conseil à vocabulaire fixe | `travel_advice_state` / `travel_advice_change` (hausse, baisse, ajout, départ recommandé) |
| EASA CZIB | blocs « CZIB AAAA-NN[Rn] … Valid until … » | `airspace_advisory_state`, `airspace_advisory` (créé / révisé), `czib_validity_extended`, `czib_removed_from_list` (à vérifier : absence ≠ retrait) |
| Vigipirate | « Posture en cours : … » | `security_posture_state` / `security_posture_change` |
| CERT-FR | identifiants `CERTFR-…` | `cyber_advisory` (jamais un indicateur géopolitique ; le nombre de CVE est purement informatif) |
| IODA | JSON structuré | `internet_outage` (observation d'un capteur ; ne prouve pas une cyberattaque) |
| Médias / flux d'actualité | **prose conservatrice** (FR/EN) | `closure_restriction`, `outage_reported`, `weather_event`, `attack_alleged`, `sabotage_alleged`, `threat_statement`, `military_exercise`, `attribution_statement`, `nuclear_radiological_mention` |

## Limites connues (honnêtes)

- **La prose est volontairement pauvre.** Lexique FR/EN fixe, négation et condition repérées par motifs. Des formulations hors motifs
  passent dans « documents à qualifier » ou sont mal classées. C'est le comportement voulu : s'abstenir plutôt que sur-interpréter. Les faux négatifs seront mesurés en lot 6.
- **Structures de pages inconnues.** Les extracteurs de pages (France Diplomatie, EASA, Vigipirate) sont écrits d'après la *forme attendue* ;
  ils n'ont jamais vu les vraies pages. Premier travail sur le Pi : relancer le smoke avec `--save-fixtures`, comparer, ajuster.
- **Passage de documents à événements en mémoire** : la recherche de quasi-doublons compare chaque nouveau document aux documents des 7 derniers jours (en Python).
  Largement suffisant pour quelques centaines de documents par jour ; à indexer si le volume augmente.
- **Gazetier** : ~80 territoires, correspondance de mots entiers. Un lieu inconnu reste « non localisé » (aucune coordonnée inventée). Pas de désambiguïsation (« Georgia » est volontairement absent).
- **Pas de géolocalisation fine ni de coordonnées** à ce stade (la carte du dashboard viendra du lot 3/4).

## Corpus de cas piégeux (plan §13) → tests

Fichier : `tests/test_events_corpus.py` (textes fictifs) et `tests/test_events_structured.py`.

| Cas du plan | Test |
|---|---|
| Même dépêche dans dix médias : une origine | `test_meme_depeche_dans_dix_medias_une_seule_origine` |
| Article ancien republié : pas d'incident nouveau | `test_article_ancien_republie_*` (2 tests) |
| « aucune attaque confirmée » : pas de confirmation positive | `test_aucune_attaque_confirmee_*` |
| Exercice annoncé : contexte, pas offensive | `test_exercice_annonce_*`, `test_titre_exercice_*` |
| Coupure commune météo/électricité/Internet | `test_coupure_commune_*`, `test_deux_fermetures_sans_cause_ordinaire_*` |
| Instruction hostile au modèle : ignorée | `test_communique_avec_instruction_hostile_au_modele_est_une_donnee` |
| Confirmation limitée : seule l'affirmation correspondante change | `test_confirmation_limitee_*`, `test_trois_affirmations_distinctes_*` |
| Démenti et correction : historique préservé | `test_dementi_rejoint_le_dossier_*` |
| Attaque hors de France | `test_attaque_hors_de_france_*`, `test_outre_mer_*` |
| Quota API épuisé : état technique | `test_rate_limited_*`, `test_ioda_quota_exhausted_*` (lot 1) |
| Aucun flux / pas d'historique fictif | `test_aucun_historique_fictif_sans_collecte`, `test_ioda_unexpected_schema_*` |

Les cas qui dépendent de la jauge (paliers 85/100, « cent répétitions de rhétorique », « aucun flux : indice inconnu »),
des notifications ou de l'IA relèvent des lots 3, 5 et 7.
