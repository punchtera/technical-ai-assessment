import type { HealthResponse } from '@fis/contracts';
import { useEffect, useState } from 'react';
import { ApiClientError, type ApiClient } from './api/client';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'loaded'; health: HealthResponse }
  | { kind: 'error'; message: string };

/**
 * Step 1 shell: confirms the web app can reach the API through the typed
 * client. The triage workflow screens are added in step 3.
 */
export function App({ api }: { api: ApiClient }) {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api
      .getHealth()
      .then((health) => !cancelled && setState({ kind: 'loaded', health }))
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiClientError ? error.message : 'Unexpected error';
        setState({ kind: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <main className="shell">
      <header>
        <h1>Feature Intelligence</h1>
        <p className="muted">
          AI-assisted feature-request triage. Every group assignment is approved by a person.
        </p>
      </header>

      <section aria-live="polite" className="panel">
        <h2>System status</h2>
        {state.kind === 'loading' && <p>Checking the API…</p>}
        {state.kind === 'error' && (
          <p className="status status--error">API unavailable: {state.message}</p>
        )}
        {state.kind === 'loaded' && (
          <dl className="status-list">
            <dt>API</dt>
            <dd className={`status status--${state.health.status}`}>{state.health.status}</dd>
            <dt>Database</dt>
            <dd>{state.health.checks.database}</dd>
            <dt>pgvector</dt>
            <dd>{state.health.checks.pgvector}</dd>
            <dt>Version</dt>
            <dd>{state.health.version}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
