import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import { AuditService } from '../../audit/audit.service';
import { inputs } from './admin.contract';
import {
  admin,
  capabilities,
  company,
  conflict,
  daily,
  members,
  previewAllocation,
  recover,
  type Tx,
} from './admin-usage';
import { listOperations, operationDetail } from './admin-operations';
import type { AuditMeta } from './admin-platform.service';

import { readCatalog } from './feature-catalog';
async function workspaceSettings(tx: Tx, id: string) {
  const state = await company(tx, id);
  const [{ disabled }] = await tx.$queryRaw<
    { disabled: boolean }[]
  >`SELECT disabled FROM ai_platform_settings WHERE id`;
  return {
    ...state,
    catalog: await readCatalog(tx),
    disabled,
    preview: previewAllocation(state, await members(tx, id, state.month)),
  };
}
@Injectable()
export class WorkspaceAiAdminService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}
  capabilities(c: TenantContext) {
    return this.runner.withTenant(c, (tx) => capabilities(tx, c));
  }
  settings(c: TenantContext) {
    admin(c);
    return this.runner.withTenant(c, async (tx) => {
      await recover(tx, c.tenantId);
      return workspaceSettings(tx, c.tenantId);
    });
  }
  allocation(
    c: TenantContext,
    dto: z.infer<typeof inputs.allocation>,
    meta: AuditMeta,
  ) {
    admin(c);
    return this.runner.withTenant(c, async (tx) => {
      // Recovery locks this company configuration through the commit.
      await recover(tx, c.tenantId);
      const before = await workspaceSettings(tx, c.tenantId);
      if (before.preview.confirmation !== dto.confirmation) conflict();
      const changed =
        await tx.$executeRaw`UPDATE tenant_ai_configs SET allocation=${dto.allocation},version=version+1 WHERE tenant_id=${c.tenantId}::uuid AND version=${before.version}`;
      if (changed !== 1) conflict();
      await this.audit.append(tx, {
        ...meta,
        tenantId: c.tenantId,
        actorId: c.userId,
        actorType: 'USER',
        resourceType: 'tenant_ai_config',
        resourceId: c.tenantId,
        action: 'ai.allocation_changed',
        before: { allocation: before.allocation },
        after: { allocation: dto.allocation },
      });
      return workspaceSettings(tx, c.tenantId);
    });
  }
  usage(c: TenantContext) {
    admin(c);
    return this.runner.withTenant(c, async (tx) => {
      await recover(tx, c.tenantId);
      const { month } = await company(tx, c.tenantId);
      return {
        month,
        daily: await daily(tx, c.tenantId, month),
        members: await members(tx, c.tenantId, month),
      };
    });
  }
  operations(c: TenantContext, q: z.infer<typeof inputs.operations>) {
    admin(c);
    return this.runner.withTenant(c, (tx) => listOperations(tx, c, q));
  }
  detail(c: TenantContext, id: string) {
    admin(c);
    return this.runner.withTenant(c, (tx) => operationDetail(tx, c, id));
  }
}
