import type { ReactNode } from 'react';
import type { ApiClientError } from '../api/client';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="state state--loading" role="status">
      {label}
    </p>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiClientError; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p>
        <strong>Something went wrong.</strong> {error.message}
        {error.status ? ` (HTTP ${error.status})` : ''}
      </p>
      {onRetry && (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state state--empty">{children}</div>;
}

/** Inline result of a mutation. */
export function Feedback({ kind, children }: { kind: 'success' | 'error'; children: ReactNode }) {
  return (
    <div className={`feedback feedback--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
