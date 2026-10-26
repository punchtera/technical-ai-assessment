import type { FeatureRequestSummary } from '@fis/contracts';
import { PROCESSING_LABEL, REVIEW_STATE_LABEL, reviewState } from '../lib/status';

export function ReviewStateBadge({ request }: { request: Parameters<typeof reviewState>[0] }) {
  const state = reviewState(request);
  return <span className={`badge badge--${state}`}>{REVIEW_STATE_LABEL[state]}</span>;
}

export function ProcessingBadge({ status }: { status: FeatureRequestSummary['processingStatus'] }) {
  return <span className={`badge badge--proc-${status}`}>{PROCESSING_LABEL[status]}</span>;
}

/** Marks output of the deterministic test provider so it is never mistaken for AI. */
export function TestProviderTag() {
  return (
    <span
      className="badge badge--test"
      title="Produced by the deterministic test provider, not by an AI model"
    >
      Demo provider · not AI
    </span>
  );
}

export function ConfidenceTag({ confidence }: { confidence: 'high' | 'medium' | 'low' | null }) {
  if (!confidence) return null;
  return <span className={`badge badge--conf-${confidence}`}>confidence: {confidence}</span>;
}
