# ÉTAT — session B (dashboard, lot 4) · branche `dashboard`

Dernière mise à jour : 29 octobre 2026. Je me suis arrêtée là, en attente de ta validation. Rien n'est fusionné dans `main`.

## En une phrase

Le dashboard **VEILLE** existe en maquette complète sur **données fictives** : cadran, conclusion sans IA, carte hors ligne, fiches de preuves, dossiers, sources, journal, tous les états particuliers du plan, sur ordinateur et téléphone. Il ne fait aucune requête externe (vérifié par test).

## Comment le voir (le plus simple : les captures)

Dossier [`docs/screenshots/`](docs/screenshots/) (27 images, visibles directement sur GitHub) :

- `nominal-sombre-{320,390,768,1440}.png` et `nominal-clair-{390,1440}.png` : la page d'accueil aux quatre largeurs demandées.
- `etat-*-{390,1440}.png` : les six états particuliers (données indisponibles, situation ambiguë, alerte civile, nucléaire/radiologique, changement de méthode, fait grave avec couverture partielle).
- `carte-europe|monde|outre-mer-1440.png`, `carte-mobile-390.png`, `dialogue-echelle-1440.png`, `dialogue-ia-1440.png`, `dossiers-1440.png`, `sources-1440.png`, `journal-1440.png`.

## Comment le lancer chez toi

```bash
cd frontend
npm ci
PORT=5173 npm run dev          # puis ouvrir http://localhost:5173
```

Sur le Raspberry Pi (Docker) : `cd frontend && cp .env.example .env`, mettre l'IP du Pi dans `BIND_ADDRESS`, puis `docker compose -f compose.dashboard.yaml up --build`. Le port vient de la variable `PORT`.
Le menu « Scénario de démonstration » en haut de la page bascule entre les 7 situations. Détails : [`frontend/README.md`](frontend/README.md).

## Ce qui est fait (lot 4, sur maquette)

- **Cadran** : arc de 270° gradué 0–25–55–85–100, uniquement les 8 paliers, « Indice de situation · pas une probabilité », bouton « Comprendre l'échelle » (0, chaque palier, 100, état non calculable). Tendance dite « passage du palier 25 au palier 40 », jamais en pourcentage. Aucun compte à rebours, aucune animation.
- **Interprétation sans IA** : conclusion par gabarit (chaque preuve cliquable), hypothèses H0–H4 avec « en faveur / contradictions / discriminants manquants », couverture et santé des données.
- **Carte 2D hors ligne** : vues France (métropole ou outre-mer, 8 vignettes), Europe, Monde ; 5 couches sélectionnables (la 6e, satellite, est grisée « phase ultérieure ») ; filtre de période ; « éléments retenus seulement » ; affichage des exclus. Marqueurs indicatifs (anneau pointillé), regroupés en comptant des événements uniques ; liste « non localisé ».
- **Sélection synchronisée** marqueur ↔ liste de boutons ↔ fiche (sources, chaîne de reprises, dates séparées, règle/version, effet « critère rempli / non rempli »). Statuts retenu / contexte / à vérifier, distincts de « source officielle ». Exclus visibles avec leur motif.
- **Pages** : Vue d'ensemble, Dossiers (onglets « Interprétation par règles / Éléments / Analyse IA »), Carte, Sources, Journal. Bouton IA factice avec confirmation du coût maximum, périmètre, états « désactivée » et « budget épuisé » : **aucun appel**.
- **Mise en page** : ≥ 1100 px colonne gauche ≈ 25 % / carte ≈ 75 % ; 320–767 px ordre vertical du plan, carte directement dans la page, barre de navigation en bas, cibles ≥ 44 px, aucun défilement horizontal (testé sur 5 pages × 7 scénarios × 4 largeurs).
- **Thèmes** : bleu nuit par défaut + clair accessible (réglage « automatique » suivant le système, mémorisé localement). Cyan = données, ambre = vigilance, rouge seulement à partir du palier 70 ou pour une alerte civile ; chaque couleur est doublée d'un libellé ou d'une forme.
- **Prêt à brancher** : `src/api/client.ts` (interface unique, REST + SSE), types dans `src/types.ts`, contrat rédigé dans [`docs/api-contract.md`](docs/api-contract.md).
- **Livraison** : versions exactes verrouillées (`package-lock.json`), Dockerfile multi-étapes sur images compatibles arm64 (vérifié sur Docker Hub : `node:22.22-alpine`, `nginx-unprivileged:1.28-alpine`), port par variable d'environnement, aucun secret.

## Vérifications effectuées

