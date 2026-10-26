/**
 * Pure business rules for human review. Services call these inside database
 * transactions; keeping them free of Nest/Prisma makes them unit-testable and
 * guarantees the backend enforces them whatever the UI does.
 */

export type RuleResult = { ok: true } | { ok: false; status: 404 | 409 | 400; message: string };

const ok: RuleResult = { ok: true };
const conflict = (message: string): RuleResult => ({ ok: false, status: 409, message });

export interface RequestState {
  reviewStatus: 'PENDING_REVIEW' | 'GROUPED';
  version: number;
}

export interface RunState {
  requestId: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  suggestionStatus: 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
  proposedAction: 'LINK_EXISTING' | 'CREATE_GROUP' | 'NEEDS_REVIEW' | null;
  proposedGroupId: string | null;
}

export function checkExpectedVersion(request: RequestState, expectedVersion?: number): RuleResult {
  return expectedVersion === undefined || expectedVersion === request.version
    ? ok
    : conflict('The request changed since it was loaded; reload and review again.');
}

/** Linking or creating a group is only possible while the request awaits review. */
export function canAssign(request: RequestState): RuleResult {
  return request.reviewStatus === 'PENDING_REVIEW'
    ? ok
    : conflict('The request already belongs to a group. Reverse that assignment first.');
}

/** A run referenced by a decision must belong to the request. */
export function checkRunBelongs(run: RunState | null, requestId: string): RuleResult {
  if (!run) return { ok: false, status: 404, message: 'Triage run not found.' };
  return run.requestId === requestId
    ? ok
    : { ok: false, status: 400, message: 'Triage run belongs to another request.' };
}

/** Only a completed, still-open suggestion can be rejected. */
export function canRejectSuggestion(request: RequestState, run: RunState): RuleResult {
  if (request.reviewStatus !== 'PENDING_REVIEW') return conflict('The request is already grouped.');
  if (run.status !== 'SUCCEEDED') return conflict('Only a completed suggestion can be rejected.');
  if (run.suggestionStatus !== 'OPEN')
    return conflict(`The suggestion is already ${run.suggestionStatus.toLowerCase()}.`);
  return ok;
}

export type MembershipState = { status: 'ACTIVE' | 'REVERSED' };

export function canReverse(membership: MembershipState | null): RuleResult {
  if (!membership) return { ok: false, status: 404, message: 'Membership not found.' };
  return membership.status === 'ACTIVE'
    ? ok
    : conflict('The membership has already been reversed.');
}

/** Whether a human decision followed the AI proposal (null when there was no usable proposal). */
export function decisionMatchesProposal(
  run: RunState | null,
  decision: { kind: 'link'; groupId: string } | { kind: 'create_group' },
): boolean | null {
  if (!run || run.status !== 'SUCCEEDED' || !run.proposedAction) return null;
  if (decision.kind === 'create_group') return run.proposedAction === 'CREATE_GROUP';
  return run.proposedGroupId === decision.groupId && run.proposedAction !== 'CREATE_GROUP';
}

/** The suggestion status a run gets once a reviewer assigns the request. */
export function suggestionOutcome(matched: boolean | null): 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED' {
  if (matched === null) return 'SUPERSEDED';
  return matched ? 'ACCEPTED' : 'REJECTED';
}
