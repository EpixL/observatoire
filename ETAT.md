# ETAT — session A (backend), lots 0, 1 et 2

> **Mise à jour du 29/10/2026 (soir) — corrections après le smoke RÉEL sur le Pi.** Les sections 3 et 4 ci-dessous remplacent l'état « tout bloqué » du matin.
> Je me suis arrêté après ces corrections ; pas de lot 3 avant ton feu vert.

*Branche `backend` · 29 octobre 2026 · rien n'est fusionné dans `main` · je m'arrête ici et j'attends ta validation.*

## En une phrase

Le code qui **collecte** (6 sources actives, 4 désactivées) et qui **transforme les documents en événements traçables** est écrit et testé
(85 tests verts). Un premier **smoke réel sur le Pi** a eu lieu et a révélé 6 défauts, corrigés (section 3) : dont un **faux succès** (page anti-robot prise pour un document).
Reste à **relancer le smoke** avec le code corrigé, puis à tenir les 72 h : les critères de sortie des lots 0 et 1 ne sont pas encore atteints.

## 1. Ce qui est fait

### Lot 0 — cadrage
- `docs/cadrage.md` : réponses à la section 16 avec ce qu'on sait, et 8 questions pour toi (en bas de ce fichier aussi).
- `docs/source-register.md` : registre des sources, avec le statut de vérification de **chaque** endpoint.
- `docs/runbook.md` : installation sur le Pi, surveillance, sauvegarde, dépannage.

### Lot 1 — collecte
- 4 types de connecteurs (flux RSS/Atom, page web, tableau EASA, API JSON) → **10 sources déclarées, 6 actives** (page France Diplomatie,
  EASA, IODA, CERT-FR ×2, France 24) ; désactivées : RSS France Diplomatie (403) et Vigipirate (page anti-robot) avec leur motif, OTAN et UE/SEAE (URL inconnue).
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

## 3. Endpoints : résultat du smoke réel sur le Pi (29/10/2026, 17:08 UTC) et corrections

Le smoke du cloud (matin) était entièrement bloqué par le proxy. Le smoke **réel** sur le Pi donne :

| Source | Constat réel | Correction faite | Statut maintenant |
|---|---|---|---|
| france-diplomatie-cv | échec : l'URL avec « / » final redirige vers `http://` (port 80 fermé), erreur opaque | URL **sans** « / » ; toute redirection https→http devient une erreur claire « redirection non sécurisée » ; marqueur de contenu attendu | à **relancer** |
| france-diplomatie-rss | 403 avec notre UA honnête | **désactivée**, motif écrit, aucun contournement | `blocked_by_site` |
| easa-czib | 200, mais compté « 1 item » alors que le tableau contient un bulletin par ligne | nouveau connecteur : **un document par CZIB** (numéro, révision, zone, émission, révision, validité, statut, lien ; dates JJ/MM/AAAA). Nouvelle révision = changement de fond ; prolongation de `until` seule = « prolongation de validité » ; liste vide = « format inattendu » | `partially_verified` |
| ioda-fr | 200, `data: []` (France) | fixture réelle ajoutée ; copyright Georgia Tech noté dans le registre | `partially_verified` (forme d'un événement toujours non vue) |
| cert-fr-alertes / actualite | 200, 40 entrées ; ordre **non chronologique** ; « [MàJ] » datés de l'origine | « [MàJ] » = nouvelle version du même avis, date d'origine conservée mais **marquée**, jamais prise pour une republication ; arriéré du 1er relevé écarté ; plus aucune hypothèse sur l'ordre | `verified` |
| sgdsn-vigipirate | **faux succès** : la page « 200 » était un défi anti-robot Gcore | détection générique des pages de défi (Gcore, Cloudflare, mur JavaScript/cookies) → `blocked`, **jamais stockée**, jamais comptée comme succès, attente ≥ 6 h ; source **désactivée** avec son motif | `blocked_by_site` |
| france24-fr | 200, 24 entrées | — | `verified` |
| nato-news / eeas-presse | non testées | — | `to_discover`, désactivées |

**Aucun contournement** n'a été ajouté (ni User-Agent de navigateur, ni JavaScript, ni cookies), conformément à la consigne : pour Vigipirate et le RSS de France Diplomatie,
il faut trouver une **autre source officielle** (flux documenté dans la FAQ voyage ; data.gouv.fr ou page non protégée pour Vigipirate). Je n'ai pas pu la chercher (pas d'accès réseau aux sites).
Sans Vigipirate, la famille « autorités/mesures » côté France repose pour l'instant sur CERT-FR, EASA et la page des conseils aux voyageurs.

