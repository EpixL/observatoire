# Lot 3 — jauge, couverture, seuils versionnés (partie réalisée)

**Statut honnête :** la jauge par paliers, la couverture, les trois dossiers, les seuils versionnés et l'API correspondante sont faits et testés.
**Le moteur d'hypothèses (H0–H4), la conclusion à gabarits, la détection d'anomalie MAD sur séries numériques et la « voie officielle » ne sont PAS faits** :
le critère de sortie du lot 3 (« conclusion produite sans LLM ») n'est donc **pas atteint**. Les clés `anomaly_mad_k` / `anomaly_windows` existent comme
seuils (le dashboard les affiche) mais rien ne les utilise encore : aucune série numérique n'est collectée (IODA fournit déjà ses propres détections).

## Ce que calcule la jauge

*Indice de confrontation armée — territoire sélectionné.* Échelle ordinale à 8 paliers (0, 10, 25, 40, 55, 70, 85, 100), **jamais** une probabilité ni un pourcentage.
Territoires : `FR` (métropole + outre-mer) et `flanc-est` (UA, RU, BY, PL, LT, LV, EE, MD) — `config/territories.yaml`. Un événement ne compte que pour le territoire
dont la zone le contient : **une attaque en Ukraine est une attaque pour `flanc-est`, jamais pour `FR`.**

Le palier publié est **le plus élevé dont toutes les conditions sont remplies** ; il n'y a aucune somme de points.

| Palier | Condition appliquée par le code (seuils réglables en *italique*) |
|---|---|
| 0 | couverture satisfaite, aucun critère actif, aucun événement hostile en attente de revue |
| 10 | au moins une observation pertinente active (signal faible, rhétorique — **plafond de la rhétorique**, ou événement hostile *en attente de revue*) |
| 25 | au moins un événement **matériel** : preuve directe (décision d'une autorité sur sa propre mesure, mesure technique IODA) ou ≥ *origins_for_25* origines indépendantes |
| 40 | ≥ *events_for_40* événements matériels distincts, même zone, dans *convergence_window_h*, ≥ *families_for_40* familles d'indicateurs, ≥ 2 origines indépendantes, **et** pas tous reliés par une cause commune ordinaire (météo, panne), transitivité comprise |
| 55 | changement de posture relevé (Vigipirate) **et** mesure de précaution liée dans la même fenêtre ; un exercice annoncé dans la fenêtre bloque le palier tant qu'un humain n'a pas écarté l'alternative (`exercise_excluded`) |
| 70 / 85 / 100 | **uniquement par revue humaine** (`POST /events/{id}/review`) : `grave_hostile_act` / `armed_attack` (acteur étatique) / `sustained_conflict` (+ campagne établie). Faits, zone, période et acteur doivent être documentés séparément, sinon la revue est refusée |

Ce qui n'alimente **jamais** le palier : alertes CERT-FR (le nombre de CVE n'est pas un indicateur), météo, prolongation de validité d'un bulletin EASA, exercices (contexte),
articles « republiés » (historiques), un événement dont la source est unique et sans confirmation officielle (reste à 10).

## Couverture (`config/coverage-profiles.yaml`)

Trois familles obligatoires — *autorités et mesures* (EASA, page France Diplomatie), *faits régionaux corroborables* (France 24), *mesure technique* (IODA) — chacune « à jour »
si ses sources essentielles ont réussi dans les *coverage_freshness_h* dernières heures ; plus une **référence quantitative** de *baseline_weeks* semaines de collecte réelle d'IODA.
Au démarrage elle est insuffisante : **la jauge est « non calculable » pendant 8 semaines** (jamais 0), sauf fait grave établi par un humain (≥ 70), publié avec le badge `partial_coverage`.
C'est voulu (plan §5) ; pour la raccourcir, c'est le seuil `baseline_weeks` (min 4), enregistré et daté comme tout changement.

## Baisse, hausse, tendance

- Hausse : immédiate. Baisse : doit rester stable *downgrade_evals* réévaluations (état `pending_downgrade` visible), **sauf correction factuelle** (annotation `retracted`, `not_hostile`, `resolved`, `confirmed_civil_incident`) qui s'applique tout de suite.
- Les paliers annotés (70/85/100) **n'expirent jamais** avec le temps ; les signaux faibles expirent après *weak_signal_expiry_h* sans que cela prouve le retour à la normale.
- Tendance 24 h / 7 j : `hausse | stable | baisse`, ou `non_comparable` avec la raison (historique insuffisant, seuils modifiés, couverture différente).

## Seuils versionnés

- `config/index-scale.yaml` = valeurs du plan = **seuils-v1**. Les clés sont celles du dashboard.
- Table `index_policy_versions` (insert-only, triggers) : une version contient **tous** les seuils ; chaque changement crée la suivante (`seuils-v2`…), avec date, acteur, motif.
  `threshold_changes` : une ligne par seuil modifié (ancienne/nouvelle valeur). `retour_plan` = revenir aux valeurs du plan, **comptabilisé comme un changement de plus**.
- Chaque instantané de jauge (`index_snapshots`, insert-only) enregistre `policy_version_id`, les critères évalués, la couverture, les événements considérés et les dossiers : on peut **reconstruire** pourquoi tel palier à telle date.
- Garde-fous serveur : `confirmed: true`, motif ≥ 8 caractères, valeur dans [min, max] et sur le pas, version attendue à jour (409 sinon).
- Les 8 paliers et les définitions de 0 et 100 **ne sont pas** des seuils modifiables.

## Écritures et sécurité

Toute écriture (`PUT/POST`) exige `Authorization: Bearer <ADMIN_TOKEN>` ; **sans `ADMIN_TOKEN` configuré, elles sont désactivées (503)**. L'acteur journalisé est `ADMIN_ACTOR`.
Ce n'est pas un système de comptes : un jeton unique pour un utilisateur, à ne mettre que dans `.env`. Les lectures restent ouvertes sur le LAN.

## Dossiers

`D-CIV` (72 h), `D-REG` (7 j), `D-EXT` (30 j) par territoire : état `indetermine` (couverture insuffisante), `veille` ou `actif`, événements retenus, origines indépendantes, ce qui manque.
Jamais additionnés entre eux ni à la jauge.

## Limites connues

- Les paliers 55, 70, 85, 100 dépendent de sources ou de décisions humaines qui n'existent pas encore (Vigipirate désactivée ; aucune revue faite) : sur le terrain, la jauge ne dépassera guère 40 avant la mise en place de ces entrées.
- La classification « événement matériel » est un jeu de règles que je propose (`engine._classify`) ; elle n'a jamais vu de vraies données de production.
- Ni `civil_alert` ni le badge `nuclear` ne sont produits : les mentions nucléaires/radiologiques sont stockées (`nuclear_mentions` dans l'instantané, en attente de revue) mais pas exposées comme badge.
- Pas de flux SSE, pas de journal, pas de réglages IA/notifications : lot 4 / suivants.
