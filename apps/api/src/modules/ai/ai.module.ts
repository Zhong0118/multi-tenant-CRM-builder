import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { RecordsModule } from '../records/records.module';
import { AiController } from './ai.controller';
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
    ObjectsModule,
    RecordsModule,
    FollowUpsModule,
  ],
  controllers: [AiController],
  providers: [
    ConversationRepository,
    ConversationService,
    AiOrchestrator,
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
