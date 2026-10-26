import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmbeddingRepository } from '../../src/triage/embedding.repository';
import { createTestApp, resetDatabase, type TestApp } from './helpers';

const unit = (i: number) => Array.from({ length: 1024 }, (_, j) => (j === i ? 1 : 0));

describe('pgvector retrieval', () => {
  let t: TestApp;
  let repo: EmbeddingRepository;

  beforeAll(async () => {
    t = await createTestApp();
    repo = t.app.get(EmbeddingRepository);
    await repo.ensureSpace('test:a:1024', { provider: 'test', model: 'a', dimensions: 1024 });
    await repo.ensureSpace('test:b:1024', { provider: 'test', model: 'b', dimensions: 1024 });
  });
  afterAll(async () => t.close());
  beforeEach(async () => resetDatabase(t.prisma));

  async function request(title: string) {
    return t.prisma.featureRequest.create({
      data: {
        title,
        description: `${title} description`,
        redactedTitle: title,
        redactedDescription: title,
        redactionSummary: { email: 0, phone: 0 },
      },
    });
  }

  it('returns only approved members in the same embedding space, nearest first, never the query itself', async () => {
    const group = await t.prisma.needGroup.create({
      data: { title: 'G', needStatement: 'need', createdBy: 'pm' },
    });
    const [member, nonMember, otherSpace, self] = await Promise.all([
      request('member'),
      request('non-member'),
      request('other-space'),
      request('self'),
    ]);
    for (const r of [member, otherSpace, self]) {
      const decision = await t.prisma.reviewDecision.create({
        data: { requestId: r.id, action: 'LINK_TO_GROUP', groupId: group.id, actor: 'pm' },
      });
      await t.prisma.groupMembership.create({
        data: {
          requestId: r.id,
          groupId: group.id,
          activeRequestId: r.id,
          approvedBy: 'pm',
          decisionId: decision.id,
        },
      });
    }
    await t.prisma.$transaction(async (tx) => {
      await repo.upsert(tx, member.id, 'test:a:1024', unit(0), 'h1');
      await repo.upsert(tx, nonMember.id, 'test:a:1024', unit(0), 'h2');
      await repo.upsert(tx, otherSpace.id, 'test:b:1024', unit(0), 'h3');
      await repo.upsert(tx, self.id, 'test:a:1024', unit(0), 'h4');
    });

    const hits = await repo.nearestApprovedMembers('test:a:1024', unit(0), self.id, 10);
    expect(hits).toEqual([
      { requestId: member.id, groupId: group.id, similarity: expect.closeTo(1, 6) },
    ]);
  });

  it('refuses to register an embedding space id with a different configuration', async () => {
    await expect(
      repo.ensureSpace('test:a:1024', { provider: 'test', model: 'a', dimensions: 512 }),
    ).rejects.toThrow(/different configuration/);
  });

  it('rejects vectors of the wrong dimension at the database', async () => {
    const r = await request('wrong-dim');
    await expect(
      t.prisma.$transaction((tx) => repo.upsert(tx, r.id, 'test:a:1024', [1, 0, 0], 'h')),
    ).rejects.toThrow();
  });
});
