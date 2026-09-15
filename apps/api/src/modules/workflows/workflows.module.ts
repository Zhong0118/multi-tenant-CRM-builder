import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { RecordsModule } from '../records/records.module';
import { WorkflowAdminController } from './workflow-admin.controller';
import {
  WORKFLOW_REPOSITORY,
  WorkflowAdminService,
} from './workflow-admin.service';
import { WorkflowRuntimeController } from './workflow-runtime.controller';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { PrismaWorkflowRepository } from './workflow.repository';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    MembershipsModule,
    ObjectsModule,
    RecordsModule,
  ],
  controllers: [WorkflowAdminController, WorkflowRuntimeController],
  providers: [
    WorkflowAdminService,
    WorkflowRuntimeService,
    PrismaWorkflowRepository,
    { provide: WORKFLOW_REPOSITORY, useExisting: PrismaWorkflowRepository },
  ],
  exports: [WorkflowAdminService, WorkflowRuntimeService],
})
export class WorkflowsModule {}
