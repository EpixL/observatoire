import type { NotificationSettings, Snapshot, StreamMessage, ThresholdsState } from '../types';
import { buildSnapshot } from '../mocks/scenarios';
import { NOW } from '../mocks/events';
import { applyChanges, modifiedItems } from '../lib/thresholds';

/**
 * Seule porte d'entrée des données du dashboard.
 *  - mode `mock` (défaut) : données fictives locales, aucune requête réseau ;
 *  - mode `live` : API REST + SSE de la même origine (le reverse proxy relaie /api vers le backend).
 * En mode live, une API injoignable donne une erreur explicite : JAMAIS un retour silencieux aux données fictives.
 */
export interface DataClient {
  load(scenario?: string): Promise<Snapshot>;
  /** Abonnement temps réel (SSE). Retourne la fonction de désabonnement. */
  subscribe(onMessage: (m: StreamMessage) => void, onState: (connected: boolean) => void): () => void;
  /** PUT /api/v1/thresholds — refusé (423) tant que `pilot_frozen` ; crée une NOUVELLE version, ne supprime rien. */
  saveThresholds(current: ThresholdsState, changes: { key: string; to: number }[], reason: string): Promise<ThresholdsState>;
  /** POST /api/v1/thresholds/reset — un changement daté de plus, historique conservé. */
  resetThresholds(current: ThresholdsState, reason: string): Promise<ThresholdsState>;
  /** PUT /api/v1/settings/notifications */
  saveNotifications(n: NotificationSettings): Promise<NotificationSettings>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** Maquette : date « simulée » = horloge figée + 1 min par changement (captures et tests déterministes). */
const mockAt = (n: number) => new Date(Date.parse(NOW) + n * 60_000).toISOString().replace('.000Z', 'Z');

export const mockClient: DataClient = {
  async load(scenario = 'nominal') {
    return buildSnapshot(scenario);
  },
  subscribe(_onMessage, onState) {
    onState(false); // maquette : aucun flux
    return () => {};
  },
  async saveThresholds(cur, changes, reason) {
    return applyChanges(cur, changes, reason, mockAt(cur.history.length + 1), 'modification');
  },
  async resetThresholds(cur, reason) {
    return applyChanges(cur, modifiedItems(cur.items).map((i) => ({ key: i.key, to: i.plan_value })), reason, mockAt(cur.history.length + 1), 'retour_plan');
  },
  async saveNotifications(n) {
    return n;
  },
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch {
    throw new ApiError('Aucune réponse du serveur (réseau coupé, API arrêtée ou relais mal configuré).', url, null);
  }
  if (!r.ok) {
    const detail = r.status === 502 || r.status === 503 || r.status === 504 ? 'L’API ne répond pas derrière le relais.' : `Réponse inattendue du serveur.`;
    throw new ApiError(`${detail} (HTTP ${r.status})`, url, r.status);
  }
  try {
    return (await r.json()) as T;
  } catch {
    throw new ApiError('Réponse illisible : ce n’est pas du JSON (le relais renvoie peut-être la page d’accueil au lieu de l’API).', url, r.status);
  }
}

/** Client réel : même origine uniquement (base vide) ; pas de requête vers un domaine externe. */
export function httpClient(base: string): DataClient {
  return {
    load: () => call<Snapshot>(`${base}/api/v1/overview?territory=FR`),
    subscribe(onMessage, onState) {
      const es = new EventSource(`${base}/api/v1/stream`);
      es.onopen = () => onState(true);
      es.onerror = () => onState(false);
      es.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data) as StreamMessage);
        } catch {
          /* message illisible : ignoré, le prochain snapshot remettra l'état d'aplomb */
        }
      };
      return () => es.close();
    },
    saveThresholds: (cur, changes, reason) =>
      call(`${base}/api/v1/thresholds`, { method: 'PUT', body: JSON.stringify({ changes, reason, confirmed: true, expected_policy_version: cur.policy_version }) }),
    resetThresholds: (cur, reason) =>
      call(`${base}/api/v1/thresholds/reset`, { method: 'POST', body: JSON.stringify({ reason, confirmed: true, expected_policy_version: cur.policy_version }) }),
    saveNotifications: (n) => call(`${base}/api/v1/settings/notifications`, { method: 'PUT', body: JSON.stringify({ enabled: n.enabled, level: n.level }) }),
  };
}

/* ---------- Choix du mode ---------- */

declare global {
  interface Window {
    /** Rempli au démarrage du conteneur par /config.js (variables d'environnement), sinon par le build (VITE_*). */
    __VEILLE__?: { apiMode?: string; apiBase?: string };
  }
}

export type ApiMode = 'mock' | 'live';

/** `mock` ou `live` ; toute autre valeur est une erreur de configuration signalée à l'écran (jamais interprétée en silence). */
export function resolveMode(raw: string | undefined): { mode: ApiMode; invalid: string | null } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'mock') return { mode: 'mock', invalid: null };
  if (v === 'live') return { mode: 'live', invalid: null };
  return { mode: 'live', invalid: raw ?? '' };
}

const cfg = typeof window !== 'undefined' ? window.__VEILLE__ : undefined;
const resolved = resolveMode(cfg?.apiMode ?? (import.meta.env.VITE_API_MODE as string | undefined));
export const apiMode: ApiMode = resolved.mode;
/** Valeur de VEILLE_API_MODE non reconnue : l'application refuse de démarrer plutôt que de deviner. */
export const invalidApiMode: string | null = resolved.invalid;
export const isMock = apiMode === 'mock';
export const dataClient: DataClient = isMock ? mockClient : httpClient(cfg?.apiBase ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? '');
