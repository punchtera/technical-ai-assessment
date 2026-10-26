import { z } from 'zod';

export const ASSESSMENT_SCHEMA_VERSION = 'candidate-assessment.v1';

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * Candidate references are short aliases (C1, C2, …) and member references
 * (C1.M1, …) assigned by the application. The model never sees database ids,
 * so it cannot invent one that would be accepted.
 */
const CandidateRefSchema = z.string().regex(/^C\d{1,2}$/);
const SourceRefSchema = z
  .string()
  .regex(/^(request\.(title|description)|C\d{1,2}(\.need|\.M\d{1,2}))$/);

export const EvidenceQuoteSchema = z
  .object({ ref: SourceRefSchema, quote: z.string().min(1).max(500) })
  .strict();
export type EvidenceQuote = z.infer<typeof EvidenceQuoteSchema>;

const CandidateJudgementSchema = z
  .object({
    candidateRef: CandidateRefSchema,
    relation: z.enum(['same_need', 'related_different_need', 'unrelated']),
    similarities: z.string().max(400),
    differences: z.string().max(400),
  })
  .strict();

/** Discriminated union of the supported outcomes (stage D). */
export const AssessmentResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('match'),
      candidateRef: CandidateRefSchema,
      confidence: ConfidenceSchema,
      rationale: z.string().min(1).max(800),
      evidence: z.array(EvidenceQuoteSchema).min(1).max(8),
    })
    .strict(),
  z.object({ outcome: z.literal('no_match'), rationale: z.string().min(1).max(800) }).strict(),
  z
    .object({
      outcome: z.literal('uncertain'),
      rationale: z.string().min(1).max(800),
      possibleCandidateRefs: z.array(CandidateRefSchema).max(5),
    })
    .strict(),
]);
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

export const CandidateAssessmentSchema = z
  .object({
    schemaVersion: z.literal(ASSESSMENT_SCHEMA_VERSION),
    candidates: z.array(CandidateJudgementSchema).max(10),
    result: AssessmentResultSchema,
  })
  .strict();
export type CandidateAssessment = z.infer<typeof CandidateAssessmentSchema>;

const evidenceItem = {
  type: 'object',
  additionalProperties: false,
  required: ['ref', 'quote'],
  properties: {
    ref: {
      type: 'string',
      description:
        'request.title, request.description, C<n>.need or C<n>.M<m> — the exact source of the quote.',
    },
    quote: { type: 'string', description: 'Exact, verbatim substring of the referenced text.' },
  },
} as const;

/** Provider-side JSON schema (structured outputs). Runtime validation is stricter. */
export const CANDIDATE_ASSESSMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'candidates', 'result'],
  properties: {
    schemaVersion: { type: 'string', enum: [ASSESSMENT_SCHEMA_VERSION] },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateRef', 'relation', 'similarities', 'differences'],
        properties: {
          candidateRef: { type: 'string' },
          relation: { type: 'string', enum: ['same_need', 'related_different_need', 'unrelated'] },
          similarities: { type: 'string' },
          differences: { type: 'string' },
        },
      },
    },
    result: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['outcome', 'candidateRef', 'confidence', 'rationale', 'evidence'],
          properties: {
            outcome: { type: 'string', enum: ['match'] },
            candidateRef: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            rationale: { type: 'string' },
            evidence: { type: 'array', minItems: 1, items: evidenceItem },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['outcome', 'rationale'],
          properties: {
            outcome: { type: 'string', enum: ['no_match'] },
            rationale: { type: 'string' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['outcome', 'rationale', 'possibleCandidateRefs'],
          properties: {
            outcome: { type: 'string', enum: ['uncertain'] },
            rationale: { type: 'string' },
            possibleCandidateRefs: { type: 'array', items: { type: 'string' } },
          },
        },
      ],
    },
  },
} as const;
