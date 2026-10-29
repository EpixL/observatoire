# VEILLE — dashboard (maquette, données fictives)

React 19 + TypeScript + Vite. Aucune requête externe, aucun secret, aucune clé.

```bash
npm ci                 # installe les versions exactes du package-lock
PORT=5173 npm run dev  # http://localhost:5173  (PORT est optionnel ; Vite choisit sinon son port par défaut)
npm run build && PORT=4173 npm run preview
npm test               # tests unitaires (échelle, historique en escalier, contrastes WCAG)
npm run e2e            # Playwright : mise en page 320–1440 px, clavier, axe-core, états, zéro requête externe
npm run screenshots    # régénère ../docs/screenshots/
```

- Scénarios de démonstration : `?scenario=nominal|indisponible|ambigu|civile|nucleaire|methode|partielle|seuils` (ou menu en haut de page).
- Pages : `#/vue`, `#/dossiers`, `#/carte`, `#/sources`, `#/journal`, `#/reglages/{general,sources,notifications,seuils}`.
- Données fictives : `src/mocks/`. Branchement futur : `src/api/client.ts` (REST + SSE, voir `../docs/api-contract.md`), activé par `VITE_API_BASE`.
- Docker (arm64 compatible) : voir `Dockerfile` et `compose.dashboard.yaml` ; port via la variable `PORT`.
- Dans l'environnement cloud, si Playwright ne trouve pas son navigateur : `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`.