Nouveau contrôle positif par source (`expected_marker`) : une page 200 qui ne contient pas ce qu'on attend est une erreur « format inattendu », pas un succès.

Toujours pas fait : construire les images Docker (pas de démon dans le cloud), mesurer la charge, tenir 72 h.

## 4. À relancer sur le Pi (commandes exactes)

```bash
cd ~/observatoire && git pull origin backend
# DATA_DIR vient de .env ; ici le disque Btrfs /mnt/homelab, jamais le disque système
sed -i 's#^DATA_DIR=.*#DATA_DIR=/mnt/homelab/veille#' .env      # (ou éditer à la main)
set -a; . ./.env; set +a
sudo mkdir -p "$DATA_DIR"/{postgres,snapshots} && sudo chattr +C "$DATA_DIR/postgres" \
  && sudo chown 70:70 "$DATA_DIR/postgres" && sudo chown 10001:10001 "$DATA_DIR/snapshots"

SMOKE_LOCAL=1 ./scripts/smoke-collectors.sh --all     # 1) relancer le smoke avec le code corrigé
```
Résultats attendus : `france-diplomatie-cv` OK (sinon me renvoyer l'erreur) ; `easa-czib` OK avec **plusieurs items** (un par CZIB) ;
`sgdsn-vigipirate` et `france-diplomatie-rss` BLOCKED (désactivées, c'est normal avec `--all`) ; `ioda-fr` OK (0 item si rien en France) ;
CERT-FR et France 24 OK. Renvoyer `smoke-out/smoke-report.json` ; pour EASA, joindre aussi `smoke-out/raw/easa-czib.html` (page entière) afin que je valide la pagination et la disposition des cellules.

Puis, si le smoke est bon : démarrage, surveillance 72 h, test de reprise (procédure : `docs/runbook.md`, §3 et §4).

## 5. Points de vigilance (mon regard de mentor)

1. **Le risque n°1 est la distance entre mes extracteurs et les vraies pages.** Le smoke réel l'a confirmé (faux succès Gcore, EASA mal découpée, URL en redirection). Les parseurs restants (France Diplomatie, événements IODA)
   ont été écrits d'après la forme *attendue*. Prévois que le premier passage réel demande des ajustements : c'est normal, pas un échec.
   Ne déclare pas le lot 1 « fini » avant que le smoke soit au vert et que 72 h se soient écoulées.
2. **Ne confonds pas « beaucoup de tests verts » et « ça marche sur le terrain ».** 85 tests prouvent la logique sur des cas fictifs que j'ai moi-même imaginés ;
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

`pytest` : **85 tests verts** (dont les cas issus du smoke réel : page Gcore, ligne EASA, enveloppe IODA, flux CERT-FR en désordre) (PostgreSQL réel + faux serveur HTTP) · migrations 0001/0002 : montée, descente, remontée OK · worker : un seul actif (verrou), arrêt propre sur SIGTERM,
attente croissante après échecs vérifiée par test automatique · `docker compose config` valide · images `python:3.13-slim-bookworm` et `postgres:16-alpine` présentes en arm64 (digests dans les fichiers) ·
installation des dépendances dans un environnement vierge puis CLI et API démarrés · aucune chaîne ressemblant à un secret dans les fichiers versionnés.
