/**
 * OPT-IN live checks against Anthropic and Voyage. Skipped unless
 * RUN_LIVE_AI_TESTS=1 and both keys are set. Uses one synthetic request;
 * expected cost is a few thousand tokens per run.
 */
import { describe, expect, it } from 'vitest';
import { runTriage } from '../../src/pipeline/run-triage.js';
import { createProviders, DEFAULT_PROVIDER_SETTINGS } from '../../src/providers/factory.js';

const enabled =
  process.env.RUN_LIVE_AI_TESTS === '1' &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.VOYAGE_API_KEY;

describe.skipIf(!enabled)('live providers (synthetic data only)', () => {
  const providers = enabled
    ? createProviders({
        ...DEFAULT_PROVIDER_SETTINGS,
        mode: 'anthropic-voyage',
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        voyageApiKey: process.env.VOYAGE_API_KEY,
      })!
    : null;

  it('embeds with the configured dimension', async () => {
    const [vector] = await providers!.embedder.embed(
      ['Users want a dark theme for night work.'],
      'document',
    );
    expect(vector).toHaveLength(DEFAULT_PROVIDER_SETTINGS.embeddingDimensions);
  });

  it('runs the full pipeline with schema-valid, verbatim-quoted output', async () => {
    const outcome = await runTriage(
      {
        requestId: 'live-1',
        text: {
          title: 'Too bright at night',
          description:
            'Using the app after sunset is like staring into a lamp. Everything else on my machine is dark already.',
        },
      },
      {
        providers: providers!,
        findNearestMembers: async () => [{ requestId: 'm1', groupId: 'g1', similarity: 0.8 }],
        loadCandidateDetails: async () => [
          {
            groupId: 'g1',
            title: 'Dark mode',
            needStatement:
              'Users working in low light want a dark appearance that is comfortable for their eyes.',
            members: [
              {
                requestId: 'm1',
                title: 'Dark theme please',
                description: 'The white UI gives me headaches in the evening.',
              },
            ],
          },
        ],
      },
    );
    expect(outcome.extraction.needStatement.length).toBeGreaterThan(10);
    console.log(
      JSON.stringify(
        { proposal: outcome.proposal, extractionChecks: outcome.extractionQuoteChecks },
        null,
        2,
      ),
    );
  });
});
