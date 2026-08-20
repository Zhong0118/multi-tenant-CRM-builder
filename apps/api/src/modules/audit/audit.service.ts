import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import type { AuditEvent } from './audit-event';
import { AuditRepository } from './audit.repository';

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  append(
    transaction: Prisma.TransactionClient,
    event: AuditEvent,
  ): Promise<void> {
    return this.repository.append(transaction, event);
  }
}
