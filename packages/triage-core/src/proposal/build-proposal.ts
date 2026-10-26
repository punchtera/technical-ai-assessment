import type { QuoteCheck } from '../evidence/quotes.js';
import type { CandidateAssessment, Confidence } from '../schemas/assessment.js';
import type { NeedExtraction } from '../schemas/need-extraction.js';

export type ProposalFlag =
  | 'no_candidates'
  | 'vague_request'
  | 'multiple_needs'
  | 'extraction_quote_invalid'
  | 'assessment_quote_invalid'
  | 'missing_two_sided_evidence'
  | 'unknown_candidate_ref'
  | 'low_confidence'
  | 'model_uncertain';

/**
 * The system's recommendation. It is ADVISORY: nothing here creates a group
 * membership. Only a recorded human decision does (enforced in the API).
 */
export type Proposal =
  | {
      action: 'link_existing';
      groupId: string;
      confidence: Confidence;
      flags: ProposalFlag[];
      rationale: string;
    }
  | { action: 'create_group'; flags: ProposalFlag[]; rationale: string }
  | {
      action: 'needs_review';
      suggestedGroupId: string | null;
      confidence: Confidence | null;
      flags: ProposalFlag[];
      rationale: string;
    };

export interface ProposalInput {
  extraction: NeedExtraction;
  extractionQuoteChecks: QuoteCheck[];
  /** Candidate alias → group id, exactly as supplied to the assessor. */
  candidateRefs: ReadonlyMap<string, string>;
  assessment: CandidateAssessment | null;
  assessmentQuoteChecks: QuoteCheck[];
}

/**
 * Deterministic rules turning model output into a proposal. Any doubt —
 * invalid evidence, unknown ids, low confidence, vague input — downgrades the
 * result to `needs_review` instead of being silently accepted.
 */
export function buildProposal(input: ProposalInput): Proposal {
  const flags: ProposalFlag[] = [];
  if (input.extraction.clarity === 'vague') flags.push('vague_request');
  if (input.extraction.clarity === 'multiple_needs') flags.push('multiple_needs');
  if (input.extractionQuoteChecks.some((c) => !c.valid)) flags.push('extraction_quote_invalid');

  const { assessment } = input;
  if (!assessment) {
    flags.push('no_candidates');
    const rationale = 'No existing need group was similar enough to compare against.';
    return flags.length === 1
      ? { action: 'create_group', flags, rationale }
      : { action: 'needs_review', suggestedGroupId: null, confidence: null, flags, rationale };
  }

  const { result } = assessment;
  if (input.assessmentQuoteChecks.some((c) => !c.valid)) flags.push('assessment_quote_invalid');

  if (result.outcome === 'match') {
    const groupId = input.candidateRefs.get(result.candidateRef);
    if (!groupId) {
      flags.push('unknown_candidate_ref');
      return {
        action: 'needs_review',
        suggestedGroupId: null,
        confidence: null,
        flags,
        rationale: result.rationale,
      };
    }
    const validRefs = input.assessmentQuoteChecks.filter((c) => c.valid).map((c) => c.ref);
    const hasRequestEvidence = validRefs.some((ref) => ref.startsWith('request.'));
    const hasCandidateEvidence = validRefs.some((ref) => ref.startsWith(`${result.candidateRef}.`));
    if (!hasRequestEvidence || !hasCandidateEvidence) flags.push('missing_two_sided_evidence');
    if (result.confidence === 'low') flags.push('low_confidence');

    return flags.length === 0
      ? {
          action: 'link_existing',
          groupId,
          confidence: result.confidence,
          flags,
          rationale: result.rationale,
        }
      : {
          action: 'needs_review',
          suggestedGroupId: groupId,
          confidence: result.confidence,
          flags,
          rationale: result.rationale,
        };
  }

  if (result.outcome === 'uncertain') {
    flags.push('model_uncertain');
    const suggested =
      result.possibleCandidateRefs.map((ref) => input.candidateRefs.get(ref)).find(Boolean) ?? null;
    return {
      action: 'needs_review',
      suggestedGroupId: suggested,
      confidence: null,
      flags,
      rationale: result.rationale,
    };
  }

  // no_match
  return flags.length === 0
    ? { action: 'create_group', flags, rationale: result.rationale }
    : {
        action: 'needs_review',
        suggestedGroupId: null,
        confidence: null,
        flags,
        rationale: result.rationale,
      };
}
