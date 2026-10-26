import { z } from 'zod';

export const NEED_EXTRACTION_SCHEMA_VERSION = 'need-extraction.v1';

/** Which part of the submitted request a quotation comes from. */
export const RequestFieldSchema = z.enum(['title', 'description']);
export type RequestField = z.infer<typeof RequestFieldSchema>;

const QuoteSchema = z.string().min(1).max(500);

/**
 * Stage B output, validated in application code after the provider returns.
 * The provider-side JSON schema (below) cannot express length limits, so
 * these constraints are enforced here.
 */
export const NeedExtractionSchema = z
  .object({
    schemaVersion: z.literal(NEED_EXTRACTION_SCHEMA_VERSION),
    /** The problem or outcome the requester needs, not the solution they proposed. */
    needStatement: z.string().min(10).max(400),
    /** The solution the requester proposed, if any, kept separate from the need. */
    proposedSolution: z.string().max(400).nullable(),
    /** Who is affected, only if the request says so explicitly. */
    affectedUsers: z.string().max(200).nullable(),
    /** Context facts explicitly present in the request, each backed by a quotation. */
    contextDetails: z
      .array(
        z
          .object({
            detail: z.string().min(1).max(300),
            field: RequestFieldSchema,
            quote: QuoteSchema,
          })
          .strict(),
      )
      .max(8),
    /** Verbatim quotations supporting the need statement. */
    evidence: z
      .array(z.object({ field: RequestFieldSchema, quote: QuoteSchema }).strict())
      .min(1)
      .max(6),
    clarity: z.enum(['clear', 'vague', 'multiple_needs']),
    ambiguityNote: z.string().max(400).nullable(),
  })
  .strict();
export type NeedExtraction = z.infer<typeof NeedExtractionSchema>;

/**
 * JSON schema sent to the provider's structured-output mode. It follows the
 * documented limits: every object has `additionalProperties: false`, all
 * properties are required, nullable fields use type arrays, and there are no
 * length or numeric constraints.
 */
export const NEED_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'needStatement',
    'proposedSolution',
    'affectedUsers',
    'contextDetails',
    'evidence',
    'clarity',
    'ambiguityNote',
  ],
  properties: {
    schemaVersion: { type: 'string', enum: [NEED_EXTRACTION_SCHEMA_VERSION] },
    needStatement: {
      type: 'string',
      description:
        'One or two sentences describing the underlying problem or desired outcome, not the proposed feature.',
    },
    proposedSolution: {
      type: ['string', 'null'],
      description:
        'The concrete feature or solution the requester asked for, or null if none was proposed.',
    },
    affectedUsers: {
      type: ['string', 'null'],
      description: 'Who is affected, only if explicitly stated in the request; otherwise null.',
    },
    contextDetails: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['detail', 'field', 'quote'],
        properties: {
          detail: { type: 'string' },
          field: { type: 'string', enum: ['title', 'description'] },
          quote: { type: 'string', description: 'Exact, verbatim substring of that field.' },
        },
      },
    },
    evidence: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'quote'],
        properties: {
          field: { type: 'string', enum: ['title', 'description'] },
          quote: { type: 'string', description: 'Exact, verbatim substring of that field.' },
        },
      },
    },
    clarity: { type: 'string', enum: ['clear', 'vague', 'multiple_needs'] },
    ambiguityNote: { type: ['string', 'null'] },
  },
} as const;