- 62 tests unitaires : échelle, escalier sans interpolation, intervalles sans mesure, contrastes WCAG AA (texte 4,5:1, éléments graphiques 3:1) dans les deux thèmes, cohérence des scénarios.
- 32 tests Playwright (Chromium) : clavier (lien d'évitement, dialogues, onglets aux flèches, sélection par la liste), axe-core WCAG 2.x A/AA sans violation (2 thèmes × 4 scénarios × 5 pages + dialogue), états particuliers, **zéro requête hors de la page**.

## Choix pris, en termes simples

1. **Carte dessinée par moi en SVG avec d3-geo, pas Leaflet/MapLibre** : pas de tuiles à télécharger, donc elle marche sans Internet. Contrepartie : pas de zoom ni de glisser (trois vues fixes). Suffisant pour des positions « à l'échelle du pays » ; à reconsidérer si tu veux du détail.
2. **Géométries Natural Earth simplifiées (285 Ko)**, commitées ; le script qui les fabrique est dans `frontend/scripts/`.
3. **God's Eye View** : cloné et lu. Licence MIT, mais je n'ai **copié aucun code** : c'est un globe 3D (Cesium), le plan interdit de le reprendre. J'ai gardé l'esprit : poste de supervision sombre, panneau de couches, sélection d'objets, chiffres tabulaires.
4. **Les marqueurs de la carte ne sont pas accessibles au clavier** ; la liste de boutons l'est et fait exactement la même chose (c'est ce que demande le plan). Évite deux arrêts de tabulation par élément.
5. **Le dashboard n'applique aucune règle métier** : il affiche ce que le serveur calcule. Seule la phrase de conclusion est assemblée côté écran, à partir de morceaux structurés.
6. **Horloge figée** (29 oct. 2026 15:30 Paris) dans la maquette, pour que captures et tests restent identiques.
7. **Palier 40 par défaut** dans la maquette parce qu'il montre le plus de fonctions (convergence, hypothèses) ; ce n'est pas une évaluation de quoi que ce soit.

## Limites et points de vigilance (honnêtement)

- **Docker non testé ici** : le conteneur de ce cloud n'a pas de démon Docker. Dockerfile et configuration nginx sont écrits avec soin mais **jamais exécutés**. À tester sur le Pi en premier.
- Testé sous **Chromium uniquement** (pas Safari iPhone ni Firefox). Les cibles tactiles et le rendu SVG sur un vrai téléphone restent à vérifier par toi.
- **Mobile : la carte arrive après la jauge et la conclusion** (environ un écran et demi de défilement). Respecte l'ordre du plan, mais « visible directement » est discutable : je peux raccourcir la conclusion sur téléphone ou remonter la carte, à ta demande.
- Le **paquet JavaScript fait ~630 Ko** (dont 285 Ko de cartes). Sans conséquence sur un réseau local ; chargement différé possible plus tard.
- Les événements fictifs utilisent de **vrais noms de pays** (Pologne, Roumanie…) pour la cohérence géographique. Chacun est marqué « Donnée fictive » et le bandeau est permanent, mais c'est à surveiller si une capture sort de son contexte. Alternative : pays imaginaires, au prix du réalisme de la carte.
- Les règles du plan (§6) sont des **propositions à tester**, pas une norme : l'interface le répète (échelle, notice). Elle ne valide pas leur justesse.
- Non fait : réglages réels (thème et mode IA seulement, sans effet serveur), authentification, pagination, internationalisation, impression, mode hors-ligne PWA, mise à jour SSE réelle (le code existe dans `client.ts` mais n'a pas de serveur en face).
- `docs/PLAN.md` n'est **pas copié** sur cette branche (il appartient à la session A, sur `backend`).

## Ce qui reste (hors lot 4)

Brancher la vraie API quand la session A aura aligné ses réponses sur `docs/api-contract.md` ; tester Docker/arm64 sur le Pi ; vérifier sur un vrai téléphone ; affiner les libellés avec les vraies règles du moteur (lot 3) ; lot 5 (IA réelle) à venir.

## Questions pour toi

1. **Mobile** : on garde l'ordre strict du plan (jauge → conclusion → carte), ou tu préfères la carte plus haut ?
2. **Pays réels ou imaginaires** dans les événements fictifs ?
3. **Thème par défaut** : suivre le système (actuel) ou toujours bleu nuit ?
4. **Zoom/déplacement de la carte** : utile pour toi, ou les trois vues fixes suffisent ?
5. Le plan dit « Réglages » dans l'en-tête : qu'attends-tu d'y trouver au-delà du thème et du mode IA (seuils ? sources ? notifications) ?
6. Veux-tu que je prépare, pour la session A, une courte liste d'écarts entre `api-contract.md` et son modèle de données dès que sa branche aura avancé ?
