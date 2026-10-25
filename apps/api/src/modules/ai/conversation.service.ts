import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import {
  followUpLocalDateTime,
  isValidFollowUpTimeZone,
} from '../follow-ups/follow-up-workbench-time';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type {
  AssistantFinalizeOutcome,
  BeginTurnInput,
  BeginTurnResult,
  ConversationListPage,
  ConversationListQuery,
  ConversationMessagePage,
  ConversationMessageQuery,
  PublicAiMessage,
} from './ai.types';
import { ConversationRepository } from './conversation.repository';

@Injectable()
export class ConversationService {
  constructor(private readonly repository: ConversationRepository) {}

  async timeContext(context: TenantContext) {
    const timezone = await this.repository.getTenantTimezone(context);
    if (!isValidFollowUpTimeZone(timezone)) {
      throw new ApiException('INTERNAL_ERROR', 500, {
        message: '租户时区配置无效，请联系平台管理员。',
      });
    }
    const now = new Date();
    const currentDateTime = followUpLocalDateTime(now, timezone);
    return {
      timezone,
      currentDate: currentDateTime.slice(0, 10),
      currentDateTime,
      currentInstant: now.toISOString(),
    };
  }

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

  contextMessages(
    context: TenantContext,
    conversationId: string,
  ): Promise<PublicAiMessage[]> {
    return this.repository.contextMessages(context, conversationId);
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

  finalizeAssistantInTransaction(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    turnId: string,
    outcome: AssistantFinalizeOutcome,
  ): Promise<void> {
    return this.repository.finalizeAssistantInTransaction(
      tx,
      context,
      turnId,
      outcome,
    );
  }

  finalizeAssistant(
    context: TenantContext,
    turnId: string,
    outcome: AssistantFinalizeOutcome,
  ): Promise<void> {
    return this.repository.finalizeAssistant(context, turnId, outcome);
  }
}
