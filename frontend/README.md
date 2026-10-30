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

- Les seuils sont **gelés** par défaut (indicateur serveur `pilot_frozen`) ; en maquette, `?pilot_frozen=0` simule le déblocage pour tester les garde-fous.
- Scénarios de démonstration : `?scenario=nominal|indisponible|ambigu|civile|nucleaire|methode|partielle|seuils` (ou menu en haut de page).
- Pages : `#/vue`, `#/dossiers`, `#/carte`, `#/sources`, `#/journal`, `#/reglages/{general,sources,notifications,seuils}`.
- Données fictives : `src/mocks/`. Branchement futur : `src/api/client.ts` (REST + SSE, voir `../docs/api-contract.md`), activé par `VITE_API_BASE`.
- **Modes** : `mock` (défaut, données fictives, aucune requête `/api`) et `live` (API réelle, erreur explicite si elle ne répond pas, jamais de repli fictif).
  En développement : `VITE_API_MODE=live npm run dev` (+ proxy Vite ou `VITE_API_BASE`). En conteneur : variable `API_MODE`.
- **Docker (arm64 + amd64)** : `Dockerfile` (nginx non privilégié, relais `/api` et `/config.js` générés au lancement), `compose.dashboard.yaml`, `scripts/docker-build.sh`.
  Variables (voir `.env.example`) : `PORT` (Pi : 8101), `API_MODE`, `API_UPSTREAM` (Pi : `host.docker.internal:8100`), `DNS_RESOLVER`, `BIND_ADDRESS`.
  Aucun port ni secret dans le code ou l'image.
- Dans l'environnement cloud, si Playwright ne trouve pas son navigateur : `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`.
