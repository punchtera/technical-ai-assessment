import { describe, expect, it } from 'vitest';
import { DATASET_PATHS } from '../paths.js';
import { loadCatalog, readText } from './io.js';
import type { Catalog } from './schema.js';
import { validateDataset, type DatasetFiles } from './validate.js';

const { catalog, text } = loadCatalog();
const committedFiles = (): DatasetFiles => ({
  catalogText: text,
  requestsText: readText(DATASET_PATHS.requests),
  labelsText: readText(DATASET_PATHS.labels),
  groupsText: readText(DATASET_PATHS.groups),
  splitsText: readText(DATASET_PATHS.splits),
  manifestText: readText(DATASET_PATHS.manifest),
});

const clone = (value: Catalog): Catalog => structuredClone(value);

describe('validateDataset', () => {
  it('passes on the committed dataset', () => {
    const report = validateDataset(catalog, committedFiles());
    expect(report.errors).toEqual([]);
    expect(report.stats.requests).toBeGreaterThanOrEqual(180);
    expect(report.stats.groups).toBe(40);
  });

  it('detects a label leaked into the runtime inputs', () => {
    const files = committedFiles();
    const [first, ...rest] = files.requestsText.trimEnd().split('\n');
    const leaked = JSON.stringify({ ...JSON.parse(first!), groupKey: 'dark-mode' });
    const report = validateDataset(catalog, {
      ...files,
      requestsText: [leaked, ...rest].join('\n') + '\n',
    });
    expect(report.errors.some((e) => e.includes('requests.jsonl'))).toBe(true);
  });

  it('detects stale generated files after the catalog changes', () => {
    const edited = clone(catalog);
    edited.groups[0]!.requests[0]!.description += ' Edited.';
    const report = validateDataset(edited, committedFiles());
    expect(report.errors.some((e) => e.includes('fresh generation') || e.includes('stale'))).toBe(
      true,
    );
  });

  it('detects exact duplicate texts across groups', () => {
    const edited = clone(catalog);
    edited.groups[1]!.requests.push({ ...edited.groups[0]!.requests[0]! });
    const report = validateDataset(edited, committedFiles());
    expect(report.errors.some((e) => e.includes('exact duplicate'))).toBe(true);
  });

  it('rejects real-looking personal data and untagged synthetic PII', () => {
    const edited = clone(catalog);
    edited.groups[0]!.requests[1]!.description = 'Write to jane.doe@realcompany.com';
    const report = validateDataset(edited, committedFiles());
    expect(report.errors.some((e) => e.includes('reserved example domain'))).toBe(true);
    expect(report.errors.some((e) => e.includes('contains_synthetic_pii'))).toBe(true);
  });

  it('rejects acceptable-match references to unknown groups', () => {
    const edited = clone(catalog);
    edited.groups[0]!.requests[0]!.alsoAcceptable = ['no-such-group'];
    const report = validateDataset(edited, committedFiles());
    expect(report.errors.some((e) => e.includes('unknown group'))).toBe(true);
  });
});
