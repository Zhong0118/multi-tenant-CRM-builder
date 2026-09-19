import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import type {
  AssistantFinalizeOutcome,
  BeginTurnInput,
  BeginTurnResult,
  ConversationListPage,
  ConversationListQuery,
  ConversationMessagePage,
  ConversationMessageQuery,
} from './ai.types';
import { ConversationRepository } from './conversation.repository';

@Injectable()
export class ConversationService {
  constructor(private readonly repository: ConversationRepository) {}

  list(
    context: TenantContext,
    query: ConversationListQuery,
  ): Promise<ConversationListPage> {
    return this.repository.list(context, query);
  }

  messages(
    context: TenantContext,
    conversationId: string,
    query: ConversationMessageQuery,
  ): Promise<ConversationMessagePage> {
    return this.repository.messages(context, conversationId, query);
  }

  rename(
    context: TenantContext,
    conversationId: string,
    title: string,
  ): Promise<{ id: string; title: string; lastMessageAt: string }> {
    return this.repository.rename(context, conversationId, title);
  }

  remove(context: TenantContext, conversationId: string): Promise<void> {
    return this.repository.remove(context, conversationId);
  }

  beginTurn(
    context: TenantContext,
    input: BeginTurnInput,
  ): Promise<BeginTurnResult> {
    return this.repository.beginTurn(context, input);
  }

  retryTurn(context: TenantContext, turnId: string): Promise<BeginTurnResult> {
    return this.repository.retryTurn(context, turnId);
  }

  finalizeAssistant(
    context: TenantContext,
    turnId: string,
    outcome: AssistantFinalizeOutcome,
  ): Promise<void> {
    return this.repository.finalizeAssistant(context, turnId, outcome);
  }
}
