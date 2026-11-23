import { TableBuilderController } from './table-builder.controller';
import { TableBuilderService } from './table-builder.service';
import { AssistantQuestionsService } from './assistant-questions.service';
import { AssistantActionsService } from './assistant-actions';
import { AiBatchController } from './ai-batch.controller';
import { FilterPreviewController } from './filter-preview.controller';
import { FilterPreviewService } from './filter-preview.service';
import { CommunicationDraftsService } from './communication-drafts.service';
import { CommunicationDraftsController } from './communication-drafts.controller';
import { CommunicationDraftGenerator } from './communication-draft-generator';
import { Module } from '@nestjs/common';
import { governedProvider } from './governance/governed-provider';
import { AiLedgerService } from './governance/ai-ledger.service';
import { AiGovernanceAdminModule } from './governance/admin.module';

import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { RecordsModule } from '../records/records.module';
import { AiController } from './ai.controller';
import { AiOperationRepository } from './ai-operation.repository';
import { AiProposalService } from './ai-proposal.service';
import { AuditModule } from '../audit/audit.module';
import { AiOrchestrator } from './ai-orchestrator';

import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';
import { AiToolRegistry } from './tool-registry';

@Module({
  imports: [
    AiGovernanceAdminModule,
    AuthModule,
    MembershipsModule,
    DatabaseModule,
    AuditModule,
    ObjectsModule,
    RecordsModule,
    FollowUpsModule,
  ],
  controllers: [
    TableBuilderController,
    FilterPreviewController,
    AiController,
    AiBatchController,
    CommunicationDraftsController,
  ],
  providers: [
    AiLedgerService,
    TableBuilderService,
    FilterPreviewService,
    CommunicationDraftsService,
    CommunicationDraftGenerator,
    ConversationRepository,
    ConversationService,
    AiOperationRepository,
    AiProposalService,
    AiOrchestrator,
    AssistantActionsService,
    AssistantQuestionsService,
    AiToolRegistry,
    governedProvider,
  ],
})
export class AiModule {}
