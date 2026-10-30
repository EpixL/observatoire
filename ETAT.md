# ETAT — session A (backend), lots 0 à 3 (lot 3 partiel)

*Branche `backend` · mise à jour du 30 octobre 2026 · rien n'est fusionné dans `main` · je m'arrête ici et j'attends ta validation avant d'aller plus loin.*

## En une phrase

La collecte (6 sources actives), les événements traçables et — nouveau — la **jauge 0-100 par paliers avec couverture, trois dossiers, seuils versionnés et API** sont écrits et testés
(130 tests verts). Le lot 3 est **partiel** : le moteur d'hypothèses et la conclusion à gabarits ne sont pas faits, donc son critère de sortie n'est pas atteint.
Sur le terrain, **la jauge sera « non calculable » pendant 8 semaines** (référence quantitative insuffisante) : c'est voulu.

## 1. Ce qui est fait depuis la dernière fois

### Corrections demandées après le 2e smoke réel
- **Second smoke du Pi (17:58 UTC) : propre** — page des conseils OK, EASA 22 CZIB, IODA OK, CERT-FR 40 + 40, France 24 : 24 ; Vigipirate BLOCKED (Gcore détecté, non contourné) ; RSS France Diplomatie 403 ; OTAN/SEAE ignorées.
- `sample_title` du rapport de smoke = article le **plus récent** (CERT-FR mélange 2014 et 2026) ; testé.
- Statuts du registre mis à jour (`verified` : page conseils, EASA, CERT-FR ×2, France 24 ; `partially_verified` : IODA, car la forme d'un événement n'a jamais été vue).

