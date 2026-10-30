import type { z } from 'zod';
import type { NotificationSettings, Snapshot, StreamMessage, ThresholdsState } from '../types';
import {
  ApiErrorBodySchema,
  GaugeDetailSchema,
  GaugeHistorySchema,
  GaugeStateSchema,
  DossierScenarioSchema,
  ReviewItemSchema,
  SnapshotSchema,
  SourceRecordSchema,
  StreamMessageSchema,
  TerritorySchema,
  ThresholdsStateSchema,
  VeilleEventSchema,
} from '../schema';
import { z as zod } from 'zod';
import { composeSnapshot } from '../lib/compose';
import { normalizeSnapshot } from '../lib/normalize';
import { buildSnapshot } from '../mocks/scenarios';
import { NOW } from '../mocks/events';
import { applyChanges, modifiedItems } from '../lib/thresholds';

/**
 * Seule porte d'entrée des données du dashboard.
 *  - mode `mock` (défaut) : données fictives locales, aucune requête réseau ;
 *  - mode `live` : API REST + SSE de la même origine (le reverse proxy relaie /api vers le backend).
 * En mode live, une API injoignable donne une erreur explicite : JAMAIS un retour silencieux aux données fictives.
 */
export interface LoadOptions {
  /** Territoire évalué (`FR`, `flanc-est`) : absent = territoire par défaut du serveur. Ne dépend JAMAIS de la caméra de la carte. */
  territory?: string;
  /** Maquette seulement : scénario de démonstration. */
  scenario?: string;
}

export interface DataClient {
  load(opts?: LoadOptions): Promise<Snapshot>;
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
    /** code du corps d'erreur du backend (`writes_disabled`, `stale_policy_version`, `not_evaluated`…). */
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** Maquette : date « simulée » = horloge figée + 1 min par changement (captures et tests déterministes). */
const mockAt = (n: number) => new Date(Date.parse(NOW) + n * 60_000).toISOString().replace('.000Z', 'Z');

export const mockClient: DataClient = {
  async load({ scenario = 'nominal', territory }: LoadOptions = {}) {
    // même chemin que l'API réelle : normalisation d'affichage appliquée aux fixtures
    return normalizeSnapshot(buildSnapshot(scenario, territory));
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

/** Messages lisibles pour les codes d'erreur du backend (docs/api-contract-backend-proposal.md). */
const ERROR_HINT: Record<string, string> = {
  writes_disabled: 'Les écritures sont désactivées côté serveur (aucun ADMIN_TOKEN configuré).',
  unauthorized: 'Jeton d’administration absent ou invalide : le relais ne fournit pas (encore) d’authentification pour les écritures.',
  stale_policy_version: 'Les seuils ont changé entre-temps : rechargez la page avant de modifier.',
  locked: 'Seuils gelés pendant le pilote : écriture refusée par le serveur.',
};

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch {
    throw new ApiError('Aucune réponse du serveur (réseau coupé, API arrêtée ou relais mal configuré).', url, null);
  }
  let body: unknown = null;
  let text = '';
  try {
    text = await r.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = undefined; // pas du JSON
  }
  if (!r.ok) {
    const e = ApiErrorBodySchema.safeParse(body);
    if (e.success) throw new ApiError(ERROR_HINT[e.data.error.code] ?? e.data.error.message, url, r.status, e.data.error.code);
    const detail = r.status === 502 || r.status === 503 || r.status === 504 ? 'L’API ne répond pas derrière le relais.' : 'Réponse inattendue du serveur.';
    throw new ApiError(`${detail} (HTTP ${r.status})`, url, r.status);
  }
  if (body === undefined) throw new ApiError('Réponse illisible : ce n’est pas du JSON (le relais renvoie peut-être la page d’accueil au lieu de l’API).', url, r.status);
  return body;
}

/** Valide la réponse contre le contrat : une dérive devient une erreur lisible (chemin du champ fautif), jamais un affichage faux. */
async function call<S extends z.ZodType>(url: string, schema: S, init?: RequestInit): Promise<z.infer<S>> {
  const body = await request(url, init);
  const r = schema.safeParse(body);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new ApiError(`Réponse non conforme au contrat : ${issue.path.join('.') || '(racine)'} — ${issue.message}`, url, 200, 'contract_mismatch');
  }
  return r.data;
}

/** Client réel : même origine uniquement (base vide) ; pas de requête vers un domaine externe. Les noms de routes et les formes sont ceux du backend. */
export function httpClient(base: string): DataClient {
  const u = (path: string) => `${base}/api/v1${path}`;
  /** Route dont le backend répond `404 not_evaluated` tant que la jauge n'est pas calculée : état explicite, pas une panne. */
  const unlessNotEvaluated = async <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> => {
    try {
      return await call(u(path), schema);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_evaluated') return null;
      throw e;
    }
  };
  return {
    async load({ territory } = {}) {
      const territories = await call(u('/territories'), zod.array(TerritorySchema));
      const tid = territory ?? territories.find((t) => t.default)?.id ?? territories[0]?.id ?? 'FR';
      const q = `territory=${encodeURIComponent(tid)}`;
      const [gauge, detail, dossiers, history, events, sources, thresholds, reviews] = await Promise.all([
        unlessNotEvaluated(`/gauge?${q}`, GaugeStateSchema),
        unlessNotEvaluated(`/gauge/detail?${q}`, GaugeDetailSchema),
        unlessNotEvaluated(`/dossiers?${q}`, zod.array(DossierScenarioSchema)),
        call(u(`/gauge/history?${q}&days=30`), GaugeHistorySchema),
        call(u(`/events?${q}&include_excluded=true&limit=500`), zod.array(VeilleEventSchema)),
        call(u('/sources/status'), zod.array(SourceRecordSchema)),
        call(u('/thresholds'), ThresholdsStateSchema),
        call(u('/reviews?status=open'), zod.array(ReviewItemSchema)),
      ]);
      const snap = composeSnapshot({ territories, gauge, detail, history, dossiers: dossiers ?? [], events, sources, thresholds, reviews, territoryId: tid, now: new Date().toISOString() });
      const checked = SnapshotSchema.safeParse(snap);
      if (!checked.success) throw new ApiError(`Instantané composé non conforme : ${checked.error.issues[0].path.join('.')} — ${checked.error.issues[0].message}`, u('/gauge'), 200, 'contract_mismatch');
      return snap;
    },
    subscribe(onMessage, onState) {
      const es = new EventSource(u('/stream'));
      es.onopen = () => onState(true);
      es.onerror = () => onState(false);
      es.onmessage = (e) => {
        try {
          const m = StreamMessageSchema.safeParse(JSON.parse(e.data));
          if (m.success) onMessage(m.data as StreamMessage);
        } catch {
          /* message illisible : ignoré, la prochaine actualisation remettra l'état d'aplomb */
        }
      };
      return () => es.close();
    },
    saveThresholds: (cur, changes, reason) =>
      call(u('/thresholds'), ThresholdsStateSchema, { method: 'PUT', body: JSON.stringify({ changes, reason, confirmed: true, expected_policy_version: cur.policy_version }) }),
    resetThresholds: (cur, reason) =>
      call(u('/thresholds/reset'), ThresholdsStateSchema, { method: 'POST', body: JSON.stringify({ reason, confirmed: true, expected_policy_version: cur.policy_version }) }),
    async saveNotifications() {
      throw new ApiError('Réglage des notifications non disponible côté serveur (lot 7).', u('/settings/notifications'), null, 'not_implemented');
    },
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
