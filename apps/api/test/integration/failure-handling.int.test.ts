import { FeatureRequestDetailSchema } from '@fis/contracts';
import {
  createDeterministicTestProviders,
  ProviderError,
  type NeedExtractor,
  type TriageProviders,
} from '@fis/triage-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from './helpers';

/** Controlled provider double whose extractor can be switched between behaviours. */
function controllableProviders() {
  const base = createDeterministicTestProviders();
  const state: { mode: 'ok' | 'unavailable' | 'malformed'; calls: number; lastInput?: string } = {
    mode: 'ok',
    calls: 0,
  };
  const extractor: NeedExtractor = {
    model: 'controlled-extractor',
    async extract(request, signal) {
      state.calls += 1;
      state.lastInput = `${request.title}\n${request.description}`;
      if (state.mode === 'unavailable') throw new ProviderError('unavailable', 'test', 'HTTP 529');
      if (state.mode === 'malformed')
        return { raw: { needStatement: 42 }, model: 'controlled-extractor' };
      return base.extractor.extract(request, signal);
    },
  };
  const providers: TriageProviders = { ...base, label: 'controlled-test', extractor };
  return { providers, state };
}

describe('failure handling', () => {
  let t: TestApp;
  const { providers, state } = controllableProviders();

  beforeAll(async () => {
    t = await createTestApp({ providers });
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    state.mode = 'ok';
    state.calls = 0;
    await resetDatabase(t.prisma);
  });

  const submit = async () =>
    FeatureRequestDetailSchema.parse(
      (
        await t.http
          .post('/api/v1/requests')
          .send({
            title: 'Offline mode',
            description: 'Technicians work in basements with no signal at all.',
          })
          .expect(201)
      ).body,
    );

  it('records provider outages as visible failures with bounded retries, then recovers on manual retry', async () => {
    const r = await submit();
    state.mode = 'unavailable';
    await t.worker.drain();
    expect(state.calls).toBe(3); // 1 attempt + 2 bounded retries

    const failed = FeatureRequestDetailSchema.parse(
      (await t.http.get(`/api/v1/requests/${r.id}`).expect(200)).body,
    );
    expect(failed).toMatchObject({
      processingStatus: 'failed',
      processingError: 'PROVIDER_UNAVAILABLE',
      reviewStatus: 'pending_review',
    });
    expect(failed.latestTriage).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_UNAVAILABLE',
      errorStage: 'extraction',
      proposal: null,
    });

    // Existing data stays usable during the outage, and manual review still works.
    await t.http.get('/api/v1/requests').expect(200);
    await t.http.get('/api/v1/groups').expect(200);

    state.mode = 'ok';
    const retry = await t.http
      .post(`/api/v1/requests/${r.id}/triage`)
      .set('X-Actor', 'pm.ana')
      .expect(202);
    expect(retry.body.processingStatus).toBe('queued');
    // Retrying again while queued is a no-op, not a duplicate job.
    await t.http.post(`/api/v1/requests/${r.id}/triage`).set('X-Actor', 'pm.ana').expect(202);
    await t.worker.drain();

    const recovered = FeatureRequestDetailSchema.parse(
      (await t.http.get(`/api/v1/requests/${r.id}`).expect(200)).body,
    );
    expect(recovered).toMatchObject({
      processingStatus: 'completed',
      latestTriage: { status: 'succeeded', attempt: 2 },
    });
    expect(await t.prisma.triageRun.count({ where: { requestId: r.id } })).toBe(2);
    const types = (
      await t.prisma.auditEvent.findMany({
        where: { requestId: r.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.type);
    expect(types).toEqual([
      'REQUEST_SUBMITTED',
      'TRIAGE_STARTED',
      'TRIAGE_FAILED',
      'TRIAGE_RETRY_REQUESTED',
      'TRIAGE_STARTED',
      'TRIAGE_COMPLETED',
    ]);
  });

  it('marks schema-invalid model output as MALFORMED_OUTPUT after one re-ask', async () => {
    const r = await submit();
    state.mode = 'malformed';
    await t.worker.drain();
    expect(state.calls).toBe(2);
    const failed = FeatureRequestDetailSchema.parse(
      (await t.http.get(`/api/v1/requests/${r.id}`).expect(200)).body,
    );
    expect(failed).toMatchObject({
      processingStatus: 'failed',
      processingError: 'MALFORMED_OUTPUT',
    });
  });

  it('refuses retries for grouped requests', async () => {
    const r = await submit();
    await t.worker.drain();
    await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .set('X-Actor', 'pm.ana')
      .send({
        action: 'create_group',
        title: 'Offline time tracking',
        needStatement: 'Record time without connectivity.',
      })
      .expect(201);
    await t.http.post(`/api/v1/requests/${r.id}/triage`).set('X-Actor', 'pm.ana').expect(409);
  });
});

describe('without AI configured (AI_PROVIDER=none)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ aiProvider: 'none' });
  });
  afterAll(async () => t.close());
  beforeEach(async () => resetDatabase(t.prisma));

  it('keeps the full manual workflow available', async () => {
    const r = FeatureRequestDetailSchema.parse(
      (
        await t.http
          .post('/api/v1/requests')
          .send({
            title: 'SAML SSO',
            description: 'Support single sign-on through our identity provider.',
          })
          .expect(201)
      ).body,
    );
    expect(r.processingStatus).toBe('not_configured');
    expect(await t.worker.drain()).toBe(0);
    await t.http.post(`/api/v1/requests/${r.id}/triage`).set('X-Actor', 'pm.ana').expect(409);
    expect((await t.http.get('/api/v1/system/ai').expect(200)).body).toMatchObject({
      mode: 'none',
      providerLabel: null,
      workerEnabled: false,
      demoMode: false,
    });

    await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .set('X-Actor', 'pm.ana')
      .send({
        action: 'create_group',
        title: 'Single sign-on',
        needStatement: 'Central control of sign-in through the identity provider.',
      })
      .expect(201);
    const detail = FeatureRequestDetailSchema.parse(
      (await t.http.get(`/api/v1/requests/${r.id}`).expect(200)).body,
    );
    expect(detail).toMatchObject({ reviewStatus: 'grouped', latestTriage: null });
  });
});
