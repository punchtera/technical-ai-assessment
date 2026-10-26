import type { FeatureRequestSummary, ListRequestsQuery } from '@fis/contracts';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ProcessingBadge, ReviewStateBadge, TestProviderTag } from '../components/Badges';
import { Empty, ErrorState, Loading } from '../components/States';
import { useApi } from '../context';
import { useResource } from '../hooks/useResource';
import { ACTION_LABEL } from '../lib/status';

type View = 'pending' | 'grouped' | 'all';

const VIEWS: { id: View; label: string; query: Partial<ListRequestsQuery> }[] = [
  {
    id: 'pending',
    label: 'Awaiting decision',
    query: { reviewStatus: 'pending_review', sort: 'oldest' },
  },
  { id: 'grouped', label: 'Grouped', query: { reviewStatus: 'grouped', sort: 'newest' } },
  { id: 'all', label: 'All requests', query: { sort: 'newest' } },
];

function ProposalLine({ request }: { request: FeatureRequestSummary }) {
  if (request.group) {
    return (
      <p className="row-line">
        <span className="label">Approved group:</span>{' '}
        <Link to={`/groups/${request.group.id}`}>{request.group.title}</Link>
      </p>
    );
  }
  const proposal = request.latestProposal;
  if (!proposal) return null;
  return (
    <p className="row-line">
      <span className="label">Recommendation (not approved):</span> {ACTION_LABEL[proposal.action]}
      {proposal.groupTitle && <> → {proposal.groupTitle}</>}
      {proposal.suggestionStatus === 'rejected' && (
        <span className="badge badge--rejected">rejected</span>
      )}
      {proposal.isTestProvider && <TestProviderTag />}
    </p>
  );
}

export function QueuePage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View | null) ?? 'pending';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0]!;

  const list = useResource(
    (signal) => api.listRequests({ ...active.query, q: q || undefined, limit: 50 }, signal),
    [view, q],
    // Keep statuses fresh while anything is still being processed.
    (data) =>
      data.items.some((r) => r.processingStatus === 'queued' || r.processingStatus === 'processing')
        ? 2000
        : null,
  );

  const setView = (next: View) =>
    setParams((prev) => ({ ...Object.fromEntries(prev), view: next }));

  return (
    <div className="page">
      <div className="page__head">
        <h1>Triage queue</h1>
        <Link className="btn btn--primary" to="/submit">
          Submit request
        </Link>
      </div>

      <div className="toolbar">
        <div role="tablist" aria-label="Filter requests" className="tabs">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === view}
              className={v.id === view ? 'tab tab--active' : 'tab'}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <form
          className="search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setParams((prev) => ({ ...Object.fromEntries(prev), q: search }));
          }}
        >
          <input
            aria-label="Search requests"
            placeholder="Search title or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn btn--ghost">
            Search
          </button>
        </form>
      </div>

      {list.status === 'loading' && <Loading label="Loading requests…" />}
      {list.status === 'error' && (
        <ErrorState error={list.error} onRetry={() => void list.reload()} />
      )}
      {list.status === 'ready' && list.data.items.length === 0 && (
        <Empty>
          {view === 'pending' ? 'No requests are waiting for a decision.' : 'No requests match.'}{' '}
          <Link to="/submit">Submit a request</Link>.
        </Empty>
      )}
      {list.status === 'ready' && list.data.items.length > 0 && (
        <>
          <p className="muted">
            Showing {list.data.items.length} of {list.data.total}
          </p>
          <ul className="request-list">
            {list.data.items.map((request) => (
              <li key={request.id} className="card request-row">
                <div className="request-row__head">
                  <Link to={`/requests/${request.id}`} className="request-row__title">
                    {request.title}
                  </Link>
                  <div className="badges">
                    <ReviewStateBadge request={request} />
                    <ProcessingBadge status={request.processingStatus} />
                  </div>
                </div>
                <p className="request-row__preview">{request.descriptionPreview}</p>
                {request.extractedNeed && (
                  <p className="row-line">
                    <span className="label">Extracted need:</span> {request.extractedNeed}
                  </p>
                )}
                <ProposalLine request={request} />
                <p className="row-meta">
                  {new Date(request.createdAt).toLocaleString()} ·{' '}
                  {request.sourceChannel.replace('_', ' ')} · {request.supportCount} supporter
                  {request.supportCount === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
