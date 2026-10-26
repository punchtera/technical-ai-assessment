import type { EvidenceQuoteView, EvidenceSource, TriageRunView } from '@fis/contracts';
import type {
  CandidateAssessment,
  NeedExtraction,
  QuoteCheck,
  RetrievedCandidate,
} from '@fis/triage-core';
import type { TriageRun } from '../generated/prisma/client';
import { toApi } from '../common/enums';

export interface ViewLookups {
  groups: Map<string, { title: string; needStatement: string }>;
  requestTitles: Map<string, string>;
}

/** Resolves a quotation reference to the stored record it comes from. */
function sourceOf(
  ref: string,
  candidateRefs: Record<string, string>,
  memberRefs: Record<string, string>,
): EvidenceSource {
  if (ref === 'title' || ref === 'request.title') return { kind: 'request', field: 'title' };
  if (ref === 'description' || ref === 'request.description')
    return { kind: 'request', field: 'description' };
  const [candidate, part] = ref.split('.');
  const groupId = candidate ? candidateRefs[candidate] : undefined;
  if (groupId && part === 'need') return { kind: 'group_need', groupId };
  const requestId = memberRefs[ref];
  if (groupId && requestId) return { kind: 'member_request', groupId, requestId };
  return { kind: 'unknown' };
}

const quoteView = (
  check: QuoteCheck,
  cRefs: Record<string, string>,
  mRefs: Record<string, string>,
): EvidenceQuoteView => ({
  ref: check.ref,
  quote: check.quote,
  valid: check.valid,
  source: sourceOf(check.ref, cRefs, mRefs),
});

/** Ids referenced by a run, so callers can batch-load titles. */
export function referencedIds(run: TriageRun): { groupIds: string[]; requestIds: string[] } {
  const retrieval = run.retrieval as { candidates?: RetrievedCandidate[] } | null;
  const candidates = retrieval?.candidates ?? [];
  return {
    groupIds: [
      ...new Set([
        ...candidates.map((c) => c.groupId),
        ...(run.proposedGroupId ? [run.proposedGroupId] : []),
      ]),
    ],
    requestIds: [...new Set(candidates.flatMap((c) => c.memberHits.map((m) => m.requestId)))],
  };
}

export function buildTriageRunView(run: TriageRun, lookups: ViewLookups): TriageRunView {
  const extraction = run.extraction as NeedExtraction | null;
  const extractionChecks = (run.extractionChecks as QuoteCheck[] | null) ?? [];
  const assessment = run.assessment as CandidateAssessment | null;
  const assessmentChecks = (run.assessmentChecks as QuoteCheck[] | null) ?? [];
  const candidateRefs = (run.candidateRefs as Record<string, string> | null) ?? {};
  const memberRefs = (run.memberRefs as Record<string, string> | null) ?? {};
  const retrieval = run.retrieval as { candidates?: RetrievedCandidate[] } | null;
  const refByGroup = new Map(Object.entries(candidateRefs).map(([ref, groupId]) => [groupId, ref]));

  const evidenceCount = extraction?.evidence.length ?? 0;
  const extractionView = extraction
    ? {
        needStatement: extraction.needStatement,
        proposedSolution: extraction.proposedSolution,
        affectedUsers: extraction.affectedUsers,
        clarity: extraction.clarity,
        ambiguityNote: extraction.ambiguityNote,
        evidence: extractionChecks
          .slice(0, evidenceCount)
          .map((c) => quoteView(c, candidateRefs, memberRefs)),
        contextDetails: extraction.contextDetails.map((detail, i) => ({
          detail: detail.detail,
          evidence: quoteView(
            extractionChecks[evidenceCount + i] ?? {
              ref: detail.field,
              quote: detail.quote,
              valid: false,
            },
            candidateRefs,
            memberRefs,
          ),
        })),
      }
    : null;

  const candidates = (retrieval?.candidates ?? []).map((candidate) => {
    const ref = refByGroup.get(candidate.groupId);
    const judgement = assessment?.candidates.find((c) => c.candidateRef === ref);
    const group = lookups.groups.get(candidate.groupId);
    return {
      groupId: candidate.groupId,
      title: group?.title ?? '(deleted group)',
      needStatement: group?.needStatement ?? '',
      similarity: candidate.similarity,
      relation: judgement?.relation ?? null,
      similarities: judgement?.similarities ?? null,
      differences: judgement?.differences ?? null,
      members: candidate.memberHits.map((m) => ({
        requestId: m.requestId,
        title: lookups.requestTitles.get(m.requestId) ?? '(unavailable)',
        similarity: m.similarity,
      })),
    };
  });

  const proposal = run.proposedAction
    ? {
        action: toApi<'link_existing' | 'create_group' | 'needs_review'>(run.proposedAction),
        groupId: run.proposedGroupId,
        confidence: (run.confidence as 'high' | 'medium' | 'low' | null) ?? null,
        flags: run.flags,
        rationale: run.rationale ?? '',
        evidence: assessmentChecks.map((c) => quoteView(c, candidateRefs, memberRefs)),
      }
    : null;

  return {
    id: run.id,
    attempt: run.attempt,
    status: toApi(run.status),
    provider: run.provider,
    isTestProvider: run.isTestProvider,
    models: {
      extraction: run.extractionModel,
      assessment: run.assessmentModel,
      embedding: run.embeddingModel,
    },
    pipelineVersion: run.pipelineVersion,
    promptVersion: run.promptVersion,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    errorCode: run.errorCode,
    errorStage: run.errorStage,
    suggestionStatus: toApi(run.suggestionStatus),
    extraction: extractionView,
    candidates,
    proposal,
  };
}
