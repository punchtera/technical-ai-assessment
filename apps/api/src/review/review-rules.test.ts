import { describe, expect, it } from 'vitest';
import {
  canAssign,
  canRejectSuggestion,
  canReverse,
  checkExpectedVersion,
  checkRunBelongs,
  decisionMatchesProposal,
  suggestionOutcome,
  type RunState,
} from './review-rules';

const pending = { reviewStatus: 'PENDING_REVIEW' as const, version: 3 };
const grouped = { reviewStatus: 'GROUPED' as const, version: 4 };
const run = (overrides: Partial<RunState> = {}): RunState => ({
  requestId: 'r1',
  status: 'SUCCEEDED',
  suggestionStatus: 'OPEN',
  proposedAction: 'LINK_EXISTING',
  proposedGroupId: 'g1',
  ...overrides,
});

describe('review rules', () => {
  it('only assigns requests that are awaiting review', () => {
    expect(canAssign(pending)).toEqual({ ok: true });
    expect(canAssign(grouped)).toMatchObject({ ok: false, status: 409 });
  });

  it('detects stale reviews through the version', () => {
    expect(checkExpectedVersion(pending)).toEqual({ ok: true });
    expect(checkExpectedVersion(pending, 3)).toEqual({ ok: true });
    expect(checkExpectedVersion(pending, 2)).toMatchObject({ ok: false, status: 409 });
  });

  it('requires referenced runs to exist and belong to the request', () => {
    expect(checkRunBelongs(null, 'r1')).toMatchObject({ status: 404 });
    expect(checkRunBelongs(run({ requestId: 'other' }), 'r1')).toMatchObject({ status: 400 });
    expect(checkRunBelongs(run(), 'r1')).toEqual({ ok: true });
  });

  it('rejects only open, completed suggestions on pending requests', () => {
    expect(canRejectSuggestion(pending, run())).toEqual({ ok: true });
    expect(canRejectSuggestion(grouped, run())).toMatchObject({ status: 409 });
    expect(canRejectSuggestion(pending, run({ status: 'FAILED' }))).toMatchObject({ status: 409 });
    expect(canRejectSuggestion(pending, run({ suggestionStatus: 'REJECTED' }))).toMatchObject({
      status: 409,
    });
  });

  it('reverses only active memberships', () => {
    expect(canReverse({ status: 'ACTIVE' })).toEqual({ ok: true });
    expect(canReverse({ status: 'REVERSED' })).toMatchObject({ status: 409 });
    expect(canReverse(null)).toMatchObject({ status: 404 });
  });

  it('records whether the human followed the proposal', () => {
    expect(decisionMatchesProposal(run(), { kind: 'link', groupId: 'g1' })).toBe(true);
    expect(decisionMatchesProposal(run(), { kind: 'link', groupId: 'g2' })).toBe(false);
    expect(decisionMatchesProposal(run(), { kind: 'create_group' })).toBe(false);
    expect(
      decisionMatchesProposal(run({ proposedAction: 'CREATE_GROUP', proposedGroupId: null }), {
        kind: 'create_group',
      }),
    ).toBe(true);
    expect(
      decisionMatchesProposal(run({ proposedAction: 'NEEDS_REVIEW' }), {
        kind: 'link',
        groupId: 'g1',
      }),
    ).toBe(true);
    expect(decisionMatchesProposal(null, { kind: 'create_group' })).toBeNull();
    expect(decisionMatchesProposal(run({ status: 'FAILED' }), { kind: 'create_group' })).toBeNull();
    expect([suggestionOutcome(true), suggestionOutcome(false), suggestionOutcome(null)]).toEqual([
      'ACCEPTED',
      'REJECTED',
      'SUPERSEDED',
    ]);
  });
});
