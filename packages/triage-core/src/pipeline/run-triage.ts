import type { z } from 'zod';
import { checkQuotes, type QuoteCheck } from '../evidence/quotes.js';
import { buildProposal, type Proposal } from '../proposal/build-proposal.js';
import {
  aggregateCandidates,
  DEFAULT_RETRIEVAL_PARAMS,
  type MemberHit,
  type RetrievalParams,
  type RetrievedCandidate,
} from '../retrieval/aggregate.js';
import { CandidateAssessmentSchema, type CandidateAssessment } from '../schemas/assessment.js';
import { NeedExtractionSchema, type NeedExtraction } from '../schemas/need-extraction.js';
import { EmbeddingCompatibilityError, ProviderError } from '../providers/errors.js';
import {
  DEFAULT_RETRY_POLICY,
  withRetry,
  type RetryPolicy,
  type Sleep,
} from '../providers/retry.js';
import type {
  CandidateContext,
  ModelUsage,
  ProviderCallResult,
  ProviderRequestText,
  TriageProviders,
} from '../providers/types.js';

export const PIPELINE_VERSION = 'triage-pipeline.v1';

export type TriageStage = 'extraction' | 'embedding' | 'retrieval' | 'assessment';

/** Wraps any failure with the stage it happened in, for persistence and UI. */
export class TriageStageError extends Error {
  constructor(
    readonly stage: TriageStage,
    override readonly cause: unknown,
  ) {
    super(`triage failed during ${stage}`);
    this.name = 'TriageStageError';
  }
}

/** A retrieved group plus the text the assessor will see (redacted member texts). */
export interface CandidateGroupDetails {
  groupId: string;
  title: string;
  needStatement: string;
  members: { requestId: string; title: string; description: string }[];
}

export interface TriageDependencies {
  providers: TriageProviders;
  /** Nearest approved member requests for an embedding (pgvector in the API, in-memory offline). */
  findNearestMembers(embedding: number[], excludeRequestId: string): Promise<MemberHit[]>;
  /** Text for the candidate groups, in the same order. */
  loadCandidateDetails(candidates: RetrievedCandidate[]): Promise<CandidateGroupDetails[]>;
  retrievalParams?: RetrievalParams;
  retryPolicy?: RetryPolicy;
  /** Per provider call. */
  timeoutMs?: number;
  sleep?: Sleep;
}

export interface TriageInput {
  requestId: string;
  /** Redacted text — the only text that leaves the system. */
  text: ProviderRequestText;
}

export interface TriageOutcome {
  pipelineVersion: string;
  extraction: NeedExtraction;
  extractionQuoteChecks: QuoteCheck[];
  embedding: number[];
  retrieval: { params: RetrievalParams; candidates: RetrievedCandidate[] };
  /** Alias shown to the model → group id. */
  candidateRefs: Record<string, string>;
  /** Member alias → request id, for tracing quotes back to source requests. */
  memberRefs: Record<string, string>;
  assessment: CandidateAssessment | null;
  assessmentQuoteChecks: QuoteCheck[];
  proposal: Proposal;
  models: { extraction: string; embedding: string; assessment: string | null };
  usage: ModelUsage[];
  providerCalls: number;
}

/** Validation failures are re-asked once; transport errors use the retry policy. */
const MAX_VALIDATION_ATTEMPTS = 2;

async function callValidated<T>(
  call: (signal: AbortSignal) => Promise<ProviderCallResult<T>>,
  schema: z.ZodType<T>,
  deps: TriageDependencies,
  counter: { calls: number; usage: ModelUsage[] },
  provider: string,
): Promise<{ parsed: T; model: string }> {
  let lastIssue = 'schema validation failed';
  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    const { value } = await withRetry(
      async () => {
        counter.calls += 1;
        return call(AbortSignal.timeout(deps.timeoutMs ?? 30_000));
      },
      deps.retryPolicy ?? DEFAULT_RETRY_POLICY,
      deps.sleep,
    );
    if (value.usage) counter.usage.push(value.usage);
    const parsed = schema.safeParse(value.raw);
    if (parsed.success) return { parsed: parsed.data, model: value.model };
    lastIssue = parsed.error.issues[0]?.path.join('.') || 'root';
  }
  throw new ProviderError('invalid_response', provider, `output failed validation at ${lastIssue}`);
}

