import { Injectable } from '@nestjs/common';
import type { EmbeddingSpaceConfig, MemberHit } from '@fis/triage-core';
import { EmbeddingCompatibilityError } from '@fis/triage-core';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';

/** Serialises a validated vector as a pgvector literal. Values are bound as a parameter, never interpolated. */
function toVectorLiteral(vector: readonly number[]): string {
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new EmbeddingCompatibilityError('vector contains non-finite values');
  }
  return `[${vector.join(',')}]`;
}

/**
 * The only place that touches the `vector` column. All statements are
 * parameterised tagged templates; the rest of the app stays on typed Prisma.
 *
 * Search is an exact (non-indexed) cosine scan restricted to one embedding
 * space and to requests with an ACTIVE membership. At the expected scale
 * (hundreds to low thousands of requests) this is fast and has perfect recall;
 * an HNSW index can be added later without changing callers.
 */
@Injectable()
export class EmbeddingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSpace(id: string, space: EmbeddingSpaceConfig): Promise<void> {
    const existing = await this.prisma.embeddingSpace.findUnique({ where: { id } });
    if (existing) {
      if (
        existing.dimensions !== space.dimensions ||
        existing.model !== space.model ||
        existing.provider !== space.provider
      ) {
        throw new EmbeddingCompatibilityError(
          `embedding space ${id} is registered with a different configuration`,
        );
      }
      return;
    }
    await this.prisma.embeddingSpace.upsert({
      where: { id },
      create: { id, provider: space.provider, model: space.model, dimensions: space.dimensions },
      update: {},
    });
  }

  async upsert(
    tx: Prisma.TransactionClient,
    requestId: string,
    spaceId: string,
    vector: readonly number[],
    contentHash: string,
  ): Promise<void> {
    const literal = toVectorLiteral(vector);
    await tx.$executeRaw`
      INSERT INTO request_embeddings (request_id, embedding_space_id, embedding, content_hash)
      VALUES (${requestId}::uuid, ${spaceId}, ${literal}::vector, ${contentHash})
      ON CONFLICT (request_id, embedding_space_id)
      DO UPDATE SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, created_at = now()
    `;
  }

  /** Nearest approved group members to `vector` (cosine), excluding the request itself. */
  async nearestApprovedMembers(
    spaceId: string,
    vector: readonly number[],
    excludeRequestId: string,
    limit: number,
  ): Promise<MemberHit[]> {
    const literal = toVectorLiteral(vector);
    const rows = await this.prisma.$queryRaw<
      { request_id: string; group_id: string; similarity: number }[]
    >`
      SELECT e.request_id, m.group_id, 1 - (e.embedding <=> ${literal}::vector) AS similarity
      FROM request_embeddings e
      JOIN group_memberships m ON m.request_id = e.request_id AND m.status = 'ACTIVE'
      WHERE e.embedding_space_id = ${spaceId}
        AND e.request_id <> ${excludeRequestId}::uuid
      ORDER BY e.embedding <=> ${literal}::vector
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      requestId: row.request_id,
      groupId: row.group_id,
      similarity: Number(row.similarity),
    }));
  }
}
