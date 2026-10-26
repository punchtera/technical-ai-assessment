import { describe, expect, it } from 'vitest';
import { checkQuote, checkQuotes } from './evidence/quotes.js';
import { redactPersonalData } from './privacy/redact.js';
import { buildProposal, type ProposalInput } from './proposal/build-proposal.js';
import {
  aggregateCandidates,
  cosineSimilarity,
  DEFAULT_RETRIEVAL_PARAMS,
} from './retrieval/aggregate.js';
import {
  ASSESSMENT_SCHEMA_VERSION,
  CandidateAssessmentSchema,
  type CandidateAssessment,
} from './schemas/assessment.js';
import {
  NEED_EXTRACTION_SCHEMA_VERSION,
  NeedExtractionSchema,
  type NeedExtraction,
} from './schemas/need-extraction.js';
import { ProviderError } from './providers/errors.js';
import { withRetry } from './providers/retry.js';

describe('redactPersonalData', () => {
  it('masks emails and phone numbers and counts them', () => {
    const result = redactPersonalData('Write to jane.doe@example.com or call +1 555 0142 today.');
    expect(result.text).toBe('Write to [email] or call [phone] today.');
    expect(result.summary).toEqual({ email: 1, phone: 1 });
  });

  it('leaves ordinary numbers, amounts and ISO dates untouched', () => {
    const text = 'We sold 200 hours on 2026-10-25 and burned 280; budget 45 days.';
    expect(redactPersonalData(text)).toEqual({ text, summary: { email: 0, phone: 0 } });
  });
});

describe('quote verification', () => {
  const sources = new Map([['description', 'Our team spans Bogotá and Berlin.']]);

  it('accepts exact substrings only', () => {
    expect(checkQuote(sources, 'description', 'spans Bogotá and Berlin').valid).toBe(true);
    expect(checkQuote(sources, 'description', 'spans Bogota and Berlin')).toMatchObject({
      valid: false,
      reason: 'not_found',
    });
    expect(checkQuote(sources, 'description', 'SPANS')).toMatchObject({ valid: false });
  });

  it('rejects unknown sources and trivially short quotes', () => {
    expect(checkQuote(sources, 'title', 'Our team')).toMatchObject({
      valid: false,
      reason: 'unknown_source',
    });
    expect(checkQuote(sources, 'description', 'Ou')).toMatchObject({
      valid: false,
      reason: 'too_short',
    });
    expect(
      checkQuotes(sources, [
        { ref: 'description', quote: 'Our team' },
        { ref: 'x', quote: 'abc' },
      ]).allValid,
    ).toBe(false);
  });
});

describe('aggregateCandidates', () => {
  const params = {
    ...DEFAULT_RETRIEVAL_PARAMS,
    candidateLimit: 2,
    minSimilarity: 0.3,
    membersPerCandidate: 2,
  };

  it('scores groups by their best member, drops weak groups, bounds the list and excludes self', () => {
    const candidates = aggregateCandidates(
      [
        { requestId: 'self', groupId: 'G0', similarity: 1 },
        { requestId: 'a1', groupId: 'A', similarity: 0.62 },
        { requestId: 'a2', groupId: 'A', similarity: 0.8 },
        { requestId: 'a3', groupId: 'A', similarity: 0.4 },
        { requestId: 'b1', groupId: 'B', similarity: 0.5 },
        { requestId: 'c1', groupId: 'C', similarity: 0.45 },
        { requestId: 'd1', groupId: 'D', similarity: 0.1 },
      ],
      params,
      'self',
    );
    expect(candidates.map((c) => c.groupId)).toEqual(['A', 'B']);
    expect(candidates[0]).toMatchObject({ similarity: 0.8 });
    expect(candidates[0]!.memberHits.map((m) => m.requestId)).toEqual(['a2', 'a1']);
  });

  it('handles an empty pool', () => {
    expect(aggregateCandidates([], params)).toEqual([]);
  });

  it('computes cosine similarity and rejects dimension mismatches', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/dimension/);
  });
});

const extraction = (overrides: Partial<NeedExtraction> = {}): NeedExtraction => ({
  schemaVersion: NEED_EXTRACTION_SCHEMA_VERSION,
  needStatement: 'Avoid notifications outside working hours.',
  proposedSolution: null,
  affectedUsers: null,
  contextDetails: [],
  evidence: [{ field: 'description', quote: 'pinged at 11pm' }],
  clarity: 'clear',
  ambiguityNote: null,
  ...overrides,
});

const matchAssessment = (
  confidence: 'high' | 'medium' | 'low' = 'high',
  ref = 'C1',
): CandidateAssessment => ({
  schemaVersion: ASSESSMENT_SCHEMA_VERSION,
  candidates: [
    { candidateRef: 'C1', relation: 'same_need', similarities: 'both', differences: '' },
  ],
  result: {
    outcome: 'match',
    candidateRef: ref,
    confidence,
    rationale: 'Same need.',
    evidence: [
      { ref: 'request.description', quote: 'pinged at 11pm' },
      { ref: 'C1.M1', quote: 'quiet hours' },
    ],
  },
});

