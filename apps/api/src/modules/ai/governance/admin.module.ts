import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { DatabaseModule } from '../../../infrastructure/database/database.module';
import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../../auth/auth.module';
import { MembershipsModule } from '../../memberships/memberships.module';
import {
  PlatformAiAdminController,
  WorkspaceAiAdminController,
} from './admin.controller';
import { PlatformAiAdminService } from './admin-platform.service';
import { WorkspaceAiAdminService } from './admin-workspace.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, MembershipsModule],
  controllers: [PlatformAiAdminController, WorkspaceAiAdminController],
  providers: [
    PlatformAdminGuard,
    PlatformAiAdminService,
    WorkspaceAiAdminService,
  ],
})
export class AiGovernanceAdminModule {}
