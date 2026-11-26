import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { ApiException } from '../../common/errors/api.exception';
import { AuditService } from '../audit/audit.service';
import { emailPresentation } from '../auth/email-identity';
import { MailService } from '../mail/mail.service';
import { appendAccountAudit } from './account-audit';
import { avatarUrl } from './avatar-codec';

export type ProfileMeta = { requestId: string; ip?: string };
export const setUser = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT set_config('app.user_id', ${id}, true)`;
export const setTenant = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT set_config('app.tenant_id', ${id}, true)`;

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}
  async profile(id: string, tenantCode?: string) {
    return this.db.transaction(async (tx) => {
      await setUser(tx, id);
      const user = await tx.user.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          displayName: true,
          phone: true,
          isPlatformAdmin: true,
          avatarVersion: true,
          email: true,
          emailVerifiedAt: true,
          emailUndeliverableAt: true,
        },
      });
      const member = tenantCode
        ? await tx.tenantMember.findFirst({
            where: {
              userId: id,
              status: 'ACTIVE',
              user: { status: 'ACTIVE' },
              tenant: { code: tenantCode, status: 'ACTIVE' },
            },
            select: { jobTitle: true },
          })
        : null;
      return {
        id,
        phone: user.phone,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
        ...emailPresentation(user),
        mailAvailable: this.mail.available,
        avatarUrl: avatarUrl(id, user.avatarVersion),
        jobTitle: member?.jobTitle ?? null,
      };
    });
  }
  async rename(id: string, displayName: string, meta: ProfileMeta) {
    await this.db.transaction(async (tx) => {
      await setUser(tx, id);
      await tx.user.update({ where: { id }, data: { displayName } });
      await appendAccountAudit(tx, id, 'account.profile_changed', meta, {
        displayName,
      });
    });
    return this.profile(id);
  }
  async memberships(id: string) {
    return this.db.transaction(async (tx) => {
      await setUser(tx, id);
      const rows = await tx.tenantMember.findMany({
        where: { userId: id, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
        include: {
          tenant: { select: { name: true, code: true } },
          user: { select: { displayName: true } },
        },
        orderBy: [{ tenant: { name: 'asc' } }, { id: 'asc' }],
      });
      return rows.map((row) => ({
        memberId: row.id,
        tenantId: row.tenantId,
        tenantCode: row.tenant.code,
        tenantName: row.tenant.name,
        role: row.role,
        memberDisplayName: row.displayName,
        displayName: row.displayName ?? row.user.displayName,
        jobTitle: row.jobTitle,
        employeeNo: row.employeeNo,
      }));
    });
  }
  async jobTitle(
    userId: string,
    memberId: string,
    title: string,
    meta: ProfileMeta,
  ) {
    return this.db.transaction(async (tx) => {
      await setUser(tx, userId);
      const own = await tx.tenantMember.findFirst({
        where: { id: memberId, userId },
        select: { tenantId: true },
      });
      if (!own) throw new NotFoundException();
      await setTenant(tx, own.tenantId);
      // Lock the membership while checking the current company and account status.
      const [active] = await tx.$queryRaw<{ job_title: string | null }[]>`
        SELECT m.job_title FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id
        WHERE m.id=${memberId}::uuid AND m.tenant_id=${own.tenantId}::uuid AND m.user_id=${userId}::uuid
        AND m.status='ACTIVE' AND t.status='ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF m FOR SHARE OF u`;
      if (!active) throw new ApiException('MEMBERSHIP_INACTIVE', 403);
      const jobTitle = title || null;
      await tx.tenantMember.update({
        where: { id: memberId, tenantId: own.tenantId, userId },
        data: { jobTitle },
      });
      await this.audit.append(tx, {
        tenantId: own.tenantId,
        actorType: 'USER',
        actorId: userId,
        resourceType: 'tenant_member',
        resourceId: memberId,
        action: 'membership.job_title_changed',
        before: { jobTitle: active.job_title },
        after: { jobTitle },
        ...meta,
      });
      return { accepted: true };
    });
  }
}
