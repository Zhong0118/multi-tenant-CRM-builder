import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import type { AuditEvent } from './audit-event';

@Injectable()
export class AuditRepository {
  async append(
    transaction: Prisma.TransactionClient,
    event: AuditEvent,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        before: event.before as Prisma.InputJsonValue | undefined,
        after: event.after as Prisma.InputJsonValue | undefined,
        reason: event.reason,
        requestId: event.requestId,
        ip: event.ip,
      },
    });
  }
}
