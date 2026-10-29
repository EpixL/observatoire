import type { StreamMessage, Snapshot } from '../types';
import { buildSnapshot } from '../mocks/scenarios';

/**
 * Seule porte d'entrée des données du dashboard.
 * Aujourd'hui : maquette (données fictives locales). Plus tard : même interface, branchée sur l'API REST + SSE
 * décrite dans docs/api-contract.md — aucun composant n'a besoin de changer.
 */
export interface DataClient {
  load(scenario?: string): Promise<Snapshot>;
  /** Abonnement temps réel (SSE). Retourne la fonction de désabonnement. */
  subscribe(onMessage: (m: StreamMessage) => void, onState: (connected: boolean) => void): () => void;
}

export const mockClient: DataClient = {
  async load(scenario = 'nominal') {
    return buildSnapshot(scenario);
  },
  subscribe(_onMessage, onState) {
    // Maquette : aucun flux. On signale simplement « hors ligne / maquette ».
    onState(false);
    return () => {};
  },
};

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
  };
}

const apiBase = import.meta.env.VITE_API_BASE as string | undefined;
export const dataClient: DataClient = apiBase ? httpClient(apiBase) : mockClient;
export const isMock = !apiBase;
