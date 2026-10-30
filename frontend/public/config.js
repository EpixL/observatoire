// Configuration d'exécution (chargée AVANT l'application, voir index.html).
// Valeurs par défaut = mode maquette. Dans le conteneur, nginx remplace ce fichier à partir des variables
// d'environnement (API_MODE = mock | live) : la même image sert la maquette et l'API réelle.
window.__VEILLE__ = window.__VEILLE__ || {};
