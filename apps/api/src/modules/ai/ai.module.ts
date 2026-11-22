import { AssistantQuestionsService } from './assistant-questions.service';
import { AssistantActionsService } from './assistant-actions';
import { AiBatchController } from './ai-batch.controller';
import { FilterPreviewController } from './filter-preview.controller';
import { FilterPreviewService } from './filter-preview.service';
import { CommunicationDraftsService } from './communication-drafts.service';
import { CommunicationDraftsController } from './communication-drafts.controller';
import { CommunicationDraftGenerator } from './communication-draft-generator';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { AI_PROVIDER, createAiProvider } from './ai-provider';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';
import { AiToolRegistry } from './tool-registry';

@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    DatabaseModule,
    AuditModule,
    ObjectsModule,
    RecordsModule,
    FollowUpsModule,
  ],
  controllers: [
    FilterPreviewController,
    AiController,
    AiBatchController,
    CommunicationDraftsController,
  ],
  providers: [
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
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createAiProvider({
          nodeEnv: config.get<string>('NODE_ENV', 'development'),
          provider: config.get<string>('AI_PROVIDER'),
          model: config.get<string>('AI_MODEL'),
          apiKey: config.get<string>('AI_API_KEY'),
          baseURL: config.get<string>('AI_BASE_URL'),
        }),
    },
  ],
})
export class AiModule {}
