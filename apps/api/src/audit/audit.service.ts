import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

export type AuditEventType =
  | 'REQUEST_SUBMITTED'
  | 'SUPPORT_ADDED'
  | 'TRIAGE_STARTED'
  | 'TRIAGE_COMPLETED'
  | 'TRIAGE_FAILED'
  | 'TRIAGE_SKIPPED'
  | 'TRIAGE_RETRY_REQUESTED'
  | 'SUGGESTION_REJECTED'
  | 'GROUP_CREATED'
  | 'MEMBERSHIP_APPROVED'
  | 'MEMBERSHIP_REVERSED';

export interface AuditEntry {
  type: AuditEventType;
  actor: string;
  requestId?: string;
  groupId?: string;
  /** Ids, codes and actions only — never request text or provider messages. */
  details?: Record<string, string | number | boolean | null | string[]>;
}

/** System actor for automated pipeline events. */
export const SYSTEM_ACTOR = 'system:triage';

@Injectable()
export class AuditService {
  /** Always called inside the caller's transaction so history and state change together. */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditEvent.create({
      data: {
        type: entry.type,
        actor: entry.actor,
        requestId: entry.requestId ?? null,
        groupId: entry.groupId ?? null,
        details: entry.details ?? {},
      },
    });
  }
}