const validChecks = [
  { ref: 'request.description', quote: 'pinged at 11pm', valid: true },
  { ref: 'C1.M1', quote: 'quiet hours', valid: true },
];

const input = (overrides: Partial<ProposalInput> = {}): ProposalInput => ({
  extraction: extraction(),
  extractionQuoteChecks: [{ ref: 'description', quote: 'pinged at 11pm', valid: true }],
  candidateRefs: new Map([['C1', 'group-1']]),
  assessment: matchAssessment(),
  assessmentQuoteChecks: validChecks,
  ...overrides,
});

describe('buildProposal', () => {
  it('proposes a link only for a confident, fully evidenced match', () => {
    expect(buildProposal(input())).toMatchObject({
      action: 'link_existing',
      groupId: 'group-1',
      confidence: 'high',
    });
  });

  it('proposes a new group when there are no candidates', () => {
    expect(buildProposal(input({ assessment: null, assessmentQuoteChecks: [] }))).toMatchObject({
      action: 'create_group',
      flags: ['no_candidates'],
    });
  });

  it('downgrades to review when the model references an unknown candidate', () => {
    expect(buildProposal(input({ assessment: matchAssessment('high', 'C9') }))).toMatchObject({
      action: 'needs_review',
      suggestedGroupId: null,
      flags: ['unknown_candidate_ref'],
    });
  });

  it('downgrades to review on fabricated or one-sided evidence', () => {
    const fabricated = buildProposal(
      input({
        assessmentQuoteChecks: [validChecks[0]!, { ref: 'C1.M1', quote: 'made up', valid: false }],
      }),
    );
    expect(fabricated).toMatchObject({ action: 'needs_review', suggestedGroupId: 'group-1' });
    expect(fabricated.flags).toEqual(
      expect.arrayContaining(['assessment_quote_invalid', 'missing_two_sided_evidence']),
    );
  });

  it('downgrades on low confidence, vague input, invalid extraction quotes and uncertainty', () => {
    expect(buildProposal(input({ assessment: matchAssessment('low') })).flags).toContain(
      'low_confidence',
    );
    expect(buildProposal(input({ extraction: extraction({ clarity: 'vague' }) })).action).toBe(
      'needs_review',
    );
    expect(
      buildProposal(
        input({ extractionQuoteChecks: [{ ref: 'description', quote: 'x y z', valid: false }] }),
      ).flags,
    ).toContain('extraction_quote_invalid');
    const uncertain = buildProposal(
      input({
        assessment: {
          ...matchAssessment(),
          result: {
            outcome: 'uncertain',
            rationale: 'Two plausible groups.',
            possibleCandidateRefs: ['C1'],
          },
        },
        assessmentQuoteChecks: [],
      }),
    );
    expect(uncertain).toMatchObject({
      action: 'needs_review',
      suggestedGroupId: 'group-1',
      flags: ['model_uncertain'],
    });
  });

  it('proposes a new group on a clean no-match', () => {
    const result = buildProposal(
      input({
        assessment: {
          ...matchAssessment(),
          result: { outcome: 'no_match', rationale: 'Different need.' },
        },
      }),
    );
    expect(result).toMatchObject({ action: 'create_group', flags: [] });
  });
});

describe('response schemas', () => {
  it('rejects extra fields, wrong versions and malformed candidate refs', () => {
    expect(NeedExtractionSchema.safeParse(extraction()).success).toBe(true);
    expect(NeedExtractionSchema.safeParse({ ...extraction(), revenueImpact: 'high' }).success).toBe(
      false,
    );
    expect(NeedExtractionSchema.safeParse({ ...extraction(), schemaVersion: 'v0' }).success).toBe(
      false,
    );
    expect(CandidateAssessmentSchema.safeParse(matchAssessment()).success).toBe(true);
    const badRef = matchAssessment();
    (badRef.result as { candidateRef: string }).candidateRef = '3f9a-uuid';
    expect(CandidateAssessmentSchema.safeParse(badRef).success).toBe(false);
  });
});

describe('withRetry', () => {
  const noSleep = async () => {};

  it('retries retryable provider errors a bounded number of times', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new ProviderError('rate_limited', 'test', 'slow down');
        },
        { retries: 2, baseDelayMs: 1, maxDelayMs: 1 },
        noSleep,
      ),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors and reports attempts on success', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new ProviderError('refusal', 'test', 'no');
        },
        undefined,
        noSleep,
      ),
    ).rejects.toMatchObject({ kind: 'refusal' });
    expect(calls).toBe(1);

    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 2) throw new ProviderError('timeout', 'test', 't');
        return 'ok';
      },
      undefined,
      noSleep,
    );
    expect(result).toEqual({ value: 'ok', attempts: 2 });
  });

  it('honours retry-after hints up to the cap', async () => {
    const waits: number[] = [];
    let n = 0;
    await withRetry(
      async () => {
        n += 1;
        if (n === 1) throw new ProviderError('rate_limited', 'test', 'x', 3_000);
        return 1;
      },
      { retries: 1, baseDelayMs: 10, maxDelayMs: 2_000 },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(waits).toEqual([2_000]);
  });
});
