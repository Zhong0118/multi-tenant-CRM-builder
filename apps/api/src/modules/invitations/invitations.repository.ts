import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { DatabaseService } from '../../infrastructure/database/database.service';
import { isWriteConflict } from '../../infrastructure/database/write-conflict';
import { AuditService } from '../audit/audit.service';
import type {
  InvitationMembership,
  InvitationsRepository,
  InvitationStore,
  MemberRole,
  PersonalInvitation,
} from './invitations.service';

const SET_USER = "SELECT set_config('app.user_id', $1, true)";
const SET_TENANT = "SELECT set_config('app.tenant_id', $1, true)";

@Injectable()
export class PrismaInvitationsRepository implements InvitationsRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  withUser<T>(
    userId: string,
    work: (store: InvitationStore) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, userId);
      return work(new PrismaInvitationStore(transaction, this.audit));
    });
  }

  async transaction<T>(
    userId: string,
    work: (store: InvitationStore) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.client.$transaction(
          async (transaction) => {
            await transaction.$queryRawUnsafe(SET_USER, userId);
            return work(new PrismaInvitationStore(transaction, this.audit));
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!isWriteConflict(error) || attempt === 2) throw error;
      }
    }
    throw new Error('Unreachable invitation transaction retry');
  }
}

class PrismaInvitationStore implements InvitationStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly audit: AuditService,
  ) {}

  async listOwned(): Promise<PersonalInvitation[]> {
    const invitations = await this.transaction.tenantInvitation.findMany({
      include: { tenant: { select: { name: true, code: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return invitations.map(mapInvitation);
  }

  async findOwned(id: string): Promise<PersonalInvitation | null> {
    await this.transaction.$queryRawUnsafe(
      'SELECT id FROM tenants WHERE id = (SELECT tenant_id FROM tenant_invitations WHERE id = $1::uuid) FOR UPDATE',
      id,
    );
    await this.transaction.$queryRawUnsafe(
      'SELECT id FROM tenant_invitations WHERE id = $1::uuid FOR UPDATE',
      id,
    );
    const invitation = await this.transaction.tenantInvitation.findUnique({
      where: { id },
      include: { tenant: { select: { name: true, code: true } } },
    });
    return invitation ? mapInvitation(invitation) : null;
  }

  async findMembership(
    tenantId: string,
    userId: string,
  ): Promise<InvitationMembership | null> {
    const member = await this.transaction.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    return member ? mapMembership(member) : null;
  }

  async createMembership(input: {
    tenantId: string;
    userId: string;
    role: MemberRole;
    joinedAt: Date;
  }): Promise<InvitationMembership> {
    await this.transaction.$queryRawUnsafe(SET_TENANT, input.tenantId);
    const member = await this.transaction.tenantMember.upsert({
      where: {
        tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
      },
      create: { ...input, status: 'ACTIVE' },
      update: {},
    });
    return mapMembership(member);
  }

  async markAccepted(
    invitationId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<void> {
    await this.transaction.tenantInvitation.update({
      where: { id: invitationId },
      data: {
        status: 'ACCEPTED',
        targetUserId: userId,
        acceptedByUserId: userId,
        acceptedAt,
      },
    });
  }

  async markDeclined(invitationId: string): Promise<void> {
    await this.transaction.tenantInvitation.update({
      where: { id: invitationId },
      data: { status: 'DECLINED' },
    });
  }

  appendAudit(event: Parameters<AuditService['append']>[1]): Promise<void> {
    return this.audit.append(this.transaction, event);
  }
}

function mapInvitation(input: {
  id: string;
  tenantId: string;
  targetPhone: string;
  targetUserId: string | null;
  role: MemberRole;
  status: PersonalInvitation['status'];
  expiresAt: Date;
  acceptedByUserId: string | null;
  tenant: { name: string; code: string };
}): PersonalInvitation {
  return {
    id: input.id,
    tenantId: input.tenantId,
    targetPhone: input.targetPhone,
    targetUserId: input.targetUserId ?? undefined,
    role: input.role,
    status: input.status,
    expiresAt: input.expiresAt,
    acceptedByUserId: input.acceptedByUserId ?? undefined,
    tenantName: input.tenant.name,
    tenantCode: input.tenant.code,
  };
}

function mapMembership(input: {
  id: string;
  tenantId: string;
  userId: string;
  role: MemberRole;
  status: 'ACTIVE' | 'DISABLED';
}): InvitationMembership {
  return {
    id: input.id,
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
    status: input.status,
  };
}
