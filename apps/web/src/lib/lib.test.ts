import { describe, expect, it } from 'vitest';
import { buildHistory, actorLabel } from './history';
import { highlightQuotes } from './highlight';
import { reviewState } from './status';

const proposal = (overrides = {}) => ({
  action: 'link_existing' as const,
  groupId: '00000000-0000-4000-8000-000000000001',
  groupTitle: 'Dark mode',
  confidence: 'high' as const,
  isTestProvider: true,
  suggestionStatus: 'open' as const,
  ...overrides,
});

describe('reviewState', () => {
  it('never reports a proposal as approved; only a grouped request is approved', () => {
    expect(
      reviewState({
        reviewStatus: 'pending_review',
        processingStatus: 'completed',
        latestProposal: proposal(),
      }),
    ).toBe('awaiting_review');
    expect(
      reviewState({
        reviewStatus: 'grouped',
        processingStatus: 'completed',
        latestProposal: proposal(),
      }),
    ).toBe('approved');
  });

  it('distinguishes processing, failure, manual mode, rejection and needs-review', () => {
    expect(
      reviewState({
        reviewStatus: 'pending_review',
        processingStatus: 'queued',
        latestProposal: null,
      }),
    ).toBe('processing');
    expect(
      reviewState({
        reviewStatus: 'pending_review',
        processingStatus: 'failed',
        latestProposal: null,
      }),
    ).toBe('failed');
    expect(
      reviewState({
        reviewStatus: 'pending_review',
        processingStatus: 'not_configured',
        latestProposal: null,
      }),
    ).toBe('manual');
    expect(
      reviewState({
        reviewStatus: 'pending_review',
        processingStatus: 'completed',
        latestProposal: proposal({ suggestionStatus: 'rejected' }),
      }),
    ).toBe('rejected');
    expect(
      reviewState({
        reviewStatus: 'pending_review',
        processingStatus: 'completed',
        latestProposal: proposal({ action: 'needs_review' }),
      }),
    ).toBe('needs_attention');
  });
});

describe('highlightQuotes', () => {
  it('marks exact occurrences only and merges overlaps', () => {
    expect(highlightQuotes('pinged at 11pm by colleagues', ['at 11pm', '11pm by'])).toEqual([
      { text: 'pinged ', highlighted: false },
      { text: 'at 11pm by', highlighted: true },
      { text: ' colleagues', highlighted: false },
    ]);
    expect(highlightQuotes('abc', ['ABC'])).toEqual([{ text: 'abc', highlighted: false }]);
  });
});

describe('buildHistory', () => {
  it('orders events, labels kinds and attaches decision notes without inventing entries', () => {
    const entries = buildHistory({
      events: [
        {
          id: 'e3',
          type: 'MEMBERSHIP_REVERSED',
          actor: 'pm.ana',
          requestId: 'r',
          groupId: 'g',
          details: { decisionId: 'd2' },
          createdAt: '2026-01-01T00:00:03Z',
        },
        {
          id: 'e1',
          type: 'TRIAGE_COMPLETED',
          actor: 'system:triage',
          requestId: 'r',
          groupId: null,
          details: { proposedAction: 'link_existing', flags: [] },
          createdAt: '2026-01-01T00:00:01Z',
        },
        {
          id: 'e2',
          type: 'MEMBERSHIP_APPROVED',
          actor: 'pm.ana',
          requestId: 'r',
          groupId: 'g',
          details: { decisionId: 'd1', matchedProposal: true },
          createdAt: '2026-01-01T00:00:02Z',
        },
      ],
      decisions: [
        {
          id: 'd2',
          requestId: 'r',
          action: 'reverse_membership',
          groupId: 'g',
          triageRunId: null,
          matchedProposal: null,
          actor: 'pm.ana',
          note: 'Wrong group',
          createdAt: '2026-01-01T00:00:03Z',
        },
      ],
    });
    expect(entries.map((e) => e.kind)).toEqual(['recommendation', 'decision', 'reversal']);
    expect(entries[1]!.detail).toBe('followed the recommendation');
    expect(entries[2]!.note).toBe('Wrong group');
    expect(actorLabel('system:triage')).toMatch(/System/);
  });
});
