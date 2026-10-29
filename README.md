# VEILLE — observatoire de situation

Dashboard privé de veille (homelab). Plan complet : [`docs/PLAN.md`](docs/PLAN.md).

## État de la branche `backend` (session A, lots 0 à 2)

| Lot | Contenu | Où |
|---|---|---|
| 0 — Cadrage | réponses à la section 16, questions ouvertes | [`docs/cadrage.md`](docs/cadrage.md), [`docs/source-register.md`](docs/source-register.md) |
| 1 — Collecte | connecteurs, versionnage, santé, backoff | `backend/app/collectors/`, `config/sources.yaml` |
| 2 — Événements | affirmations, déduplication, provenance, corpus de cas piégeux | `backend/app/events/`, [`docs/lot2-evenements.md`](docs/lot2-evenements.md) |

Bilan, choix et commandes à lancer sur le Pi : [`ETAT.md`](ETAT.md). Installation : [`docs/runbook.md`](docs/runbook.md).

## Tests

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r backend/requirements-dev.txt
eval "$(scripts/dev-postgres.sh start)"     # PostgreSQL jetable local (hors Docker)
pytest
```
Les tests utilisent un vrai PostgreSQL et un faux serveur HTTP : aucun accès Internet. Les fixtures sont **fictives**, sauf quelques extraits réels relevés sur le Pi, listés dans `tests/fixtures/README.md`.
