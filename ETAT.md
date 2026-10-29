# ÉTAT — session B (dashboard, lot 4) · branche `dashboard`

Dernière mise à jour : 29 octobre 2026 (deuxième passe, après les réponses de David). Je me suis arrêtée là, en attente de ta validation. Rien n'est fusionné dans `main`.

> **Provenance des consignes de cette passe** : les réponses de David à mes 6 questions m'ont été relayées par la session A (message inter-sessions), pas directement par David. Elles restent dans mon périmètre (ma branche, mes fichiers) et je les ai appliquées ; si un point a été mal relayé, dis-le-moi.

## En une phrase

Le dashboard **VEILLE** (maquette, données fictives) est complet : cadran, conclusion sans IA, carte hors ligne, fiches de preuves, dossiers, sources, journal, états particuliers, et maintenant un **écran Réglages** (état des sources, notifications, seuils de la jauge avec garde-fous). Aucune requête externe (vérifié par test).

## Les 6 réponses de David, appliquées

| # | Décision | Ce qui a été fait |
|---|---|---|
| 1 | Mobile : ordre strict du plan | Inchangé et testé : jauge → conclusion → carte → fiche → liste. |
| 2 | Pays réels + bandeau « DONNÉES FICTIVES » permanent ; zones : France + flanc est | Événements fictifs sur Pologne, Lituanie, Lettonie, Biélorussie, Moldavie, Russie (région « ouest », pas le centre du pays), Ukraine, plus la Nouvelle-Calédonie (outre-mer) ; aucun autre pays. Bandeau ambre en majuscules, collé en haut sur ordinateur, présent sur toutes les pages (Réglages compris), **plus** une pastille « Données fictives » sur la carte (pour qu'une capture recadrée reste honnête) et « Donnée fictive » sur chaque fiche. |
| 3 | Toujours bleu nuit par défaut | Le réglage du système est ignoré ; seul un choix manuel « clair » (Réglages › Général) est mémorisé. Testé avec un système en mode clair. |
| 4 | Trois vues fixes | Inchangé. Conséquence : la **vue Europe est maintenant la vue par défaut** (la vue France n'affichait plus aucun événement puisque la zone secondaire est à l'est). |
| 5a | Réglages › État des sources, lecture seule | Tableau (téléphone : cartes) : nom, famille, dernier passage, verdict **OK / BLOCKED / FAIL / SKIPPED** (symbole + mot), motif. Aucun bouton ni champ. |
| 5b | Notifications | Interrupteur + niveau ; choix de David « décisions officielles + A3 » présélectionné ; rappel des niveaux A0–A3 ; canal Telegram « non activé — interface seule (lot 7) ». |
| 5c | Seuils de la jauge + garde-fous | Voir ci-dessous. |
| 6 | Écarts avec le backend | Tableau de 15 lignes dans [`docs/api-contract.md`](docs/api-contract.md), établi sur `origin/backend` au commit `0dcfbce` (la proposition de A n'existait pas encore) ; endpoints ajoutés au contrat, à `types.ts` et à `client.ts`. |

### Seuils de la jauge : les garde-fous

9 seuils modifiables (écart d'anomalie, durée minimale, origines indépendantes pour 25, événements et familles pour 40, réévaluations stables avant baisse, expiration d'un signal faible, familles obligatoires pour 0, référence minimale). Les 8 paliers et les définitions de 0 et de 100 **ne sont pas modifiables**.

- Valeur du plan affichée à côté de chaque champ, **limites de sécurité** (hors limites ou hors pas : erreur, bouton bloqué).
- **Confirmation avant d'enregistrer** : liste « ancien → nouveau », phrase sur la comparabilité, **motif obligatoire** (8 caractères minimum) et case à cocher.
- **Chaque changement est daté et conservé** (nouvelle version `seuils-vN`, jamais d'écrasement) ; historique consultable avec motif et auteur.
- **« Revenir aux valeurs du plan »** : même confirmation ; c'est un changement de plus dans l'historique, rien n'est effacé.
- **Indicateur sur la jauge** tant que des seuils diffèrent du plan (« ⚠ Seuils modifiés (n) — différents de ceux du plan », cliquable), rappelé dans « Comprendre l'échelle ».
- Phrase affichée en haut de l'écran et dans la confirmation : *« Changer un seuil change la façon dont les paliers sont calculés : les valeurs d'avant et d'après ne reposent plus sur les mêmes règles, l'historique et la tendance deviennent donc moins comparables. »* Après un changement, la tendance est affichée « non comparable » et un marqueur « Seuils vN » apparaît dans l'historique.
- En maquette, l'enregistrement ne recalcule pas la jauge (c'est le serveur qui le fera) ; seuls l'historique, l'indicateur et la tendance réagissent.

## Où voir (captures dans `docs/screenshots/`, 41 images)

- Pages principales : `nominal-sombre-{320,390,768,1440}.png`, `nominal-clair-{390,1440}.png`.
- **Réglages (mobile 390 + ordinateur 1440 pour chaque écran)** : `reglages-general-*`, `reglages-etat-des-sources-*` (scénario « données indisponibles » pour montrer OK, BLOCKED, FAIL et SKIPPED), `reglages-notifications-*`, `reglages-seuils-*`, `reglages-seuils-garde-fou-limite-*`, `reglages-seuils-confirmation-*`.
- États : `etat-*` (7 états, dont `etat-seuils-modifies-*`), cartes (`carte-*`), dialogues, dossiers, sources, journal.

## Lancer

```bash
cd frontend && npm ci && PORT=5173 npm run dev     # http://localhost:5173
# menu « Scénario de démonstration » en haut ; Réglages : bouton en haut à droite (#/reglages/seuils, etc.)
npm test && npm run e2e && npm run screenshots
```
Docker/Pi : voir `frontend/README.md` (port via `PORT`).

## Vérifications

- **71 tests unitaires** : échelle, escalier sans interpolation, contrastes WCAG AA des deux thèmes (dont le texte sur le bandeau ambre), scénarios, garde-fous des seuils (limites, versions successives, historique jamais écrasé, retour au plan, tendance non comparable).
- **42 tests Playwright** (Chromium) : aucun défilement horizontal (toutes pages × 8 scénarios × 4 largeurs, Réglages compris), cibles tactiles ≥ 44 px, clavier, axe-core WCAG 2.x A/AA sans violation (2 thèmes, Réglages et dialogues compris), thème sombre par défaut malgré un système clair, pays du flanc est, bandeau permanent, état des sources en lecture seule, notifications, parcours complet des seuils (limite → confirmation → motif → historique → indicateur sur la jauge → retour au plan), **zéro requête externe**.

## Limites et points de vigilance

- **Docker toujours non testé** (pas de démon dans ce cloud). À essayer d'abord sur le Pi.
- Chromium seulement ; Safari iPhone et Firefox non testés.
- **Événements fictifs sur la Russie, l'Ukraine, la Biélorussie…** : volontairement neutres (restriction aérienne, avis renouvelé, exercice annoncé, couverture réduite), tous marqués fictifs, aucun acte hostile attribué à un État. À garder ainsi si tu modifies les mocks.
- **Les seuils, un risque d'usage** : pouvoir modifier les seuils, c'est aussi pouvoir les régler jusqu'à obtenir le palier qu'on espère. Les garde-fous (motif, historique, indicateur) rendent cela visible, pas impossible. Je recommande de **garder les valeurs du plan pendant tout le pilote** (lot 6) et de ne les toucher qu'avec un motif écrit, en relisant l'historique ensuite. Si tu veux plus strict : un « mode essai » qui n'affecte pas la jauge officielle, ou un délai avant prise d'effet (à décider avec A).
- Les 9 seuils sont **ma lecture du plan** (§5 et §6) ; « expiration d'un signal faible = 168 h » est un défaut de maquette (le plan demande une durée versionnée sans la fixer). La liste réelle dépend du moteur du lot 3.
- L'« auteur » d'un changement est fixe (« David (maquette) ») : pas d'authentification en maquette ; le serveur devra identifier l'auteur.
- Non fait : authentification, pagination, impression, mode hors-ligne PWA, SSE réel (le code client existe, sans serveur en face).
- Carte : toujours sans zoom ni déplacement (décision 4) ; en vue Europe, Lituanie et Lettonie se regroupent en un cercle « 2 » (comportement voulu : on compte des événements uniques).
- `docs/PLAN.md` n'est pas copié sur cette branche (propriété de A).

## Écarts avec le backend (résumé, détail dans `docs/api-contract.md`)

À aligner avec A : (1) seules 3 routes existent, tout le reste (overview, events, gauge, history, dossiers, journal, thresholds, notifications, SSE) est à créer ; (2) états de connecteurs `ok/degraded/failing/rate_limited/blocked` à convertir en `verdict` OK/BLOCKED/FAIL/SKIPPED + `state` ; (3) pas de centres indicatifs par zone dans `zones.yaml` (nécessaires à la carte) ; (4) statuts d'événement `active/to_verify/…` vs retenu/contexte/à vérifier ; (5) raisons d'exclusion à compléter (`hors_perimetre`, `preuve_insuffisante`) ; (6) `index_policy_versions` : insert-only pour les seuils. **Déjà alignés** : vocabulaire des précisions de date (le dashboard a repris celui du backend), groupes d'origine, extraits avec positions, liens proposés (`event_links`).

## Questions restantes pour David

1. **Notifications activées par défaut ?** Tu as choisi le niveau « officielles + A3 ». Le plan recommande 2 à 4 semaines de **mode silencieux** avant d'activer quoi que ce soit : on présélectionne « activées » (actuel) ou « silencieux » jusqu'à la fin du pilote ?
2. **Seuils** : la liste des 9 te convient-elle, ou en veux-tu moins (par prudence) ? Et es-tu d'accord pour **geler** les seuils pendant le pilote ?
3. **Vue Europe par défaut** (au lieu de France) : OK ?
4. **Russie** : j'ai placé le marqueur sur « l'ouest de la Russie » (échelle région) plutôt qu'au centre du pays (qui tomberait en Sibérie). C'est cohérent avec « jamais de coordonnées précises », mais dis-moi si tu préfères un autre repère.
5. Nom d'auteur dans l'historique des seuils : « David » suffit pour un seul utilisateur ?
