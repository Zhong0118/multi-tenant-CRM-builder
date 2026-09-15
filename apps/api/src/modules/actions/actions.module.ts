import { Inject, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { createFollowUpCommand } from '../follow-ups/follow-up-command';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { createRecordRelationCommand } from '../record-relations/record-relation-command';
import type { RecordsStore } from '../records/records.repository';
import {
  executeActions,
  type ActionExecutionIdentity,
  type ActionExecutionResult,
  type ActionRequestMeta,
  type ActionSourceInput,
} from './action-engine';
import type { WorkflowActionDraft } from './action.types';

/**
 * §24: the Nest boundary of the Action Engine.
 *
 * The executor itself (`executeActions`) is a plain function whose every
 * transaction-scoped dependency is injected, so it nests nothing. This module
 * only assembles those dependencies from the shared building blocks — the
 * Task 5 `RecordsStore` the caller already holds, the Task 6 commands and the
 * Task 4 transaction-aware object resolver — and hands them to the workflow
 * execute path, which owns the tenant transaction.
 *
 * Wiring the runtime execute endpoint is a later task; this module is created
 * (and exported) so that wiring is a one-line dependency.
 */

export const ACTION_ENGINE_CLOCK = 'ACTION_ENGINE_CLOCK';
export const ACTION_ENGINE_ID_GENERATOR = 'ACTION_ENGINE_ID_GENERATOR';

export interface ExecuteTransitionActionsInput {
  /** The caller's tenant transaction: the engine never opens one (§4). */
  tx: Prisma.TransactionClient;
  context: TenantContext;
  /** The `RecordsStore` bound to `tx`. */
  store: RecordsStore;
  source: ActionSourceInput;
  actions: readonly WorkflowActionDraft[];
  execution: ActionExecutionIdentity;
  meta: ActionRequestMeta;
}

@Injectable()
export class ActionEngineService {
  constructor(
    private readonly audit: AuditService,
    @Inject(ACTION_ENGINE_CLOCK) private readonly clock: () => Date,
    @Inject(ACTION_ENGINE_ID_GENERATOR)
    private readonly idGenerator: () => string,
  ) {}

  execute(
    input: ExecuteTransitionActionsInput,
  ): Promise<ActionExecutionResult> {
    return executeActions({
      tx: input.tx,
      context: input.context,
      source: input.source,
      actions: input.actions,
      execution: input.execution,
      meta: input.meta,
      deps: {
        store: input.store,
        audit: this.audit,
        // §25/§46.3: the Target's CURRENT Active Publication, read through the
        // caller's transaction and without the read gate.
        resolveObject: (objectCode) =>
          resolvePublishedObjectInTransaction(
            input.tx,
            input.context,
            objectCode,
          ),
        createRelation: createRecordRelationCommand,
        createFollowUp: createFollowUpCommand,
        clock: this.clock,
        idGenerator: this.idGenerator,
      },
    });
  }
}

@Module({
  imports: [AuditModule],
  providers: [
    ActionEngineService,
    { provide: ACTION_ENGINE_CLOCK, useValue: () => new Date() },
    { provide: ACTION_ENGINE_ID_GENERATOR, useValue: randomUUID },
  ],
  exports: [ActionEngineService],
})
export class ActionsModule {}
