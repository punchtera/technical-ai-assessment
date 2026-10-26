import {
  CreateFeatureRequestSchema,
  REQUEST_LIMITS,
  SourceChannelSchema,
  type FeatureRequestDetail,
} from '@fis/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiClientError } from '../api/client';
import { ProcessingBadge } from '../components/Badges';
import { Feedback } from '../components/States';
import { useApi } from '../context';
import { useResource } from '../hooks/useResource';

type FieldErrors = Partial<Record<'title' | 'description' | 'sourceChannel' | 'form', string>>;

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `web-${crypto.randomUUID()}`
    : `web-${Date.now()}-${Math.random()}`;

/** Live status of the request that was just submitted (polls while queued/processing). */
function SubmittedStatus({ request }: { request: FeatureRequestDetail }) {
  const api = useApi();
  const live = useResource(
    (signal) => api.getRequest(request.id, signal),
    [request.id],
    (data) =>
      data.processingStatus === 'queued' || data.processingStatus === 'processing' ? 1500 : null,
  );
  const current = live.data ?? request;
  const proc = current.processingStatus;
  return (
    <Feedback kind="success">
      <p>
        <strong>Request received.</strong> “{current.title}” is saved and visible in the triage
        queue.
      </p>
      <p>
        Processing: <ProcessingBadge status={proc} />{' '}
        {proc === 'queued' || proc === 'processing'
          ? 'The triage pipeline is analysing it — no recommendation exists yet.'
          : proc === 'completed'
            ? 'A recommendation is ready for a reviewer. Nothing is grouped until a reviewer approves it.'
            : proc === 'failed'
              ? 'Automatic analysis failed. A reviewer can retry it or group the request manually.'
              : 'AI analysis is not configured. A reviewer will group it manually.'}
      </p>
      <Link className="btn" to={`/requests/${current.id}`}>
        Open request
      </Link>
    </Feedback>
  );
}

export function SubmitPage() {
  const api = useApi();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceChannel, setSourceChannel] =
    useState<(typeof SourceChannelSchema.options)[number]>('portal');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<FeatureRequestDetail | null>(null);
  // One idempotency key per draft: a double click or network retry cannot create two requests.
  const idempotencyKey = useRef(newKey());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    // Client-side check with the same shared contract the API uses (the server re-validates).
    const parsed = CreateFeatureRequestSchema.safeParse({ title, description, sourceChannel });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues)
        next[(issue.path[0] as keyof FieldErrors) ?? 'form'] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const created = await api.createRequest(parsed.data, idempotencyKey.current);
      setSubmitted(created);
      setTitle('');
      setDescription('');
      idempotencyKey.current = newKey();
    } catch (error) {
      if (error instanceof ApiClientError && error.issues.length) {
        const next: FieldErrors = {};
        for (const issue of error.issues)
          next[(issue.path as keyof FieldErrors) ?? 'form'] ??= issue.message;
        setErrors(next);
      } else {
        setErrors({ form: error instanceof Error ? error.message : 'Submission failed' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page page--narrow">
      <h1>Submit a feature request</h1>
      <p className="muted">
        Describe the problem you are trying to solve, not only the feature you have in mind. After
        submission the request is stored as written, personal data such as emails and phone numbers
        is masked before any automated analysis, and the triage pipeline proposes how it relates to
        existing needs. <strong>A product manager approves every grouping.</strong>
      </p>

      {submitted && <SubmittedStatus request={submitted} />}

      <form className="card form" onSubmit={onSubmit} noValidate>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={title}
          maxLength={REQUEST_LIMITS.titleMax}
          onChange={(event) => setTitle(event.target.value)}
          aria-invalid={!!errors.title}
          aria-describedby="title-help"
        />
        <div id="title-help" className="field-help">
          {errors.title ? (
            <span className="field-error">{errors.title}</span>
          ) : (
            `${REQUEST_LIMITS.titleMin}–${REQUEST_LIMITS.titleMax} characters`
          )}
          <span className="counter">
            {title.trim().length}/{REQUEST_LIMITS.titleMax}
          </span>
        </div>

        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          rows={6}
          value={description}
          maxLength={REQUEST_LIMITS.descriptionMax}
          onChange={(event) => setDescription(event.target.value)}
          aria-invalid={!!errors.description}
          aria-describedby="description-help"
        />
        <div id="description-help" className="field-help">
          {errors.description ? (
            <span className="field-error">{errors.description}</span>
          ) : (
            `What problem does this solve, and for whom? (${REQUEST_LIMITS.descriptionMin}–${REQUEST_LIMITS.descriptionMax} characters)`
          )}
          <span className="counter">
            {description.trim().length}/{REQUEST_LIMITS.descriptionMax}
          </span>
        </div>

        <label htmlFor="channel">Source</label>
        <select
          id="channel"
          value={sourceChannel}
          onChange={(event) => setSourceChannel(event.target.value as typeof sourceChannel)}
        >
          {SourceChannelSchema.options.map((option) => (
            <option key={option} value={option}>
              {option.replace('_', ' ')}
            </option>
          ))}
        </select>

        {errors.form && <Feedback kind="error">{errors.form}</Feedback>}
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </form>
    </div>
  );
}
