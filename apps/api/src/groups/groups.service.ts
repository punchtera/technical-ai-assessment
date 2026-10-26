import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ListGroupsQuerySchema,
  NeedGroupDetailSchema,
  NeedGroupListSchema,
  type NeedGroupDetail,
  type NeedGroupList,
} from '@fis/contracts';
import type { z } from 'zod';
import { toApi } from '../common/enums';
import { PrismaService } from '../database/prisma.service';

/** Escapes LIKE wildcards so user input is matched literally (it is also bound as a parameter). */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Groups ordered by distinct supporters across approved members — a transparent, deterministic signal. */
  async list(rawQuery: z.input<typeof ListGroupsQuerySchema>): Promise<NeedGroupList> {
    const query = ListGroupsQuerySchema.parse(rawQuery);
    const pattern = query.q ? likePattern(query.q) : null;
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          title: string;
          need_statement: string;
          created_by: string;
          created_at: Date;
          member_count: bigint;
          supporter_count: bigint;
        }[]
      >`
        SELECT g.id, g.title, g.need_statement, g.created_by, g.created_at,
               COUNT(DISTINCT m.request_id) AS member_count,
               COUNT(DISTINCT s.supporter_ref) AS supporter_count
        FROM need_groups g
        LEFT JOIN group_memberships m ON m.group_id = g.id AND m.status = 'ACTIVE'
        LEFT JOIN supports s ON s.request_id = m.request_id
        WHERE ${pattern}::text IS NULL OR g.title ILIKE ${pattern} OR g.need_statement ILIKE ${pattern}
        GROUP BY g.id
        ORDER BY supporter_count DESC, member_count DESC, g.created_at DESC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM need_groups g
        WHERE ${pattern}::text IS NULL OR g.title ILIKE ${pattern} OR g.need_statement ILIKE ${pattern}
      `,
    ]);
    return NeedGroupListSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        needStatement: row.need_statement,
        memberCount: Number(row.member_count),
        supporterCount: Number(row.supporter_count),
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
      })),
      total: Number(totals[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset,
    });
  }

  async get(id: string): Promise<NeedGroupDetail> {
    const group = await this.prisma.needGroup.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          orderBy: { approvedAt: 'asc' },
          include: { request: { include: { supports: { select: { supporterRef: true } } } } },
        },
      },
    });
    if (!group) throw new NotFoundException('Need group not found');
    const supporters = new Set(
      group.memberships.flatMap((m) => m.request.supports.map((s) => s.supporterRef)),
    );
    return NeedGroupDetailSchema.parse({
      id: group.id,
      title: group.title,
      needStatement: group.needStatement,
      memberCount: group.memberships.length,
      supporterCount: supporters.size,
      createdBy: group.createdBy,
      createdAt: group.createdAt.toISOString(),
      members: group.memberships.map((m) => ({
        membershipId: m.id,
        requestId: m.requestId,
        // Reviewers see the ORIGINAL source text of approved members.
        title: m.request.title,
        description: m.request.description,
        sourceChannel: toApi(m.request.sourceChannel),
        supportCount: m.request.supports.length,
        approvedBy: m.approvedBy,
        approvedAt: m.approvedAt.toISOString(),
      })),
    });
  }
}
