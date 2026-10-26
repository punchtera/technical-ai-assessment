import {
  createDeterministicTestProviders,
  DEFAULT_RETRIEVAL_PARAMS,
  type TriageProviders,
} from '@fis/triage-core';
import { describe, expect, it } from 'vitest';
import { loadCatalog, loadGroundTruth, loadManifest, loadRequests } from '../dataset/io.js';
import { runPipelineEvaluation } from './run-pipeline.js';

/** Wraps the deterministic provider and records every text sent to it. */
function spyProviders(): { providers: TriageProviders; sent: string[] } {
  const base = createDeterministicTestProviders();
  const sent: string[] = [];
  return {
    sent,
    providers: {
      ...base,
      extractor: {
        model: base.extractor.model,
        extract: (request, signal) => {
          sent.push(JSON.stringify(request));
          return base.extractor.extract(request, signal);
        },
      },
      assessor: {
        model: base.assessor.model,
        assess: (request, need, candidates, signal) => {
          sent.push(JSON.stringify({ request, need, candidates }));
          return base.assessor.assess(request, need, candidates, signal);
        },
      },
    },
  };
}

describe('pipeline evaluation', () => {
  it('runs the production pipeline offline without leaking ground truth into provider inputs', async () => {
    const { providers, sent } = spyProviders();
    const report = await runPipelineEvaluation(
      {
        requests: loadRequests(),
        labels: loadGroundTruth().labels,
        splits: loadGroundTruth().splits,
        manifest: loadManifest(),
      },
      {
        providers,
        kind: 'deterministic-test',
        retrievalParams: DEFAULT_RETRIEVAL_PARAMS,
        limitPerSplit: 40,
      },
    );

    expect(report.matcher.kind).toBe('deterministic-test');
    expect(report.splits.dev.requests).toBe(40);
    expect(report.splits.dev.pipeline!.failures.count).toBe(0);

    const { catalog } = loadCatalog();
    const everything = sent.join('\n');
    for (const group of catalog.groups) {
      expect(everything).not.toContain(group.need); // hidden need statements
      expect(everything).not.toContain(`"${group.key}"`); // hidden group keys
    }
    // Synthetic PII is redacted before reaching providers.
    expect(everything).not.toMatch(/@example\.(com|org)/);
  });
});
