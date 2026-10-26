import { describe, expect, it } from 'vitest';
import { ASSESSMENT_SCHEMA_VERSION, type CandidateAssessment } from '../schemas/assessment.js';
import { NEED_EXTRACTION_SCHEMA_VERSION, type NeedExtraction } from '../schemas/need-extraction.js';
import {
  createDeterministicTestProviders,
  DeterministicEmbedder,
} from '../providers/deterministic.js';
import { ProviderError } from '../providers/errors.js';
import type { CandidateAssessor, NeedExtractor, TriageProviders } from '../providers/types.js';
import { runTriage, TriageStageError, type TriageDependencies } from './run-triage.js';

const text = {
  title: 'Quiet hours',
  description: 'People get pinged at 11pm by colleagues in other time zones.',
};

const goodExtraction: NeedExtraction = {
  schemaVersion: NEED_EXTRACTION_SCHEMA_VERSION,
  needStatement: 'Avoid notifications outside each person’s working hours.',
  proposedSolution: null,
  affectedUsers: null,
  contextDetails: [],
  evidence: [{ field: 'description', quote: 'pinged at 11pm' }],
  clarity: 'clear',
  ambiguityNote: null,
};

const match: CandidateAssessment = {
  schemaVersion: ASSESSMENT_SCHEMA_VERSION,
  candidates: [
    { candidateRef: 'C1', relation: 'same_need', similarities: 'time zones', differences: '' },
  ],
  result: {
    outcome: 'match',
    candidateRef: 'C1',
    confidence: 'high',
    rationale: 'Both want notifications held outside working hours.',
    evidence: [
      { ref: 'request.description', quote: 'pinged at 11pm' },
      { ref: 'C1.M1', quote: 'Do not disturb schedule' },
    ],
  },
};

function providers(extractor: NeedExtractor, assessor: CandidateAssessor): TriageProviders {
  return {
    label: 'mock',
    isTestProvider: true,
    extractor,
    embedder: new DeterministicEmbedder(),
    assessor,
  };
}

const staticExtractor = (raw: unknown): NeedExtractor => ({
  model: 'm-extract',
  extract: async () => ({ raw, model: 'm-extract' }),
});
const staticAssessor = (raw: unknown): CandidateAssessor => ({
  model: 'm-assess',
  assess: async () => ({ raw, model: 'm-assess' }),
});

function deps(p: TriageProviders, withCandidate = true): TriageDependencies {
  return {
    providers: p,
    findNearestMembers: async () =>
      withCandidate ? [{ requestId: 'r-old', groupId: 'group-1', similarity: 0.9 }] : [],
    loadCandidateDetails: async () => [
      {
        groupId: 'group-1',
        title: 'Quiet hours',
        needStatement: 'Protect people from notifications outside their working hours.',
        members: [
          {
            requestId: 'r-old',
            title: 'Do not disturb schedule',
            description: 'Let me set hours.',
          },
        ],
      },
    ],
    sleep: async () => {},
    retryPolicy: { retries: 1, baseDelayMs: 1, maxDelayMs: 1 },
  };
}

describe('runTriage', () => {
  it('runs all stages and proposes an evidenced link using aliases only', async () => {
    const outcome = await runTriage(
      { requestId: 'r-new', text },
      deps(providers(staticExtractor(goodExtraction), staticAssessor(match))),
    );
    expect(outcome.proposal).toMatchObject({ action: 'link_existing', groupId: 'group-1' });
    expect(outcome.candidateRefs).toEqual({ C1: 'group-1' });
    expect(outcome.memberRefs).toEqual({ 'C1.M1': 'r-old' });
    expect(outcome.embedding).toHaveLength(1024);
    expect(outcome.assessmentQuoteChecks.every((c) => c.valid)).toBe(true);
  });

  it('skips the assessor and proposes a new group when nothing is retrieved', async () => {
    let assessed = false;
    const assessor: CandidateAssessor = {
      model: 'm',
      assess: async () => {
        assessed = true;
        return { raw: match, model: 'm' };
      },
    };
    const outcome = await runTriage(
      { requestId: 'r-new', text },
      deps(providers(staticExtractor(goodExtraction), assessor), false),
    );
    expect(assessed).toBe(false);
    expect(outcome.assessment).toBeNull();
    expect(outcome.proposal.action).toBe('create_group');
  });

  it('flags fabricated quotations instead of accepting them', async () => {
    const fabricated = {
      ...match,
      result: {
        ...match.result,
        evidence: [{ ref: 'request.description', quote: 'invented sentence' }],
      },
    };
    const outcome = await runTriage(
      { requestId: 'r', text },
      deps(providers(staticExtractor(goodExtraction), staticAssessor(fabricated))),
    );
    expect(outcome.proposal.action).toBe('needs_review');
    expect(outcome.proposal.flags).toContain('assessment_quote_invalid');
  });

  it('re-asks once on schema-invalid output, then fails the extraction stage', async () => {
    let calls = 0;
    const flaky: NeedExtractor = {
      model: 'm',
      extract: async () => {
        calls += 1;
        return { raw: calls === 1 ? { nope: true } : goodExtraction, model: 'm' };
      },
    };
    const ok = await runTriage(
      { requestId: 'r', text },
      deps(providers(flaky, staticAssessor(match))),
    );
    expect(calls).toBe(2);
    expect(ok.extraction.needStatement).toBe(goodExtraction.needStatement);

    const error = await runTriage(
      { requestId: 'r', text },
      deps(providers(staticExtractor({ bad: 1 }), staticAssessor(match))),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(TriageStageError);
    expect(error.stage).toBe('extraction');
    expect(error.cause).toMatchObject({ kind: 'invalid_response' });
  });

  it('retries transient provider errors and surfaces the stage on final failure', async () => {
    let calls = 0;
    const timingOut: CandidateAssessor = {
      model: 'm',
      assess: async () => {
        calls += 1;
        throw new ProviderError('timeout', 'mock', 'slow');
      },
    };
    const error = await runTriage(
      { requestId: 'r', text },
      deps(providers(staticExtractor(goodExtraction), timingOut)),
    ).catch((e) => e);
    expect(calls).toBe(2); // first attempt + 1 bounded retry; the validation re-ask is never reached
    expect(error).toMatchObject({ stage: 'assessment' });
  });

  it('rejects embeddings with the wrong dimension', async () => {
    const p = providers(staticExtractor(goodExtraction), staticAssessor(match));
    const broken: TriageProviders = {
      ...p,
      embedder: {
        space: { provider: 'x', model: 'y', dimensions: 1024 },
        embed: async () => [[1, 2, 3]],
      },
    };
    const error = await runTriage({ requestId: 'r', text }, deps(broken)).catch((e) => e);
    expect(error).toMatchObject({ stage: 'embedding' });
    expect(error.cause.name).toBe('EmbeddingCompatibilityError');
  });

  it('works end to end with the labelled deterministic test provider', async () => {
    const p = createDeterministicTestProviders();
    expect(p).toMatchObject({ label: 'deterministic-test', isTestProvider: true });
    const outcome = await runTriage({ requestId: 'r', text }, deps(p));
    expect(['link_existing', 'create_group', 'needs_review']).toContain(outcome.proposal.action);
    expect(outcome.extractionQuoteChecks.every((c) => c.valid)).toBe(true);
  });
});
