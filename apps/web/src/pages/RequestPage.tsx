import type { FeatureRequestDetail, ReviewDecisionInput, TriageRunView } from '@fis/contracts';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ApiClientError } from '../api/client';
import {
  ConfidenceTag,
  ProcessingBadge,
  ReviewStateBadge,
  TestProviderTag,
} from '../components/Badges';
import { EvidenceList, HighlightedText } from '../components/Evidence';
import { HistoryTimeline } from '../components/HistoryTimeline';
import { Empty, ErrorState, Feedback, Loading } from '../components/States';
import { useApi, useReviewer } from '../context';
import { useResource } from '../hooks/useResource';
import { ACTION_LABEL, ERROR_LABEL, FLAG_LABEL } from '../lib/status';

type Outcome = { kind: 'success' | 'error'; message: string } | null;

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="card section" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
      {children}
    </section>
  );
}

/** Two-step button: the first click asks for confirmation, so nothing changes by accident. */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  variant = 'primary',
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <button
        type="button"
        className={`btn btn--${variant}`}
        disabled={disabled || busy}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm">
      <button
        type="button"
        className={`btn btn--${variant}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {busy ? 'Saving…' : confirmLabel}
      </button>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={busy}
        onClick={() => setArmed(false)}
      >
        Cancel
      </button>
    </span>
  );
}

function ExtractedNeed({ run, request }: { run: TriageRunView; request: FeatureRequestDetail }) {
  const ex = run.extraction;
  if (!ex) return <p className="muted">No extraction available for this run.</p>;
  return (
    <div className="need">
      <p className="need__statement">{ex.needStatement}</p>
      <dl className="facts">
        <dt>Proposed solution</dt>
        <dd>{ex.proposedSolution ?? <span className="muted">none stated</span>}</dd>
        <dt>Affected users</dt>
        <dd>{ex.affectedUsers ?? <span className="muted">not stated</span>}</dd>
        <dt>Clarity</dt>
        <dd>{ex.clarity.replace('_', ' ')}</dd>
        {ex.ambiguityNote && (
          <>
            <dt>Ambiguity</dt>
            <dd>{ex.ambiguityNote}</dd>
          </>
        )}
      </dl>
      <h3>Supporting quotations</h3>
      <EvidenceList items={ex.evidence} emptyText="No quotations returned." />
      {ex.contextDetails.length > 0 && (
        <>
          <h3>Context stated in the request</h3>
          <ul className="plain">
            {ex.contextDetails.map((c, i) => (
              <li key={i}>
                {c.detail} — “{c.evidence.quote}”{' '}
                {!c.evidence.valid && (
                  <span className="badge badge--failed">quote not verified</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {request.redactionSummary.email + request.redactionSummary.phone > 0 && (
        <p className="muted small">
          Quotations refer to the privacy-masked copy sent for analysis (
          {request.redactionSummary.email} email, {request.redactionSummary.phone} phone masked).
        </p>
      )}
    </div>
  );
}

export function RequestPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const reviewer = useReviewer();
  const [outcome, setOutcome] = useState<Outcome>(null);

  const detail = useResource(
    (signal) => api.getRequest(id, signal),
    [id],
    (data) =>
      data.processingStatus === 'queued' || data.processingStatus === 'processing' ? 1500 : null,
  );
  const history = useResource((signal) => api.getHistory(id, signal), [id]);
  const ai = useResource(() => api.getAiStatus(), []);
  const groups = useResource((signal) => api.listGroups({ limit: 100 }, signal), [id]);
  const location = useLocation();
  const historyReady = history.status === 'ready';
  useEffect(() => {
    // Support deep links such as /requests/:id#history from the group page.
    if (historyReady && location.hash === '#history')
      document.getElementById('history')?.scrollIntoView();
  }, [historyReady, location.hash]);

  async function mutate(action: () => Promise<unknown>, success: string) {
    setOutcome(null);
    try {
      await action();
      setOutcome({ kind: 'success', message: success });
    } catch (error) {
      setOutcome({
        kind: 'error',
        message: error instanceof ApiClientError ? error.message : 'The action failed.',
      });
    } finally {
      // Always refresh from the server: it is the source of truth after any attempt.
      await Promise.all([detail.reload(), history.reload(), groups.reload()]);
    }
  }

  if (detail.status === 'loading') return <Loading label="Loading request…" />;
  if (detail.status === 'error' && !detail.data)
    return <ErrorState error={detail.error} onRetry={() => void detail.reload()} />;
  const request = detail.data!;
  const run = request.latestTriage;
  const pending = request.reviewStatus === 'pending_review';
  const canAct = reviewer.valid;
  const proposal = run?.proposal ?? null;
  const proposedGroupId = proposal?.groupId ?? null;
  const proposedGroup = run?.candidates.find((c) => c.groupId === proposedGroupId);
  const suggestionOpen = run?.status === 'succeeded' && run.suggestionStatus === 'open';
  const aiConfigured = ai.status === 'ready' && ai.data.mode !== 'none';
  const canRetry =
    pending &&
    aiConfigured &&
    (request.processingStatus === 'failed' || request.processingStatus === 'completed');

  const decide = (decision: ReviewDecisionInput, message: string) =>
    mutate(
      () =>
        api.decide(request.id, { ...decision, expectedVersion: request.version }, reviewer.handle),
      message,
    );

  const verifiedQuotes = [...(run?.extraction?.evidence ?? []), ...(proposal?.evidence ?? [])]
    .filter((e) => e.valid && e.source.kind === 'request')
    .map((e) => e.quote);

  return (
    <div className="page">
      <p className="crumbs">
        <Link to="/">Triage queue</Link> / request
      </p>
      <div className="page__head">
        <h1>{request.title}</h1>
        <div className="badges">
          <ReviewStateBadge request={request} />
          <ProcessingBadge status={request.processingStatus} />
        </div>
      </div>

      {outcome && <Feedback kind={outcome.kind}>{outcome.message}</Feedback>}
      {!canAct && pending && (
        <Feedback kind="error">
          Set your reviewer handle in the header to record decisions. Decisions are attributed to
          it.
        </Feedback>
      )}

      <div className="grid">
        <div className="grid__main">
          <Section title="Original request">
            <HighlightedText text={request.description} quotes={verifiedQuotes} />
            <p className="row-meta">
              Submitted {new Date(request.createdAt).toLocaleString()} via{' '}
              {request.sourceChannel.replace('_', ' ')} · {request.supportCount} supporter
              {request.supportCount === 1 ? '' : 's'}
            </p>
          </Section>

          <Section title="Underlying need">
            {!run && request.processingStatus === 'not_configured' && (
              <p className="muted">AI analysis is not configured. Review this request manually.</p>
            )}
            {!run &&
              (request.processingStatus === 'queued' ||
                request.processingStatus === 'processing') && (
                <p role="status">The triage pipeline is analysing this request — no result yet.</p>
              )}
            {run && run.status === 'running' && (
              <p role="status">Triage attempt {run.attempt} is running…</p>
            )}
            {run && run.status === 'failed' && (
              <Feedback kind="error">
                Attempt {run.attempt} failed during {run.errorStage}:{' '}
                {ERROR_LABEL[run.errorCode ?? ''] ?? run.errorCode}. The request can still be
                reviewed manually{aiConfigured ? ' or processing can be retried' : ''}.
              </Feedback>
            )}
            {run && run.status === 'succeeded' && (
              <>
                <p className="provenance">
                  {run.isTestProvider ? (
                    <TestProviderTag />
                  ) : (
                    <span className="badge">AI · {run.models.extraction}</span>
                  )}{' '}
                  attempt {run.attempt}
                </p>
                <ExtractedNeed run={run} request={request} />
              </>
            )}
          </Section>

          {run && run.status === 'succeeded' && proposal && (
            <Section title="Recommendation">
              <p className="recommendation">
                <span className="label">Proposed (not approved):</span>{' '}
                <strong>{ACTION_LABEL[proposal.action]}</strong>
                {proposedGroupId && (
                  <>
                    {' '}
                    →{' '}
                    <Link to={`/groups/${proposedGroupId}`}>{proposedGroup?.title ?? 'group'}</Link>
                  </>
                )}{' '}
                <ConfidenceTag confidence={proposal.confidence} />{' '}
                {run.isTestProvider && <TestProviderTag />}
                <span className={`badge badge--sugg-${run.suggestionStatus}`}>
                  suggestion {run.suggestionStatus}
                </span>
              </p>
              <p className="rationale">{proposal.rationale}</p>
              {proposal.flags.length > 0 && (
                <ul className="flags" aria-label="Uncertainty and review flags">
                  {proposal.flags.map((flag) => (
                    <li key={flag}>⚠ {FLAG_LABEL[flag] ?? flag}</li>
                  ))}
                </ul>
              )}
              <h3>Evidence for the match</h3>
              <EvidenceList
                items={proposal.evidence}
                emptyText="No match evidence (no candidate was selected)."
              />
            </Section>
          )}

          {run && run.status === 'succeeded' && (
            <Section title={`Candidate groups (${run.candidates.length})`}>
              {run.candidates.length === 0 ? (
                <p className="muted">No approved group was similar enough to compare against.</p>
              ) : (
                <ul className="candidates">
                  {run.candidates.map((c) => (
                    <li
                      key={c.groupId}
                      className={
                        c.groupId === proposedGroupId
                          ? 'candidate candidate--proposed'
                          : 'candidate'
                      }
                    >
                      <div className="candidate__head">
                        <Link to={`/groups/${c.groupId}`}>{c.title}</Link>
                        <span className="muted small">
                          similarity {c.similarity.toFixed(2)} (retrieval score, not a probability)
                        </span>
                        {c.relation && (
                          <span className={`badge badge--rel-${c.relation}`}>
                            {c.relation.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      <p className="small">{c.needStatement}</p>
                      {(c.similarities || c.differences) && (
                        <p className="small">
                          {c.similarities && <>Similar: {c.similarities}. </>}
                          {c.differences && <>Different: {c.differences}.</>}
                        </p>
                      )}
                      <p className="small muted">
                        Closest approved members:{' '}
                        {c.members.map((m, i) => (
                          <span key={m.requestId}>
                            {i > 0 && ', '}
                            <Link to={`/requests/${m.requestId}`}>{m.title}</Link>
                          </span>
                        ))}
                      </p>
                      {pending && c.groupId !== proposedGroupId && (
                        <ConfirmButton
                          variant="ghost"
                          label="Link to this group instead"
                          confirmLabel={`Confirm: link to “${c.title}”`}
                          disabled={!canAct}
                          onConfirm={() =>
                            decide(
                              { action: 'link', groupId: c.groupId, triageRunId: run.id },
                              `Linked to “${c.title}”.`,
                            )
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="History" id="history">
            {history.status === 'loading' && <Loading />}
            {history.status === 'error' && (
              <ErrorState error={history.error} onRetry={() => void history.reload()} />
            )}
            {history.data && <HistoryTimeline history={history.data} />}
          </Section>
        </div>

        <aside className="grid__side">
          <Section title="Decision">
            {request.activeMembership ? (
              <>
                <p>
                  <span className="label">Approved group:</span>{' '}
                  <Link to={`/groups/${request.activeMembership.groupId}`}>
                    {request.activeMembership.groupTitle}
                  </Link>
                </p>
                <p className="small muted">
                  Approved by {request.activeMembership.approvedBy} on{' '}
                  {new Date(request.activeMembership.approvedAt).toLocaleString()}
                </p>
                <ReverseForm
                  disabled={!canAct}
                  onReverse={(reason) =>
                    mutate(
                      () =>
                        api.reverseMembership(
                          request.activeMembership!.id,
                          reason,
                          reviewer.handle,
                        ),
                      'Assignment reversed. The request is back in the queue.',
                    )
                  }
                />
              </>
            ) : (
              <div className="actions">
                {suggestionOpen && proposedGroupId && (
                  <ConfirmButton
                    label={`Approve: link to “${proposedGroup?.title ?? 'proposed group'}”`}
                    confirmLabel="Confirm approval"
                    disabled={!canAct}
                    onConfirm={() =>
                      decide(
                        { action: 'link', groupId: proposedGroupId, triageRunId: run!.id },
                        'Approved. The request is now in the group.',
                      )
                    }
                  />
                )}
                {suggestionOpen && (
                  <RejectForm
                    disabled={!canAct}
                    onReject={(note) =>
                      decide(
                        {
                          action: 'reject_suggestion',
                          triageRunId: run!.id,
                          note: note || undefined,
                        },
                        'Recommendation rejected. No group was assigned.',
                      )
                    }
                  />
                )}
                <CreateGroupForm
                  disabled={!canAct}
                  defaultTitle={request.title}
                  defaultNeed={run?.extraction?.needStatement ?? ''}
                  prefilledFromRun={!!run?.extraction}
                  onCreate={(title, needStatement) =>
                    decide(
                      {
                        action: 'create_group',
                        title,
                        needStatement,
                        triageRunId: run?.status === 'succeeded' ? run.id : undefined,
                      },
                      `Group “${title}” created with this request as its first member.`,
                    )
                  }
                />
                {groups.data && groups.data.items.length > 0 && (
                  <LinkExistingForm
                    disabled={!canAct}
                    groups={groups.data.items.map((g) => ({ id: g.id, title: g.title }))}
                    onLink={(groupId, title) =>
                      decide(
                        {
                          action: 'link',
                          groupId,
                          triageRunId: run?.status === 'succeeded' ? run.id : undefined,
                        },
                        `Linked to “${title}”.`,
                      )
                    }
                  />
                )}
                {canRetry && (
                  <ConfirmButton
                    variant="ghost"
                    label="Retry automatic analysis"
                    confirmLabel="Confirm retry"
                    disabled={!canAct}
                    onConfirm={() =>
                      mutate(
                        () => api.retryTriage(request.id, reviewer.handle),
                        'Processing re-queued.',
                      )
                    }
                  />
                )}
              </div>
            )}
          </Section>

          <SupportBox
            count={request.supportCount}
            onSupport={(ref) => mutate(() => api.addSupport(request.id, ref), 'Support recorded.')}
          />

          {run && (
            <Section title="Run details">
              <dl className="facts small">
                <dt>Provider</dt>
                <dd>
                  {run.provider} {run.isTestProvider && <TestProviderTag />}
                </dd>
                <dt>Models</dt>
                <dd>
                  {[run.models.extraction, run.models.assessment, run.models.embedding]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </dd>
                <dt>Versions</dt>
                <dd>
                  {run.pipelineVersion} · {run.promptVersion}
                </dd>
                <dt>Status</dt>
                <dd>
                  {run.status} (attempt {run.attempt})
                </dd>
              </dl>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

function RejectForm({
  onReject,
  disabled,
}: {
  onReject: (note: string) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="btn btn--danger"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Reject recommendation
      </button>
    );
  return (
    <form
      className="subform"
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        await onReject(note.trim());
        setBusy(false);
        setOpen(false);
      }}
    >
      <label htmlFor="reject-note">Why is this wrong? (optional)</label>
      <textarea
        id="reject-note"
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="subform__actions">
        <button type="submit" className="btn btn--danger" disabled={busy}>
          {busy ? 'Saving…' : 'Confirm rejection'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreateGroupForm({
  onCreate,
  disabled,
  defaultTitle,
  defaultNeed,
  prefilledFromRun,
}: {
  onCreate: (title: string, needStatement: string) => Promise<void>;
  disabled: boolean;
  defaultTitle: string;
  defaultNeed: string;
  prefilledFromRun: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [need, setNeed] = useState(defaultNeed);
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length >= 3 && need.trim().length >= 10;
  if (!open)
    return (
      <button
        type="button"
        className="btn btn--ghost"
        disabled={disabled}
        onClick={() => {
          // Prefill from the latest data at the moment the form opens.
          setTitle(defaultTitle);
          setNeed(defaultNeed);
          setOpen(true);
        }}
      >
        Create new group…
      </button>
    );
  return (
    <form
      className="subform"
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        if (!valid) return;
        setBusy(true);
        await onCreate(title.trim(), need.trim());
        setBusy(false);
        setOpen(false);
      }}
    >
      <label htmlFor="group-title">Group title</label>
      <input
        id="group-title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor="group-need">Underlying need</label>
      <textarea
        id="group-need"
        rows={3}
        maxLength={1000}
        value={need}
        onChange={(e) => setNeed(e.target.value)}
      />
      {prefilledFromRun && (
        <p className="small muted">Prefilled from the extracted need — edit it before saving.</p>
      )}
      {!valid && (
        <p className="field-error">Title needs 3+ characters and the need 10+ characters.</p>
      )}
      <div className="subform__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !valid}>
          {busy ? 'Saving…' : 'Create group and assign request'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function LinkExistingForm({
  groups,
  onLink,
  disabled,
}: {
  groups: { id: string; title: string }[];
  onLink: (groupId: string, title: string) => Promise<void>;
  disabled: boolean;
}) {
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = groups.find((g) => g.id === groupId);
  return (
    <form
      className="subform subform--inline"
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        if (!chosen) return;
        setBusy(true);
        await onLink(chosen.id, chosen.title);
        setBusy(false);
      }}
    >
      <label htmlFor="link-group">Or link to any existing group</label>
      <select
        id="link-group"
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
        disabled={disabled}
      >
        <option value="">Choose a group…</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn--ghost" disabled={disabled || busy || !chosen}>
        {busy ? 'Saving…' : 'Link'}
      </button>
    </form>
  );
}

function ReverseForm({
  onReverse,
  disabled,
}: {
  onReverse: (reason: string) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="btn btn--danger"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Reverse assignment…
      </button>
    );
  return (
    <form
      className="subform"
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        if (reason.trim().length < 3) return;
        setBusy(true);
        await onReverse(reason.trim());
        setBusy(false);
        setOpen(false);
      }}
    >
      <label htmlFor="reverse-reason">Reason (kept in the audit history)</label>
      <textarea
        id="reverse-reason"
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="subform__actions">
        <button
          type="submit"
          className="btn btn--danger"
          disabled={busy || reason.trim().length < 3}
        >
          {busy ? 'Saving…' : 'Confirm reversal'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SupportBox({
  count,
  onSupport,
}: {
  count: number;
  onSupport: (ref: string) => Promise<void>;
}) {
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(ref);
  return (
    <Section title="Interest">
      <p>
        {count} supporter{count === 1 ? '' : 's'}
      </p>
      <form
        className="subform subform--inline"
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          if (!valid) return;
          setBusy(true);
          await onSupport(ref);
          setBusy(false);
          setRef('');
        }}
      >
        <label htmlFor="supporter">Add support as</label>
        <input
          id="supporter"
          placeholder="handle, e.g. cs.lee"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <button type="submit" className="btn btn--ghost" disabled={!valid || busy}>
          +1
        </button>
      </form>
    </Section>
  );
}

export function NotFoundPage() {
  return (
    <Empty>
      Page not found. <Link to="/">Back to the triage queue</Link>.
    </Empty>
  );
}
