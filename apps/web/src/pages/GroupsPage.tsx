import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Empty, ErrorState, Loading } from '../components/States';
import { useApi } from '../context';
import { useResource } from '../hooks/useResource';

export function GroupsPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const groups = useResource(
    (signal) => api.listGroups({ q: q || undefined, limit: 100 }, signal),
    [q],
  );

  return (
    <div className="page">
      <h1>Need groups</h1>
      <p className="muted">
        Each group is an underlying need approved by a reviewer. Only approved memberships count
        here — pending recommendations are not members. Groups are ordered by distinct supporters
        across their requests.
      </p>
      <form
        className="search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setParams(search ? { q: search } : {});
        }}
      >
        <input
          aria-label="Search groups"
          placeholder="Search groups"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="btn btn--ghost">
          Search
        </button>
      </form>

      {groups.status === 'loading' && <Loading label="Loading groups…" />}
      {groups.status === 'error' && (
        <ErrorState error={groups.error} onRetry={() => void groups.reload()} />
      )}
      {groups.status === 'ready' && groups.data.items.length === 0 && (
        <Empty>
          No groups yet. Groups are created when a reviewer decides a request expresses a new need.
        </Empty>
      )}
      {groups.status === 'ready' && groups.data.items.length > 0 && (
        <ul className="group-list">
          {groups.data.items.map((g) => (
            <li key={g.id} className="card group-row">
              <Link to={`/groups/${g.id}`} className="request-row__title">
                {g.title}
              </Link>
              <p>{g.needStatement}</p>
              <p className="row-meta">
                {g.memberCount} approved request{g.memberCount === 1 ? '' : 's'} ·{' '}
                {g.supporterCount} distinct supporter
                {g.supporterCount === 1 ? '' : 's'} · created by {g.createdBy}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GroupPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const group = useResource((signal) => api.getGroup(id, signal), [id]);

  if (group.status === 'loading') return <Loading label="Loading group…" />;
  if (group.status === 'error')
    return <ErrorState error={group.error} onRetry={() => void group.reload()} />;
  const g = group.data;

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/groups">Need groups</Link> / group
      </p>
      <h1>{g.title}</h1>
      <section className="card section">
        <h2>Underlying need</h2>
        <p className="need__statement">{g.needStatement}</p>
        <p className="row-meta">
          {g.memberCount} approved request{g.memberCount === 1 ? '' : 's'} · {g.supporterCount}{' '}
          distinct supporter
          {g.supporterCount === 1 ? '' : 's'} · created by {g.createdBy} on{' '}
          {new Date(g.createdAt).toLocaleString()}
        </p>
      </section>

      <section className="card section">
        <h2>Approved member requests</h2>
        {g.members.length === 0 ? (
          <p className="muted">
            No active members — every assignment to this group has been reversed.
          </p>
        ) : (
          <ul className="request-list">
            {g.members.map((m) => (
              <li key={m.membershipId} className="member">
                <div className="request-row__head">
                  <Link to={`/requests/${m.requestId}`} className="request-row__title">
                    {m.title}
                  </Link>
                  <span className="badge badge--approved">approved member</span>
                </div>
                <p className="source-text">{m.description}</p>
                <p className="row-meta">
                  Approved by {m.approvedBy} on {new Date(m.approvedAt).toLocaleString()} ·{' '}
                  {m.sourceChannel.replace('_', ' ')} · {m.supportCount} supporter
                  {m.supportCount === 1 ? '' : 's'} ·{' '}
                  <Link to={`/requests/${m.requestId}#history`}>history</Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
