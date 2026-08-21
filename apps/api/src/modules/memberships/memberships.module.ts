import { Module } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  WorkspaceGuard,
  WORKSPACE_RESOLVER,
} from '../../common/tenancy/workspace.guard';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsController } from './memberships.controller';
import { PrismaMembershipsRepository } from './memberships.repository';
import {
  MEMBERSHIP_INVITATION_TOKEN,
  MEMBERSHIPS_CLOCK,
  MEMBERSHIPS_REPOSITORY,
  MembershipsService,
} from './memberships.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [MembershipsController],
  providers: [
    MembershipsService,
    WorkspaceGuard,
    PrismaMembershipsRepository,
    {
      provide: MEMBERSHIPS_REPOSITORY,
      useExisting: PrismaMembershipsRepository,
    },
    { provide: WORKSPACE_RESOLVER, useExisting: PrismaMembershipsRepository },
    { provide: MEMBERSHIPS_CLOCK, useValue: () => new Date() },
    {
      provide: MEMBERSHIP_INVITATION_TOKEN,
      useValue: () => randomBytes(32).toString('base64url'),
    },
  ],
  exports: [MembershipsService, WorkspaceGuard, WORKSPACE_RESOLVER],
})
export class MembershipsModule {}
