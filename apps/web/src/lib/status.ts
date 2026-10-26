import type { FeatureRequestSummary } from '@fis/contracts';

/**
 * Where a request stands from the reviewer's point of view. Derived only from
 * fields the API returns — the server remains the source of truth.
 */
export type ReviewState =
  | 'approved'
  | 'processing'
  | 'awaiting_review'
  | 'needs_attention'
  | 'rejected'
  | 'failed'
  | 'manual';

export function reviewState(
  request: Pick<FeatureRequestSummary, 'reviewStatus' | 'processingStatus' | 'latestProposal'>,
): ReviewState {
  if (request.reviewStatus === 'grouped') return 'approved';
  if (request.processingStatus === 'queued' || request.processingStatus === 'processing')
    return 'processing';
  if (request.processingStatus === 'failed') return 'failed';
  if (request.processingStatus === 'not_configured') return 'manual';
  const proposal = request.latestProposal;
  if (!proposal) return 'needs_attention';
  if (proposal.suggestionStatus === 'rejected') return 'rejected';
  if (proposal.action === 'needs_review') return 'needs_attention';
  return 'awaiting_review';
}

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  approved: 'Approved · in group',
  processing: 'Processing — not reviewed yet',
  awaiting_review: 'Recommendation awaiting review',
  needs_attention: 'Needs manual attention',
  rejected: 'Suggestion rejected — decision pending',
  failed: 'Processing failed',
  manual: 'Manual triage (AI not configured)',
};

export const PROCESSING_LABEL: Record<FeatureRequestSummary['processingStatus'], string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Processed',
  failed: 'Failed',
  not_configured: 'AI not configured',
};

export const ACTION_LABEL = {
  link_existing: 'Link to existing group',
  create_group: 'Create a new group',
  needs_review: 'Needs human review',
} as const;

/** Plain-language explanations for proposal flags set by the backend rules. */
export const FLAG_LABEL: Record<string, string> = {
  no_candidates: 'No sufficiently similar approved group exists yet.',
  vague_request: 'The request is too vague to identify a clear need.',
  multiple_needs: 'The request appears to contain more than one need.',
  extraction_quote_invalid:
    'A quotation in the extracted need was not found verbatim in the request.',
  assessment_quote_invalid:
    'A quotation supporting the match was not found verbatim in its source.',
  missing_two_sided_evidence:
    'The match lacks verified evidence from both the request and the group.',
  unknown_candidate_ref:
    'The recommendation referenced a candidate that was not offered — ignored.',
  low_confidence: 'The match was reported with low confidence.',
  model_uncertain: 'No single candidate could be chosen with confidence.',
};

/** Human-readable error codes stored on failed runs. */
export const ERROR_LABEL: Record<string, string> = {
  PROVIDER_TIMEOUT: 'The AI provider timed out.',
  PROVIDER_RATE_LIMITED: 'The AI provider rate-limited the request.',
  PROVIDER_UNAVAILABLE: 'The AI provider was unavailable.',
  PROVIDER_AUTH: 'The AI provider rejected the credentials.',
  PROVIDER_BAD_REQUEST: 'The AI provider rejected the request.',
  PROVIDER_SPEND_LIMIT: 'The AI provider spend limit was reached.',
  MODEL_REFUSAL: 'The model declined to answer.',
  MALFORMED_OUTPUT: 'The model output did not match the required schema.',
  OUTPUT_TRUNCATED: 'The model output was truncated.',
  EMBEDDING_INCOMPATIBLE: 'The embedding was incompatible with the configured vector space.',
  MAX_ATTEMPTS_EXCEEDED: 'Processing was abandoned too many times.',
  INTERNAL_ERROR: 'An internal error occurred during processing.',
};
