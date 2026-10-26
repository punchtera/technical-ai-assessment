import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client';

describe('database migrations and pgvector', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('has applied every migration', async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.finished_at !== null)).toBe(true);
  });

  it('has the pgvector extension enabled', async () => {
    const rows = await prisma.$queryRaw<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows).toHaveLength(1);
    const [major, minor] = rows[0]!.extversion.split('.').map(Number);
    // HNSW indexes and the cosine operator class need pgvector >= 0.5.
    expect(major! > 0 || minor! >= 5).toBe(true);
  });

  it('computes cosine distance with parameterised vector input', async () => {
    // Vectors are passed as bound parameters (never concatenated into SQL).
    const query = '[1,0,0]';
    const rows = await prisma.$queryRaw<{ label: string; distance: number }[]>`
      SELECT label, (embedding <=> ${query}::vector) AS distance
      FROM (VALUES ('same', '[1,0,0]'::vector), ('orthogonal', '[0,1,0]'::vector)) AS t(label, embedding)
      ORDER BY distance ASC
    `;
    expect(rows.map((row) => row.label)).toEqual(['same', 'orthogonal']);
    expect(Number(rows[0]!.distance)).toBeCloseTo(0, 6);
    expect(Number(rows[1]!.distance)).toBeCloseTo(1, 6);
  });

  it('enforces one row per embedding configuration', async () => {
    await prisma.embeddingSpace.deleteMany({ where: { id: { startsWith: 'test-' } } });
    await prisma.embeddingSpace.create({
      data: { id: 'test-space', provider: 'test', model: 'unit-model', dimensions: 3 },
    });
    await expect(
      prisma.embeddingSpace.create({
        data: { id: 'test-space-2', provider: 'test', model: 'unit-model', dimensions: 3 },
      }),
    ).rejects.toThrow();
    await prisma.embeddingSpace.deleteMany({ where: { id: { startsWith: 'test-' } } });
  });
});