### Décisions de David (29/10) appliquées
Détail et emplacement de chacune : `docs/cadrage.md` (tableau « Décisions »). En bref : 16 Go de RAM, données sur `/mnt/homelab` (disque dur mécanique, `chattr +C` conservé) ; **port 8100** ; **zone secondaire = flanc est**
(UA, RU, BY, PL, LT, LV, EE, MD : gazetier, territoire de jauge, 9 entités IODA) ; notifications officielles + A3 (rien d'implémenté, lot 7) ; couverture = les 3 familles du plan ;
**purge à 12 mois implémentée** (`purge-history`, quotidienne, `--dry-run`, protège ce que fondent les décisions humaines) ; **`scripts/backup-db.sh`** (pg_dump, 7 jours, vérification, **pas de cron**) ;
`COLLECTOR_CONTACT=smoke-test` par défaut, aucune adresse e-mail dans le dépôt.

### Sources (points A et B de la demande)
- **Conditions d'utilisation** : recherche faite, mais **le cloud ne résout aucun domaine source** (WebFetch : ENOTFOUND pour tous) → je n'ai lu **aucune** page à la source, seulement des extraits de recherche, marqués comme tels (`docs/source-register.md`, section dédiée, un tableau avec liens et cadence). Cadences ralenties à **30 min** pour toutes les sources dont le cadre est douteux (France Diplomatie, EASA, IODA, France 24) ; CERT-FR reste à 15 min (licence ouverte annoncée).
  Deux points à retenir : IODA est sous copyright Georgia Tech (usage non académique → licence à demander ; usage privé seulement) ; EASA passe certains bulletins en accès restreint (la liste publique peut être **incomplète**).
- **Vigipirate** : aucune source officielle accessible trouvée. Ajout d'une candidate **`vigipirate-gouv`** (page gouvernement.fr, URL supposée, désactivée) à tester sur le Pi ; sinon suivi des annonces (info.gouv.fr) ou saisie humaine — jamais de contournement.
- **RSS France Diplomatie** : aucun flux RSS des conseils trouvé (canaux officiels : application et compte X). Reste désactivé ; la page des conseils est la voie principale.
- **OTAN / SEAE** : OTAN = page officielle « RSS » comme point de départ de `discover-feeds` ; SEAE = aucun RSS, liste de pages paginée. Les deux restent **désactivés** (`to_discover`).

### Lot 3 (partiel) — `docs/lot3-jauge.md`
- **Jauge** : 8 paliers, règles scriptées, jamais de somme ; rhétorique plafonnée à 10 ; 70/85/100 **uniquement par revue humaine** validée (faits, zone, période, acteur documentés séparément) ; une attaque hors du territoire ne compte pas pour lui.
- **Couverture** : 3 familles + référence de 8 semaines ; sinon « non calculable » (jamais 0) ; exception : fait grave humain (≥ 70) publié avec badge « couverture partielle ».
- **Baisse/hausse** : hausse immédiate ; baisse après N réévaluations stables ; correction factuelle immédiate ; 85/100 ne baissent pas avec le temps.
- **Seuils versionnés** (`seuils-v1` = plan) : insert-only, chaque changement daté/acteur/motif, retour au plan = un changement de plus, **chaque calcul enregistre la version utilisée**, tendance `non_comparable` après changement.
- **API** (`docs/api-contract-backend-proposal.md`) : seuils (lecture, `PUT`, historique, versions, réinitialisation), état des sources, jauge/détail/historique, dossiers, événements, file de revue, revue humaine. Écritures protégées par `ADMIN_TOKEN` (**désactivées si vide**). Proposition écrite dans le fichier dédié, **sans toucher à `docs/api-contract.md`** (propriété de B).

## 2. Lot 3 : ce qui n'est PAS fait
Moteur d'hypothèses H0-H4 et conclusion à gabarits (donc `hypotheses: []`, dit explicitement) · voie rapide « décisions officielles » · détection MAD (les seuils `anomaly_mad_k`/`anomaly_windows` existent mais ne servent à rien tant qu'aucune série numérique n'est collectée) ·
badge nucléaire et alerte civile · `/overview`, `/journal`, SSE `/stream`, `/settings/*`, `/ai/*` · exclusions `doublon`/`hors_perimetre`/`preuve_insuffisante`.

## 3. À relancer / tester sur le Pi (commandes exactes)

```bash
cd ~/observatoire && git pull origin backend
# .env : DATA_DIR=/mnt/homelab/veille, API_HOST_PORT=8100, COLLECTOR_CONTACT=smoke-test, ADMIN_TOKEN=$(openssl rand -hex 24)   (jeton seulement dans .env)
set -a; . ./.env; set +a
sudo mkdir -p "$DATA_DIR"/{postgres,snapshots} && sudo chattr +C "$DATA_DIR/postgres" && sudo chown 70:70 "$DATA_DIR/postgres" && sudo chown 10001:10001 "$DATA_DIR/snapshots"

# 1) smoke des NOUVEAUTÉS : IODA avec 9 entités, candidate Vigipirate, découverte du flux OTAN
SMOKE_LOCAL=1 ./scripts/smoke-collectors.sh --all
SMOKE_LOCAL=1 ./scripts/smoke-collectors.sh --source vigipirate-gouv --all      # doit être OK sans défi anti-robot ET contenir « vigipirate »
cd backend && CONFIG_DIR=../config python -m app.cli discover-feeds nato-news    # liste les flux de la page RSS officielle de l'OTAN ; me renvoyer la sortie

# 2) démarrage, puis la jauge (attendue « non_calculable » pendant 8 semaines)
cd .. && docker compose --env-file .env up -d --build
docker compose exec worker python -m app.cli evaluate-gauge
curl -s "http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/gauge/detail?territory=FR" | python3 -m json.tool | head -60
curl -s "http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/sources/status" | python3 -m json.tool | head -40

# 3) test des seuils (écriture protégée) puis retour au plan
curl -s -X PUT "http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/thresholds" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"changes":[{"key":"downgrade_evals","to":1}],"reason":"essai de réactivité","confirmed":true,"expected_policy_version":"seuils-v1"}'
curl -s -X POST "http://$API_BIND_ADDR:$API_HOST_PORT/api/v1/thresholds/reset" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"reason":"retour aux valeurs du plan","confirmed":true,"expected_policy_version":"seuils-v2"}'

# 4) sauvegarde manuelle (pas de cron) puis essai à blanc de la purge
./scripts/backup-db.sh && docker compose exec worker python -m app.cli purge-history --dry-run
```
Ce que je ne peux pas vérifier d'ici : l'IODA avec 9 entités (volume réel, forme d'un événement), la candidate Vigipirate, le comportement du disque dur, la charge, les 72 h.

## 4. Points de vigilance (mon regard de mentor)

1. **Tu as décidé « 0 » = 3 familles + 8 semaines, et c'est cohérent avec le plan, mais mesure ce que cela implique** : pendant deux mois l'écran principal affichera un cadran grisé. Garde ça en tête avant de juger l'outil ; si c'est trop frustrant, `baseline_weeks` descend à 4, **en le notant** (versionné) — mais ne le fais pas pour « voir un chiffre ».
2. **Aucune revue humaine ne s'est encore faite, et sans elle les paliers 70+ n'existent pas.** C'est le bon réglage (la prose n'est jamais une preuve), mais il déplace le travail vers toi : décide qui qualifie, et à quel rythme, avant le pilote.
3. **Les règles de classification des événements (`engine._classify`) sont ma proposition**, jamais confrontée à de vraies données. Relis-les (`docs/lot3-jauge.md`) et dis-moi ce qui te choque ; c'est le cœur de ce que « tension documentée » veut dire.
4. **Dépendance à des sources fragiles** : l'état de la famille « autorités » repose sur EASA (liste publique possiblement incomplète) et une page web ; Vigipirate manque. Ne conclus rien de rassurant d'un « 0 » tant que cela n'est pas réglé.
5. **Je n'ai pas lu les conditions d'utilisation à la source** (cloud bloqué). Mon tableau est une base de travail, pas un avis juridique ; IODA en particulier : usage privé uniquement.
6. **Les tests prouvent la logique sur des cas que j'ai imaginés** (130 verts) ; le terrain dira le reste. La période silencieuse est incontournable.
7. **Le jeton `ADMIN_TOKEN` est une protection minimale** (un secret partagé, sans comptes). Suffisant sur un LAN domestique ; à renforcer (VPN, vrai compte) avant tout accès extérieur.

## 5. Alignement avec la session B
J'ai lu `docs/api-contract.md` (branche `dashboard`) et repris ses clés de seuils, son format `PUT /thresholds`, ses codes d'erreur et sa table de correspondance des états de sources.
Écarts et ajouts à intégrer côté B : `docs/api-contract-backend-proposal.md` (dont `fictional:false`, centres de zones « pays » seulement, `hypotheses:[]` tant que le moteur n'existe pas).

## 6. Questions ouvertes
1. Qui fait la revue humaine des événements hostiles, et à quel rythme ?
2. Vigipirate : on teste `vigipirate-gouv`, on suit les annonces officielles, ou on saisit le niveau à la main ?
3. Veux-tu que je continue le lot 3 (moteur d'hypothèses + conclusion à gabarits + voie officielle) avant le lot 4, ou que B intègre d'abord ce qui existe ?
4. IODA : on écrit à Georgia Tech pour clarifier l'usage, ou on reste en usage strictement personnel ?
5. Veux-tu garder `baseline_weeks = 8` au démarrage ?

## 7. Contrôles effectués
`pytest` : **130 tests verts** (PostgreSQL réel, faux serveur HTTP, API en `TestClient`) · migrations 0001→0003 : montée, descente, remontée OK · `docker compose config` valide (api: `ADMIN_TOKEN` optionnel) · scripts `bash -n` OK ·
aucun secret dans les fichiers versionnés (`.env.example` : `ADMIN_TOKEN=` vide) · recherche web des conditions d'utilisation faite mais **sans accès aux pages sources** · images Docker non construites (pas de démon dans le cloud).
