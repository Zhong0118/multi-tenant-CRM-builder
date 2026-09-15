import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { WorkflowAdminController } from './workflow-admin.controller';
import {
  WORKFLOW_REPOSITORY,
  WorkflowAdminService,
} from './workflow-admin.service';
import { PrismaWorkflowRepository } from './workflow.repository';

@Module({
  imports: [AuditModule, AuthModule, MembershipsModule],
  controllers: [WorkflowAdminController],
  providers: [
    WorkflowAdminService,
    PrismaWorkflowRepository,
    { provide: WORKFLOW_REPOSITORY, useExisting: PrismaWorkflowRepository },
  ],
  exports: [WorkflowAdminService],
})
export class WorkflowsModule {}
