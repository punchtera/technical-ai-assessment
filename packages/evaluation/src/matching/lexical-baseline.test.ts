import { describe, expect, it } from 'vitest';
import { LexicalRetriever, TfIdfIndex, ThresholdDecider, tokenize } from './lexical-baseline.js';

describe('tokenize', () => {
  it('lowercases, strips accents, drops stopwords and trailing plural s', () => {
    expect(tokenize('Exporting the Invoices to Café systems!')).toEqual([
      'exporting',
      'invoice',
      'cafe',
      'system',
    ]);
    expect(tokenize('access class')).toEqual(['access', 'class']);
  });
});

describe('LexicalRetriever', () => {
  const pool = [
    { id: 'p1', title: 'Dark mode', description: 'A dark theme for night work', groupId: 'G1' },
    {
      id: 'p2',
      title: 'Export invoices',
      description: 'Send invoices to accounting',
      groupId: 'G2',
    },
    { id: 'p3', title: 'Night theme', description: 'dark colours please', groupId: 'G1' },
  ];
  const index = new TfIdfIndex(pool.map((p) => `${p.title}. ${p.description}`));
  const retriever = new LexicalRetriever(index);

  it('ranks groups by their best-matching request and bounds the list', async () => {
    const candidates = await retriever.retrieve(
      { id: 'q', title: 'Dark theme', description: 'for the night' },
      pool,
      5,
    );
    expect(candidates[0]?.groupId).toBe('G1');
    expect(candidates[0]?.supportingRequestIds).toContain('p1');
    expect(
      await retriever.retrieve({ id: 'q', title: 'Dark', description: 'x' }, pool, 1),
    ).toHaveLength(1);
  });

  it('handles an empty pool and never matches a request with itself', async () => {
    expect(await retriever.retrieve({ id: 'q', title: 'x', description: 'y' }, [], 5)).toEqual([]);
    const self = await retriever.retrieve(
      { id: 'p1', title: 'Dark mode', description: 'A dark theme for night work' },
      pool,
      5,
    );
    expect(self.flatMap((c) => c.supportingRequestIds)).not.toContain('p1');
  });

  it('decides link vs new group with a threshold', async () => {
    const decider = new ThresholdDecider(0.5);
    expect(await decider.decide({ id: 'q', title: '', description: '' }, [])).toEqual({
      action: 'new_group',
    });
    expect(
      await decider.decide({ id: 'q', title: '', description: '' }, [
        { groupId: 'G1', score: 0.7, supportingRequestIds: [] },
      ]),
    ).toEqual({ action: 'link', groupId: 'G1' });
    expect(
      await decider.decide({ id: 'q', title: '', description: '' }, [
        { groupId: 'G1', score: 0.3, supportingRequestIds: [] },
      ]),
    ).toEqual({ action: 'new_group' });
  });
});
