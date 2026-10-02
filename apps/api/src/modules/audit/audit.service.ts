import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import type { AuditEvent } from './audit-event';
import { AuditRepository } from './audit.repository';

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async append(
    transaction: Prisma.TransactionClient,
    event: AuditEvent,
  ): Promise<void> {
    await this.appendReturningId(transaction, event);
  }

  appendReturningId(
    transaction: Prisma.TransactionClient,
    event: AuditEvent,
  ): Promise<string> {
    return this.repository.append(transaction, event);
  }
}
