import type { ApiError as ApiErrorT } from '../api/client';

interface Props {
  error: ApiErrorT | Error | null;
  invalidMode: string | null;
  lastAttempt: string | null;
  onRetry: () => void;
}

/** État d'erreur du mode « API réelle » : explicite, sans aucune donnée fictive de remplacement. */
export function ApiErrorScreen({ error, invalidMode, lastAttempt, onRetry }: Props) {
  const status = (error as ApiErrorT | null)?.status ?? null;
  const url = (error as ApiErrorT | null)?.url;
  return (
    <main id="main" className="shell" style={{ paddingTop: 24 }}>
      <section className="banner civil" role="alert" data-testid="api-error">
        <h1 style={{ fontSize: 20 }}>{invalidMode !== null ? 'Configuration invalide' : 'API injoignable — aucune donnée affichée'}</h1>
        {invalidMode !== null ? (
          <p>
            Le mode d’API « <b className="mono">{invalidMode || '(vide)'}</b> » n’est pas reconnu. Valeurs admises : <span className="mono">mock</span> ou <span className="mono">live</span>. L’application ne devine pas.
          </p>
        ) : (
          <>
            <p>{error?.message ?? 'La requête vers l’API a échoué.'}</p>
            <p>
              <b>Aucune donnée fictive n’est utilisée en remplacement</b> : en mode API réelle, un écran vide vaut mieux qu’une fausse situation.
            </p>
            <dl className="card" style={{ margin: '10px 0' }}>
              <dt>Requête</dt>
              <dd className="mono">{url ?? '/api/v1/overview'}</dd>
              <dt>Statut HTTP</dt>
              <dd>{status ?? 'aucun'}</dd>
              <dt>Dernière tentative</dt>
              <dd className="num">{lastAttempt ?? '—'}</dd>
            </dl>
            <p className="muted">Nouvelle tentative automatique toutes les 15 secondes. Vérifiez que le backend tourne et que le relais pointe vers lui (variable API_UPSTREAM).</p>
            <p style={{ marginTop: 10 }}>
              <button type="button" className="btn primary" onClick={onRetry} data-testid="api-retry">
                Réessayer maintenant
              </button>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
