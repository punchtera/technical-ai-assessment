import type { AuditEventView, RequestHistory, ReviewDecisionView } from '@fis/contracts';

export type EntryKind = 'system' | 'recommendation' | 'decision' | 'reversal' | 'activity';

export interface HistoryEntry {
  id: string;
  at: string;
  actor: string;
  kind: EntryKind;
  title: string;
  detail: string | null;
  groupId: string | null;
  note: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function describe(event: AuditEventView): Pick<HistoryEntry, 'kind' | 'title' | 'detail'> {
  const d = event.details;
  switch (event.type) {
    case 'REQUEST_SUBMITTED':
      return {
        kind: 'activity',
        title: 'Request submitted',
        detail: str(d.sourceChannel) ? `via ${d.sourceChannel}` : null,
      };
    case 'SUPPORT_ADDED':
      return { kind: 'activity', title: 'Support added', detail: null };
    case 'TRIAGE_STARTED':
      return {
        kind: 'system',
        title: `Triage started (attempt ${d.attempt ?? '?'})`,
        detail: str(d.provider) ? `provider: ${d.provider}` : null,
      };
    case 'TRIAGE_COMPLETED':
      return {
        kind: 'recommendation',
        title: `Recommendation produced: ${String(d.proposedAction ?? 'unknown').replace('_', ' ')}`,
        detail:
          [
            str(d.provider) && `provider: ${d.provider}`,
            Array.isArray(d.flags) && d.flags.length ? `flags: ${d.flags.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
      };
    case 'TRIAGE_FAILED':
      return {
        kind: 'system',
        title: 'Triage failed',
        detail: `${d.errorCode ?? 'error'} during ${d.stage ?? 'processing'}`,
      };
    case 'TRIAGE_SKIPPED':
      return { kind: 'system', title: 'Triage skipped', detail: str(d.reason) };
    case 'TRIAGE_RETRY_REQUESTED':
      return { kind: 'decision', title: 'Retry of AI processing requested', detail: null };
    case 'SUGGESTION_REJECTED':
      return { kind: 'decision', title: 'Recommendation rejected', detail: null };
    case 'GROUP_CREATED':
      return { kind: 'decision', title: 'New need group created', detail: null };
    case 'MEMBERSHIP_APPROVED':
      return {
        kind: 'decision',
        title: 'Assignment to group approved',
        detail:
          d.matchedProposal === true
            ? 'followed the recommendation'
            : d.matchedProposal === false
              ? 'differed from the recommendation'
              : null,
      };
    case 'MEMBERSHIP_REVERSED':
      return { kind: 'reversal', title: 'Assignment reversed', detail: null };
    default:
      return { kind: 'activity', title: event.type, detail: null };
  }
}

/**
 * Chronological, readable history built only from recorded audit events.
 * Decision notes are attached to the event that references their decision id;
 * nothing is invented and reversals stay as their own entries.
 */
export function buildHistory(history: RequestHistory): HistoryEntry[] {
  const decisions = new Map<string, ReviewDecisionView>(history.decisions.map((d) => [d.id, d]));
  return [...history.events]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((event) => {
      const decisionId = str(event.details.decisionId);
      const decision = decisionId ? decisions.get(decisionId) : undefined;
      return {
        id: event.id,
        at: event.createdAt,
        actor: event.actor,
        groupId: event.groupId,
        note: decision?.note ?? null,
        ...describe(event),
      };
    });
}

export function actorLabel(actor: string): string {
  if (actor === 'system:triage') return 'System (triage pipeline)';
  if (actor === 'requester') return 'Requester (anonymous)';
  return actor;
}