export async function runTriage(
  input: TriageInput,
  deps: TriageDependencies,
): Promise<TriageOutcome> {
  const { providers } = deps;
  const params = deps.retrievalParams ?? DEFAULT_RETRIEVAL_PARAMS;
  const counter = { calls: 0, usage: [] as ModelUsage[] };

  // --- Stage B: underlying need -------------------------------------------
  let extraction: NeedExtraction;
  let extractionModel: string;
  try {
    const result = await callValidated(
      (signal) => providers.extractor.extract(input.text, signal),
      NeedExtractionSchema,
      deps,
      counter,
      providers.label,
    );
    extraction = result.parsed;
    extractionModel = result.model;
  } catch (error) {
    throw new TriageStageError('extraction', error);
  }
  const requestSources = new Map([
    ['title', input.text.title],
    ['description', input.text.description],
  ]);
  const extractionQuoteChecks = checkQuotes(requestSources, [
    ...extraction.evidence.map((e) => ({ ref: e.field, quote: e.quote })),
    ...extraction.contextDetails.map((c) => ({ ref: c.field, quote: c.quote })),
  ]).checks;

  // --- Stage C: embedding + retrieval ---------------------------------------
  let embedding: number[];
  try {
    const { value } = await withRetry(
      async () => {
        counter.calls += 1;
        return providers.embedder.embed(
          [extraction.needStatement],
          'document',
          AbortSignal.timeout(deps.timeoutMs ?? 30_000),
        );
      },
      deps.retryPolicy ?? DEFAULT_RETRY_POLICY,
      deps.sleep,
    );
    const [vector] = value;
    if (
      !vector ||
      vector.length !== providers.embedder.space.dimensions ||
      vector.some((v) => !Number.isFinite(v))
    ) {
      throw new EmbeddingCompatibilityError(
        `expected ${providers.embedder.space.dimensions} finite dimensions, got ${vector?.length ?? 0}`,
      );
    }
    embedding = vector;
  } catch (error) {
    throw new TriageStageError('embedding', error);
  }

  let candidates: RetrievedCandidate[];
  let details: CandidateGroupDetails[];
  try {
    const hits = await deps.findNearestMembers(embedding, input.requestId);
    candidates = aggregateCandidates(hits, params, input.requestId);
    details = candidates.length > 0 ? await deps.loadCandidateDetails(candidates) : [];
  } catch (error) {
    throw new TriageStageError('retrieval', error);
  }

  // Aliases: the model only ever sees C1…Cn and C1.M1…, never database ids.
  const candidateRefs = new Map<string, string>();
  const memberRefs = new Map<string, string>();
  const contexts: CandidateContext[] = details.map((group, gi) => {
    const ref = `C${gi + 1}`;
    candidateRefs.set(ref, group.groupId);
    return {
      ref,
      title: group.title,
      needStatement: group.needStatement,
      members: group.members.map((member, mi) => {
        const memberRef = `${ref}.M${mi + 1}`;
        memberRefs.set(memberRef, member.requestId);
        return { ref: memberRef, title: member.title, description: member.description };
      }),
    };
  });

  // --- Stage D: candidate assessment ----------------------------------------
  let assessment: CandidateAssessment | null = null;
  let assessmentModel: string | null = null;
  let assessmentQuoteChecks: QuoteCheck[] = [];
  if (contexts.length > 0) {
    try {
      const result = await callValidated(
        (signal) => providers.assessor.assess(input.text, extraction, contexts, signal),
        CandidateAssessmentSchema,
        deps,
        counter,
        providers.label,
      );
      assessment = result.parsed;
      assessmentModel = result.model;
    } catch (error) {
      throw new TriageStageError('assessment', error);
    }

    const sources = new Map<string, string>([
      ['request.title', input.text.title],
      ['request.description', input.text.description],
    ]);
    for (const context of contexts) {
      sources.set(`${context.ref}.need`, context.needStatement);
      for (const member of context.members)
        sources.set(member.ref, `${member.title}\n${member.description}`);
    }
    const quotes = assessment.result.outcome === 'match' ? assessment.result.evidence : [];
    assessmentQuoteChecks = checkQuotes(sources, quotes).checks;
  }

  const proposal = buildProposal({
    extraction,
    extractionQuoteChecks,
    candidateRefs,
    assessment,
    assessmentQuoteChecks,
  });

  return {
    pipelineVersion: PIPELINE_VERSION,
    extraction,
    extractionQuoteChecks,
    embedding,
    retrieval: { params, candidates },
    candidateRefs: Object.fromEntries(candidateRefs),
    memberRefs: Object.fromEntries(memberRefs),
    assessment,
    assessmentQuoteChecks,
    proposal,
    models: {
      extraction: extractionModel,
      embedding: providers.embedder.space.model,
      assessment: assessmentModel,
    },
    usage: counter.usage,
    providerCalls: counter.calls,
  };
}
