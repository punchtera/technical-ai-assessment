import { describe, expect, it } from 'vitest';
import { generateDataset, serializeDataset, syntheticRequestId } from './generate.js';
import { loadCatalog } from './io.js';
import { createRng, shuffle } from './random.js';
import { SyntheticRequestSchema } from './schema.js';

const { catalog } = loadCatalog();

describe('seeded randomness', () => {
  it('produces the same sequence for the same seed and differs across seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
  });

  it('shuffles without losing or duplicating items', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = shuffle(items, createRng(1));
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });
});

describe('generateDataset', () => {
  it('is deterministic for a given seed', () => {
    expect(serializeDataset(generateDataset(catalog, 7))).toEqual(
      serializeDataset(generateDataset(catalog, 7)),
    );
  });

  it('keeps request ids stable across seeds while changing arrival order', () => {
    const a = generateDataset(catalog, 1);
    const b = generateDataset(catalog, 2);
    expect(new Set(a.requests.map((r) => r.id))).toEqual(new Set(b.requests.map((r) => r.id)));
    expect(a.requests.map((r) => r.id)).not.toEqual(b.requests.map((r) => r.id));
  });

  it('derives ids that do not expose the group key', () => {
    const id = syntheticRequestId('dark-mode', 0);
    expect(id).toMatch(/^syn-[0-9a-f]{12}$/);
    expect(id).not.toContain('dark');
  });

  it('emits runtime records with no label fields', () => {
    const { requests } = generateDataset(catalog);
    for (const request of requests) {
      expect(SyntheticRequestSchema.safeParse(request).success).toBe(true);
      expect(Object.keys(request).sort()).toEqual(
        [
          'arrivalIndex',
          'description',
          'id',
          'sourceChannel',
          'submittedAt',
          'synthetic',
          'title',
        ].sort(),
      );
    }
  });

  it('splits by family so related groups never straddle dev and test', () => {
    const { splits, labels } = generateDataset(catalog);
    const familyOf = new Map(labels.map((l) => [l.requestId, l.family]));
    const devFamilies = new Set(splits.dev.requestIds.map((id) => familyOf.get(id)));
    const testFamilies = new Set(splits.test.requestIds.map((id) => familyOf.get(id)));
    for (const family of devFamilies) expect(testFamilies.has(family)).toBe(false);
    expect(splits.dev.requestIds.length + splits.test.requestIds.length).toBe(labels.length);
  });

  it('orders arrivals by strictly increasing timestamps', () => {
    const { requests } = generateDataset(catalog);
    for (let i = 1; i < requests.length; i++) {
      expect(Date.parse(requests[i]!.submittedAt)).toBeGreaterThan(
        Date.parse(requests[i - 1]!.submittedAt),
      );
      expect(requests[i]!.arrivalIndex).toBe(i);
    }
  });
});
