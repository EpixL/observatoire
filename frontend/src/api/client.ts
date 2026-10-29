import type { NotificationSettings, StreamMessage, Snapshot, ThresholdsState } from '../types';
import { buildSnapshot } from '../mocks/scenarios';
import { NOW } from '../mocks/events';
import { applyChanges, modifiedItems } from '../lib/thresholds';

/**
 * Seule porte d'entrée des données du dashboard.
 * Aujourd'hui : maquette (données fictives locales). Plus tard : même interface, branchée sur l'API REST + SSE
 * décrite dans docs/api-contract.md — aucun composant n'a besoin de changer.
 */
export interface DataClient {
  load(scenario?: string): Promise<Snapshot>;
  /** Abonnement temps réel (SSE). Retourne la fonction de désabonnement. */
  subscribe(onMessage: (m: StreamMessage) => void, onState: (connected: boolean) => void): () => void;
  /** PUT /api/v1/thresholds — garde-fous aussi côté serveur ; crée une NOUVELLE version, ne supprime rien. */
  saveThresholds(current: ThresholdsState, changes: { key: string; to: number }[], reason: string): Promise<ThresholdsState>;
  /** POST /api/v1/thresholds/reset — un changement daté de plus, historique conservé. */
  resetThresholds(current: ThresholdsState, reason: string): Promise<ThresholdsState>;
  /** PUT /api/v1/settings/notifications */
  saveNotifications(n: NotificationSettings): Promise<NotificationSettings>;
}

/** Maquette : date « simulée » = horloge figée + 1 min par changement (captures et tests déterministes). */
const mockAt = (n: number) => new Date(Date.parse(NOW) + n * 60_000).toISOString().replace('.000Z', 'Z');

export const mockClient: DataClient = {
  async load(scenario = 'nominal') {
    return buildSnapshot(scenario);
  },
  subscribe(_onMessage, onState) {
    // Maquette : aucun flux. On signale simplement « hors ligne / maquette ».
    onState(false);
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

async function send<T>(url: string, method: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return (await r.json()) as T;
}

/** Client réel — inactif tant que VITE_API_BASE est vide. Même origine uniquement (pas de requête externe). */
export function httpClient(base: string): DataClient {
  return {
    async load() {
      const r = await fetch(`${base}/api/v1/overview?territory=FR`, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`API ${r.status}`);
      return (await r.json()) as Snapshot;
    },
    subscribe(onMessage, onState) {
      const es = new EventSource(`${base}/api/v1/stream`);
      es.onopen = () => onState(true);
      es.onerror = () => onState(false);
      es.onmessage = (e) => onMessage(JSON.parse(e.data) as StreamMessage);
      return () => es.close();
    },
    async saveThresholds(cur, changes, reason) {
      return send(`${base}/api/v1/thresholds`, 'PUT', { changes, reason, confirmed: true, expected_policy_version: cur.policy_version });
    },
    async resetThresholds(cur, reason) {
      return send(`${base}/api/v1/thresholds/reset`, 'POST', { reason, confirmed: true, expected_policy_version: cur.policy_version });
    },
    async saveNotifications(n) {
      return send(`${base}/api/v1/settings/notifications`, 'PUT', { enabled: n.enabled, level: n.level });
    },
  };
}

const apiBase = import.meta.env.VITE_API_BASE as string | undefined;
export const dataClient: DataClient = apiBase ? httpClient(apiBase) : mockClient;
export const isMock = !apiBase;
