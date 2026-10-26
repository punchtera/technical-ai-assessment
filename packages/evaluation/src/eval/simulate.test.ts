import { describe, expect, it } from 'vitest';
import type { Label, SyntheticRequest } from '../dataset/schema.js';
import type { CandidateGroup, MatcherRequest, PoolEntry, Retriever } from '../matching/types.js';
import { simulateRetrieval } from './simulate.js';

const request = (id: string, arrivalIndex: number, title: string): SyntheticRequest => ({
  id,
  arrivalIndex,
  submittedAt: new Date(Date.UTC(2026, 0, 1) + arrivalIndex * 60_000).toISOString(),
  sourceChannel: 'portal',
  title,
  description: `${title} description`,
  synthetic: true,
});

const label = (
  requestId: string,
  groupKey: string,
  family = 'f',
  acceptable: string[] = [],
): Label => ({
  requestId,
  groupKey,
  family,
  acceptableGroupKeys: acceptable,
  tags: ['paraphrase'],
});

/** Records exactly what a matcher was given, to prove labels never reach it. */
class SpyRetriever implements Retriever {
  readonly name = 'spy';
  readonly calls: { query: MatcherRequest; pool: PoolEntry[] }[] = [];
  async retrieve(query: MatcherRequest, pool: readonly PoolEntry[]): Promise<CandidateGroup[]> {
    this.calls.push({ query: { ...query }, pool: pool.map((entry) => ({ ...entry })) });
    return pool.map((entry) => ({
      groupId: entry.groupId,
      score: 0.5,
      supportingRequestIds: [entry.id],
    }));
  }
}

describe('simulateRetrieval', () => {
  const requests = [
    request('c', 2, 'third'),
    request('a', 0, 'first'),
    request('b', 1, 'second'),
    request('d', 3, 'fourth'),
  ];
  const labels = new Map([
    ['a', label('a', 'alpha')],
    ['b', label('b', 'beta')],
    ['c', label('c', 'alpha')],
    ['d', label('d', 'gamma', 'f', ['beta'])],
  ]);

  it('processes requests in arrival order against earlier requests only', async () => {
    const spy = new SpyRetriever();
    const { traces } = await simulateRetrieval({ requests, labels }, spy, 10);
    expect(traces.map((t) => t.requestId)).toEqual(['a', 'b', 'c', 'd']);
    expect(spy.calls.map((call) => call.pool.length)).toEqual([0, 1, 2, 3]);
    expect(spy.calls.every((call) => !call.pool.some((entry) => entry.id === call.query.id))).toBe(
      true,
    );
  });

  it('derives gold actions from the stream (first of a group = new group)', async () => {
    const { traces } = await simulateRetrieval({ requests, labels }, new SpyRetriever(), 10);
    expect(traces.map((t) => t.goldAction)).toEqual([
      'new_group',
      'new_group',
      'link',
      'new_group',
    ]);
    // `d` is a new need, but linking it to `beta` is listed as acceptable.
    expect(traces[3]!.acceptableGroupIds).toHaveLength(1);
    expect(traces[3]!.relatedGroupAvailable).toBe(true);
  });

  it('gives the matcher only text and opaque group ids — never labels', async () => {
    const spy = new SpyRetriever();
    await simulateRetrieval({ requests, labels }, spy, 10);
    for (const call of spy.calls) {
      expect(Object.keys(call.query).sort()).toEqual(['description', 'id', 'title']);
      for (const entry of call.pool) {
        expect(Object.keys(entry).sort()).toEqual(['description', 'groupId', 'id', 'title']);
        expect(entry.groupId).toMatch(/^G\d{3}$/);
        expect(JSON.stringify(entry)).not.toMatch(/alpha|beta|gamma/);
      }
    }
  });
});
