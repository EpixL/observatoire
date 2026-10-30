import type { Snapshot, StreamMessage } from '../types';

/** Applique un message SSE à l'état affiché. `snapshot` remplace tout ; les autres ne touchent que leur objet. */
export function applyStream(s: Snapshot, m: StreamMessage): Snapshot {
  switch (m.type) {
    case 'snapshot':
      return m.data;
    case 'event.upserted': {
      const has = s.events.some((e) => e.id === m.data.id);
      return { ...s, events: has ? s.events.map((e) => (e.id === m.data.id ? m.data : e)) : [...s.events, m.data] };
    }
    case 'source.health': {
      const has = s.sources.some((x) => x.id === m.data.id);
      return { ...s, sources: has ? s.sources.map((x) => (x.id === m.data.id ? m.data : x)) : [...s.sources, m.data] };
    }
    case 'gauge.updated':
      return { ...s, gauge: m.data };
  }
}
