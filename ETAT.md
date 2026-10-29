# ETAT — session A (backend), lots 0, 1 et 2

*Branche `backend` · 29 octobre 2026 · rien n'est fusionné dans `main` · je m'arrête ici et j'attends ta validation.*

## En une phrase

Le code qui **collecte** (8 sources) et qui **transforme les documents en événements traçables** est écrit et testé
(76 tests verts), mais **aucun vrai flux n'a pu être appelé** depuis le cloud : tout a été testé sur des réponses
**fictives**. Les critères de sortie « quotas et accès vérifiés » (lot 0) et « 72 h de fonctionnement » (lot 1) ne peuvent
donc être validés que sur ton Pi.

## 1. Ce qui est fait

### Lot 0 — cadrage
- `docs/cadrage.md` : réponses à la section 16 avec ce qu'on sait, et 8 questions pour toi (en bas de ce fichier aussi).
- `docs/source-register.md` : registre des sources, avec le statut de vérification de **chaque** endpoint.
- `docs/runbook.md` : installation sur le Pi, surveillance, sauvegarde, dépannage.

### Lot 1 — collecte
- 3 types de connecteurs (flux RSS/Atom, page web, API JSON) → **10 sources déclarées, 8 actives** (France Diplomatie ×2,
  EASA, IODA, CERT-FR ×2, Vigipirate, France 24) ; OTAN et UE/SEAE sont déclarées mais désactivées (URL du flux inconnue).
