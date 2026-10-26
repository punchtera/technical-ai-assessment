import type { AiStatus } from '@fis/contracts';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { HANDLE_PATTERN, useApi, useReviewer } from '../context';
import { useResource } from '../hooks/useResource';

/** States plainly which inference backend is active — demo results must never pass as AI. */
function AiModeBanner({ status }: { status: AiStatus }) {
  if (status.mode === 'deterministic-test') {
    return (
      <div className="banner banner--demo" role="note">
        <strong>Demo mode.</strong> Recommendations come from the deterministic test provider —
        rule-based, <em>not AI</em>. The workflow, database, review rules and audit history are
        real.
      </div>
    );
  }
  if (status.mode === 'none') {
    return (
      <div className="banner banner--manual" role="note">
        <strong>AI not configured.</strong> Requests are not analysed automatically; review and
        group them manually.
      </div>
    );
  }
  return (
    <div className="banner banner--ai" role="note">
      AI recommendations by {status.models.assessment} (assessment) and {status.models.embedding}{' '}
      (embeddings). Every assignment still needs a reviewer’s approval.
    </div>
  );
}

function ReviewerHandle() {
  const { handle, setHandle, valid } = useReviewer();
  const [draft, setDraft] = useState(handle);
  const draftValid = HANDLE_PATTERN.test(draft);
  return (
    <form
      className="reviewer"
      onSubmit={(event) => {
        event.preventDefault();
        if (draftValid) setHandle(draft.trim());
      }}
    >
      <label htmlFor="reviewer-handle">Reviewer</label>
      <input
        id="reviewer-handle"
        value={draft}
        placeholder="your handle, e.g. pm.ana"
        onChange={(event) => setDraft(event.target.value)}
        aria-invalid={draft !== '' && !draftValid}
      />
      <button type="submit" className="btn btn--small" disabled={!draftValid || draft === handle}>
        Set
      </button>
      {!valid && <span className="reviewer__hint">Set a handle to review</span>}
    </form>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const api = useApi();
  const ai = useResource((signal) => {
    void signal;
    return api.getAiStatus();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/" className="brand">
            Feature Intelligence
          </NavLink>
          <nav aria-label="Main">
            <NavLink to="/" end>
              Triage queue
            </NavLink>
            <NavLink to="/submit">Submit request</NavLink>
            <NavLink to="/groups">Need groups</NavLink>
          </nav>
          <ReviewerHandle />
        </div>
      </header>
      {ai.status === 'ready' && <AiModeBanner status={ai.data} />}
      {ai.status === 'error' && (
        <div className="banner banner--error" role="alert">
          The API is not reachable ({ai.error.message}). Start it with{' '}
          <code>pnpm --filter @fis/api dev</code>.
        </div>
      )}
      <main className="shell">{children}</main>
    </div>
  );
}
