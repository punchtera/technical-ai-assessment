import {
  FeatureRequestDetailSchema,
  NeedGroupDetailSchema,
  RequestHistorySchema,
  ReviewResultSchema,
} from '@fis/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from './helpers';

const PM = { 'X-Actor': 'pm.ana' };

describe('AI-assisted triage workflow (deterministic test provider)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ aiProvider: 'deterministic-test' });
  });
  afterAll(async () => t.close());
  beforeEach(async () => resetDatabase(t.prisma));

  async function submit(title: string, description: string) {
    const res = await t.http.post('/api/v1/requests').send({ title, description }).expect(201);
    return FeatureRequestDetailSchema.parse(res.body);
  }
  const detail = async (id: string) =>
    FeatureRequestDetailSchema.parse((await t.http.get(`/api/v1/requests/${id}`).expect(200)).body);

  it('submit → no-match proposal → reviewer creates a group → approved membership and audit trail', async () => {
    const created = await submit(
      'Dark mode',
      'I work late in the evening and the bright white interface gives me headaches.',
    );
    expect(created).toMatchObject({
      reviewStatus: 'pending_review',
      processingStatus: 'queued',
      latestTriage: null,
    });

    expect(await t.worker.drain()).toBe(1);
    const triaged = await detail(created.id);
    expect(triaged.processingStatus).toBe('completed');
    const run = triaged.latestTriage!;
    expect(run).toMatchObject({
      status: 'succeeded',
      provider: 'deterministic-test',
      isTestProvider: true,
    });
    expect(run.extraction!.evidence.every((e) => e.valid)).toBe(true);
    expect(run.proposal).toMatchObject({ action: 'create_group', flags: ['no_candidates'] });
    // The recommendation alone never groups the request.
    expect(triaged.reviewStatus).toBe('pending_review');
    expect(await t.prisma.groupMembership.count()).toBe(0);

    const decision = await t.http
      .post(`/api/v1/requests/${created.id}/decisions`)
      .set(PM)
      .send({
        action: 'create_group',
        title: 'Dark mode',
        needStatement: 'Users working in low light want a comfortable dark appearance.',
        triageRunId: run.id,
      })
      .expect(201);
    expect(ReviewResultSchema.parse(decision.body).decision).toMatchObject({
      action: 'create_group',
      matchedProposal: true,
      actor: 'pm.ana',
    });

    const grouped = await detail(created.id);
    expect(grouped).toMatchObject({
      reviewStatus: 'grouped',
      activeMembership: { groupTitle: 'Dark mode', approvedBy: 'pm.ana' },
    });
    expect(grouped.latestTriage!.suggestionStatus).toBe('accepted');

    const history = RequestHistorySchema.parse(
      (await t.http.get(`/api/v1/requests/${created.id}/history`).expect(200)).body,
    );
    expect(history.events.map((e) => e.type)).toEqual([
      'REQUEST_SUBMITTED',
      'TRIAGE_STARTED',
      'TRIAGE_COMPLETED',
      'GROUP_CREATED',
      'MEMBERSHIP_APPROVED',
    ]);
    // Audit details hold ids and codes, never request text.
    expect(JSON.stringify(history.events)).not.toContain('headaches');
  });

  it('retrieves an existing group through pgvector and links only after approval', async () => {
    const first = await submit(
      'Dark mode',
      'I work late at night and the bright white interface gives me headaches.',
    );
    await t.worker.drain();
    const firstRun = (await detail(first.id)).latestTriage!;
    const group = ReviewResultSchema.parse(
      (
        await t.http
          .post(`/api/v1/requests/${first.id}/decisions`)
          .set(PM)
          .send({
            action: 'create_group',
            title: 'Dark mode',
            needStatement: 'A dark theme for working at night.',
            triageRunId: firstRun.id,
          })
          .expect(201)
      ).body,
    ).membership!;

    const second = await submit(
      'Dark mode please',
      'I work late at night and the bright white interface hurts my eyes.',
    );
    await t.worker.drain();
    const run = (await detail(second.id)).latestTriage!;
    expect(run.candidates.map((c) => c.groupId)).toContain(group.groupId);
    expect(run.candidates[0]!.members[0]!.requestId).toBe(first.id);
    expect(['link_existing', 'needs_review']).toContain(run.proposal!.action);
    expect(run.proposal!.groupId).toBe(group.groupId);
    // Evidence is traceable to stored source records.
    const memberQuote = run.proposal!.evidence.find((e) => e.source.kind === 'member_request');
    expect(memberQuote).toMatchObject({
      valid: true,
      source: { requestId: first.id, groupId: group.groupId },
    });
    expect(await t.prisma.groupMembership.count({ where: { requestId: second.id } })).toBe(0);

    await t.http
      .post(`/api/v1/requests/${second.id}/decisions`)
      .set(PM)
      .send({ action: 'link', groupId: group.groupId, triageRunId: run.id })
      .expect(201);

    // Distinct supporters are aggregated across approved members.
    await t.http
      .post(`/api/v1/requests/${first.id}/supports`)
      .send({ supporterRef: 'cs.lee' })
      .expect(201);
    await t.http
      .post(`/api/v1/requests/${second.id}/supports`)
      .send({ supporterRef: 'cs.lee' })
      .expect(201);
    await t.http
      .post(`/api/v1/requests/${second.id}/supports`)
      .send({ supporterRef: 'cs.lee' })
      .expect(200);
    await t.http
      .post(`/api/v1/requests/${second.id}/supports`)
      .send({ supporterRef: 'sales.kim' })
      .expect(201);
    const groupView = NeedGroupDetailSchema.parse(
      (await t.http.get(`/api/v1/groups/${group.groupId}`).expect(200)).body,
    );
    expect(groupView).toMatchObject({ memberCount: 2, supporterCount: 2 });
    expect(groupView.members.map((m) => m.requestId)).toEqual([first.id, second.id]);
    const list = (await t.http.get('/api/v1/groups').expect(200)).body;
    expect(list.items[0]).toMatchObject({ id: group.groupId, memberCount: 2, supporterCount: 2 });
  });

  it('rejects a suggestion, keeps the request in the queue, and refuses a second rejection', async () => {
    const a = await submit(
      'Dark mode',
      'I work late at night and the bright white interface gives me headaches.',
    );
    await t.worker.drain();
    await t.http
      .post(`/api/v1/requests/${a.id}/decisions`)
      .set(PM)
      .send({
        action: 'create_group',
        title: 'Dark mode',
        needStatement: 'A dark theme for working at night.',
      })
      .expect(201);
    const b = await submit(
      'Dark mode for exports',
      'I work late at night and need the bright white PDF export to use dark colours.',
    );
    await t.worker.drain();
    const run = (await detail(b.id)).latestTriage!;

    await t.http
      .post(`/api/v1/requests/${b.id}/decisions`)
      .set(PM)
      .send({ action: 'reject_suggestion', triageRunId: run.id, note: 'Different need' })
      .expect(201);
    const after = await detail(b.id);
    expect(after).toMatchObject({ reviewStatus: 'pending_review' });
    expect(after.latestTriage!.suggestionStatus).toBe('rejected');
    await t.http
      .post(`/api/v1/requests/${b.id}/decisions`)
      .set(PM)
      .send({ action: 'reject_suggestion', triageRunId: run.id })
      .expect(409);

    const queue = (
      await t.http.get('/api/v1/requests?reviewStatus=pending_review&sort=oldest').expect(200)
    ).body;
    expect(queue.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
  });

  it('enforces review rules: reversal, double assignment, stale versions, unknown groups', async () => {
    const r = await submit(
      'Bulk edit',
      'When someone goes on leave I reassign sixty tasks one by one.',
    );
    await t.worker.drain();
    const result = ReviewResultSchema.parse(
      (
        await t.http
          .post(`/api/v1/requests/${r.id}/decisions`)
          .set(PM)
          .send({
            action: 'create_group',
            title: 'Bulk edit',
            needStatement: 'Change many tasks at once.',
          })
          .expect(201)
      ).body,
    );
    const groupId = result.membership!.groupId;

    // Already grouped: a second assignment is a conflict.
    await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .set(PM)
      .send({ action: 'link', groupId })
      .expect(409);

    // Reversal returns the request to the queue; reversing twice is a conflict.
    await t.http
      .post(`/api/v1/memberships/${result.membership!.id}/reversal`)
      .set(PM)
      .send({ reason: 'Assigned by mistake' })
      .expect(200);
    const reversed = await detail(r.id);
    expect(reversed).toMatchObject({ reviewStatus: 'pending_review', activeMembership: null });
    await t.http
      .post(`/api/v1/memberships/${result.membership!.id}/reversal`)
      .set(PM)
      .send({ reason: 'again' })
      .expect(409);

    // Stale version and unknown group.
    await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .set(PM)
      .send({ action: 'link', groupId, expectedVersion: 0 })
      .expect(409);
    await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .set(PM)
      .send({
        action: 'link',
        groupId: '00000000-0000-4000-8000-000000000000',
        expectedVersion: reversed.version,
      })
      .expect(404);
    await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .set(PM)
      .send({ action: 'link', groupId, expectedVersion: reversed.version })
      .expect(201);

    const memberships = await t.prisma.groupMembership.findMany({
      where: { requestId: r.id },
      orderBy: { approvedAt: 'asc' },
    });
    expect(memberships.map((m) => m.status)).toEqual(['REVERSED', 'ACTIVE']);
    const history = RequestHistorySchema.parse(
      (await t.http.get(`/api/v1/requests/${r.id}/history`).expect(200)).body,
    );
    expect(history.decisions.map((d) => d.action)).toEqual([
      'create_group',
      'reverse_membership',
      'link_to_group',
    ]);
    expect(history.events.filter((e) => e.type === 'MEMBERSHIP_REVERSED')).toHaveLength(1);
  });

  it('allows exactly one of two concurrent assignments', async () => {
    const seed = await submit(
      'Quiet hours',
      'People get pinged at 11pm by colleagues in other time zones.',
    );
    await t.worker.drain();
    const g = ReviewResultSchema.parse(
      (
        await t.http
          .post(`/api/v1/requests/${seed.id}/decisions`)
          .set(PM)
          .send({
            action: 'create_group',
            title: 'Quiet hours',
            needStatement: 'No notifications after hours.',
          })
          .expect(201)
      ).body,
    ).membership!.groupId;
    const other = await submit(
      'Weekend pings',
      'My phone keeps lighting up on Saturdays because someone updates a task.',
    );

    const attempts = await Promise.all(
      ['pm.ana', 'pm.bo'].map((actor) =>
        t.http
          .post(`/api/v1/requests/${other.id}/decisions`)
          .set({ 'X-Actor': actor })
          .send({ action: 'link', groupId: g }),
      ),
    );
    expect(attempts.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(
      await t.prisma.groupMembership.count({ where: { requestId: other.id, status: 'ACTIVE' } }),
    ).toBe(1);
  });

  it('validates inputs and identity at the boundary', async () => {
    const bad = await t.http
      .post('/api/v1/requests')
      .send({ title: 'x', description: 'short', extra: 1 })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(['title', 'description']),
    );
    await t.http.get('/api/v1/requests/not-a-uuid').expect(400);
    await t.http.get('/api/v1/requests/00000000-0000-4000-8000-000000000000').expect(404);

    const r = await submit(
      'Recurring tasks',
      'Every month we recreate the same tasks manually and sometimes forget.',
    );
    const noActor = await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .send({ action: 'create_group', title: 'x y z', needStatement: 'Something long enough' })
      .expect(400);
    expect(noActor.body.error.issues[0].path).toBe('header.x-actor');
    await t.http
      .post(`/api/v1/requests/${r.id}/decisions`)
      .set(PM)
      .send({ action: 'merge_everything' })
      .expect(400);
  });

  it('makes submission retries safe with an Idempotency-Key', async () => {
    const body = {
      title: 'Gantt chart',
      description: 'Please add a timeline view of the project plan.',
    };
    const first = await t.http
      .post('/api/v1/requests')
      .set('Idempotency-Key', 'client-retry-0001')
      .send(body)
      .expect(201);
    const again = await t.http
      .post('/api/v1/requests')
      .set('Idempotency-Key', 'client-retry-0001')
      .send(body)
      .expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await t.prisma.featureRequest.count()).toBe(1);
  });

  it('stores original text but sends only redacted text to providers', async () => {
    const r = await submit(
      'Month-end reconciliation',
      'Reach me at controller@example.com or +1 555 0142 about invoice matching.',
    );
    const stored = await t.prisma.featureRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(stored.description).toContain('controller@example.com');
    expect(stored.redactedDescription).toBe(
      'Reach me at [email] or [phone] about invoice matching.',
    );
    expect(r.redactionSummary).toEqual({ email: 1, phone: 1 });
    await t.worker.drain();
    const run = await t.prisma.triageRun.findFirstOrThrow({ where: { requestId: r.id } });
    expect(JSON.stringify(run.extraction)).not.toContain('example.com');
  });

  it('cannot process the same attempt twice', async () => {
    const r = await submit(
      'Saved filters',
      'Every morning I rebuild the same filter for my team tasks.',
    );
    const claim = await t.worker.claimNext();
    expect(claim).toMatchObject({ id: r.id, attempt: 1 });
    expect(await t.worker.claimNext()).toBeNull(); // already claimed

    const triage = t.app.get((await import('../../src/triage/triage.service')).TriageService);
    const [a, b] = await Promise.all([
      triage.process(claim!.id, claim!.attempt),
      triage.process(claim!.id, claim!.attempt),
    ]);
    expect([a, b].sort()).toEqual(['duplicate', 'succeeded']);
    expect(await t.prisma.triageRun.count({ where: { requestId: r.id } })).toBe(1);
    expect(
      await t.prisma.auditEvent.count({ where: { requestId: r.id, type: 'TRIAGE_COMPLETED' } }),
    ).toBe(1);
  });

  it('reclaims abandoned processing after the lease expires', async () => {
    const r = await submit(
      'Timer reminder',
      'I forget to stop the timer and find fourteen-hour entries.',
    );
    await t.prisma.featureRequest.update({
      where: { id: r.id },
      data: {
        processingStatus: 'PROCESSING',
        processingAttempts: 1,
        processingStartedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    expect(await t.worker.claimNext()).toMatchObject({ id: r.id, attempt: 2 });
  });
});