- Chaque document est conservé **version par version** (jamais écrasé : la base l'interdit). Chaque version porte son empreinte,
  son texte normalisé, un snapshot brut compressé, et toutes les dates du plan §4 en UTC (`first_seen_at` ne peut jamais changer, garanti par la base).
- Une date future, sans fuseau, illisible ou absente est **marquée**, jamais corrigée en silence.
- Un changement de **menu, bandeau cookies, mise en page ou simple date « mis à jour le… »** ne compte pas comme un changement de fond ;
  un mot retiré (« Formellement déconseillé » → « Déconseillé ») ou une date de validité modifiée **compte**.
- Santé de chaque connecteur (`connector_health` + journal `fetch_runs`) : `ok`, `degraded` (1 échec), `failing` (≥ 2 échecs),
  `rate_limited` (quota), `blocked`. Politesse : requêtes conditionnelles (ETag/Last-Modified), pause aléatoire ±20 %, attente croissante
  en cas d'erreur (plafond 1 h, 6 h minimum après un 403/404), `Retry-After` respecté, `robots.txt` respecté pour les pages web,
  redirection vers un domaine non autorisé refusée.
- PostgreSQL + migrations (Alembic, aller-retour testé) ; Docker/compose ; CLI ; petite API de santé en lecture seule.

### Lot 2 — événements
- Schémas validés : une affirmation est soit une **observation** (mesure d'un capteur, uniquement IODA), soit une **déclaration**
  (de l'article, du ministère, de la personne citée). Le texte libre ne produit jamais mieux qu'une déclaration *provisoire* « à vérifier ».
- Extraction **sans IA** : champs à vocabulaire fixe (niveaux de conseil, bulletins EASA, posture Vigipirate, identifiants CERT-FR, IODA)
  + lecture prudente de la prose FR/EN (négations, conditionnel, exercices, menaces, attributions).
- Déduplication des documents : URL, empreinte, quasi-doublon, agence citée. On compte des **origines**, pas des articles.
- Rapprochement des événements par type / zone / période / acteurs ; démentis rattachés au même dossier ; republications d'anciens articles écartées ;
  « causes communes » (tempête → panne → aéroport fermé) **proposées**, jamais affirmées ; confirmation officielle **par affirmation**.
- Provenance : citation exacte + position dans la version précise. `verify-provenance` contrôle que rien n'est inventé.
- Corpus de cas piégeux du plan §13 : voir tableau dans `docs/lot2-evenements.md`.

## 2. Choix pris, expliqués simplement

| Choix | Pourquoi |
|---|---|
| **Un premier relevé n'est pas un changement** | Au démarrage on ne connaît pas l'historique. Annoncer « le niveau de conseil a changé » alors qu'on le voit pour la première fois serait inventer une alerte. On enregistre une *base*, et on détecte les changements ensuite. |
| **Les mots-clés ne prouvent rien** | « attaque » dans un article = quelqu'un parle d'attaque. Le système le note comme *déclaration à vérifier*, et crée une file de revue. C'est lent mais honnête (plan §6.7). |
| **En cas de doute, on sous-compte l'indépendance** | Prendre deux reprises de la même dépêche pour deux sources distinctes est l'erreur dangereuse. Se tromper dans l'autre sens fait seulement perdre une corroboration. |
| **Un flux invalide n'est jamais « aucune nouveauté »** | Une page HTML de maintenance, un JSON au format inattendu, un quota dépassé donnent une **erreur visible**, pas une liste vide. (Un test a d'ailleurs trouvé ce défaut chez moi, corrigé.) |
| **Aucun port dans le code** | Tout passe par `.env` ; la base n'expose rien ; seul l'API sort sur l'adresse LAN choisie. |
| **Cadences prudentes (5–15 min)** | Je n'ai pas pu lire les conditions d'utilisation. On resserrera après vérification et mesure. |
| **PostgreSQL 16, Python 3.13, versions verrouillées** | Images arm64 vérifiées avec leur empreinte (digest). 29 paquets Python épinglés, wheels `aarch64` vérifiées. |
| **Mots de passe/clés : uniquement dans `.env`** | Fichier ignoré par Git. `.env.example` ne contient que du factice. Les messages d'erreur masquent `key=`, `token=`, `password=`. |

## 3. Endpoints : vérifiés ou bloqués

**Aucun endpoint n'a pu être vérifié.** Test du 29/10/2026 depuis le cloud (`docs/smoke-cloud-2026-10-29.json`) : le proxy sortant refuse tous les domaines
des sources (`ProxyError: 403 Forbidden`), alors que PyPI et le registre Docker passent. Je n'ai donc rien simulé : les collecteurs sont testés sur des réponses
enregistrées **fictives** (`tests/fixtures/README.md`), jamais présentées comme réelles.

| Source | Résultat cloud | Réserve supplémentaire |
|---|---|---|
| france-diplomatie-cv | bloqué | URL = celle du plan ; structure de page jamais vue |
| france-diplomatie-rss | bloqué | **URL supposée** (flux général du site) |
| easa-czib | bloqué | URL = celle du plan ; structure de page jamais vue |
| ioda-fr | bloqué | **format de réponse reconstruit de mémoire**, quotas inconnus |
| cert-fr-alertes / cert-fr-actualite | bloqué | **URL supposées** (ancien domaine, redirection possible) |
| sgdsn-vigipirate | bloqué | **URL supposée** |
| france24-fr | bloqué | **URL supposée** |
| nato-news / eeas-presse | non testées | désactivées, URL inconnue → `discover-feeds` |

Ce que je n'ai **pas** pu faire non plus : construire les images Docker (pas de démon Docker dans le cloud — j'ai validé `docker compose config`,
l'installation propre des dépendances dans un environnement vierge, et l'existence des images en arm64), mesurer la charge sur le Pi, lancer 72 h.

## 4. À tester sur le Pi (commandes exactes)

Procédure complète : `docs/runbook.md`. L'essentiel :

```bash
git clone https://github.com/EpixL/observatoire.git && cd observatoire && git checkout backend
cp .env.example .env && nano .env                 # mot de passe, DATA_DIR, port libre, contact
sudo ss -ltnp | awk 'NR>1{print $4}' | sed 's/.*://' | sort -n | uniq | tr '\n' ' '   # choisir un port absent de cette liste
sudo mkdir -p /srv/veille/{postgres,snapshots} && sudo chattr +C /srv/veille/postgres \
  && sudo chown 70:70 /srv/veille/postgres && sudo chown 10001:10001 /srv/veille/snapshots

./scripts/smoke-collectors.sh --all               # 1) LE test clé : les vrais flux répondent-ils ?
cat smoke-out/smoke-report.json                   #    à me renvoyer (et le dossier smoke-out/raw/ après relecture)

docker compose --env-file .env up -d --build      # 2) démarrage
docker compose ps && docker compose logs --tail 50 worker
docker compose exec worker python -m app.cli health          # 3) pendant 72 h : états des connecteurs
docker compose exec worker python -m app.cli verify-provenance   # doit afficher "bad": 0
docker compose restart worker                     # 4) test de reprise : aucun doublon ensuite
```
Si le smoke donne `FAIL`/`BLOCKED` sur une source : ne pas insister, m'envoyer le rapport ; c'est le travail normal du premier jour.

## 5. Points de vigilance (mon regard de mentor)

1. **Le risque n°1 est la distance entre mes extracteurs et les vraies pages.** Les parseurs de pages (France Diplomatie, EASA, Vigipirate)
   et d'IODA ont été écrits d'après la forme *attendue*. Prévois que le premier passage réel demande des ajustements : c'est normal, pas un échec.
   Ne déclare pas le lot 1 « fini » avant que le smoke soit au vert et que 72 h se soient écoulées.
2. **Ne confonds pas « beaucoup de tests verts » et « ça marche sur le terrain ».** 76 tests prouvent la logique sur des cas fictifs que j'ai moi-même imaginés ;
   ils ne prouvent pas que les sites réels se comportent ainsi. Le vrai test est la période silencieuse sur le Pi (plan §13).
3. **Tant que les 3 sources structurées ne sont pas validées, le système repose surtout sur de la prose** (France 24), qui est son point faible assumé.
   Regarde la file `reviews` au bout de quelques jours : elle te dira honnêtement ce que le moteur ne comprend pas.
4. **Support de stockage** : si le Pi écrit sur carte SD, PostgreSQL risque de l'user vite. SSD fortement conseillé (cf. cadrage).
5. **Le gazetier (80 territoires) est ma proposition**, pas une décision de ta part : zones secondaires = question 3.
6. **Ne fais pas confiance aux seuils de recouvrement (0,8 / 0,4)** : ce sont des réglages de départ, jamais calibrés sur de vrais textes.
7. **L'API n'a pas d'authentification** (lecture seule, LAN). À traiter avant tout accès hors du LAN, et au plus tard au lot 4.

## 6. Alignement avec la session B (dashboard)

J'ai lu `frontend/src/types.ts` (branche `dashboard`, lecture seule ; `docs/api-contract.md` n'existe pas encore). Écarts à régler au lot 3/4 :
- `occurred_precision` : B = `minute|heure|jour|inconnue` ; moi = `instant|day|month|year|unknown`.
- `reading_status` (`retenu|contexte|a_verifier`) et `exclusion` (`doublon|hors_perimetre|perime|preuve_insuffisante`) : produits au lot 3 ; aujourd'hui j'ai `events.status` (`active|to_verify|historical`) et `exclusion_reason` (`republication`). `doublon` se déduit des groupes d'origine ; `hors_perimetre` dépendra du territoire évalué (lot 3).
- `origin_id` / `is_original` / `independent_origins` ↔ `origin_groups` / `events.origin_count` : correspondance directe.
- `effect` (critère rempli/non rempli), `rule`, `hypotheses`, `Conclusion`, `GaugeState` : lot 3 (aucun calcul de palier n'existe).
- Mon API actuelle (`/api/v1/connectors/health`, `/api/v1/documents`) est provisoire ; je suivrai le contrat de B pour le lot 3.

## 7. Pas fait volontairement

Interprétation, hypothèses, jauge (lot 3) · IA · Telegram/notifications · authentification · sauvegardes automatiques ·
suppression des données au-delà de 12 mois · satellite/aviation/maritime · zones secondaires.

## 8. Questions ouvertes (détail dans `docs/cadrage.md`)

1. RAM du Pi ? Données sur SSD/NVMe (pas SD) ? Espace libre ?
2. Quel port libre pour l'API ?
3. Quelles zones secondaires suivre (3 à 5) ?
4. Niveau de notifications : officiel seul / +A3 / +A2/A3 ?
5. Rétention 12 mois et sauvegardes automatiques : où les stocker ?
6. Profil de couverture du plan (3 familles) : on le teste tel quel au lot 3 ?
7. Contact à mettre dans le User-Agent (visible des sites) ?
8. Conditions d'utilisation des sources : tu les consultes, ou je cherche une fois le Pi connecté ?

## 9. Contrôles effectués

`pytest` : **76 tests verts** (PostgreSQL réel + faux serveur HTTP) · migrations 0001/0002 : montée, descente, remontée OK · worker : un seul actif (verrou), arrêt propre sur SIGTERM,
attente croissante après échecs vérifiée par test automatique · `docker compose config` valide · images `python:3.13-slim-bookworm` et `postgres:16-alpine` présentes en arm64 (digests dans les fichiers) ·
installation des dépendances dans un environnement vierge puis CLI et API démarrés · aucune chaîne ressemblant à un secret dans les fichiers versionnés.
