import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { isWriteConflict } from '../../infrastructure/database/write-conflict';
import type { ActionEffectKind } from '../actions/action-engine';
import { ActionEngineService } from '../actions/actions.module';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import {
  isReadable,
  PublishedObjectService,
} from '../objects/published-object.service';
import { lockRelationActor } from '../record-relations/record-relation-command';
import { recordAudit } from '../records/record-command';
import { RECORDS_REPOSITORY } from '../records/records.service';
import type {
  DynamicRecord,
  RecordsRepository,
} from '../records/records.repository';
import {
  resolveExecutableTransition,
  runtimeExecutionSummary,
  runtimeWorkflowView,
  START_TRANSITION_KEY,
  type RuntimeWorkflowView,
} from './workflow-runtime';

interface RequestMeta {
  requestId: string;
  ip?: string;
}

/**
 * §30 / A1: the two Source Record mutations a Transition can perform and the
 * audit action each one owns. The Action Engine writes neither — it returns the
 * `effects` that name them — so the patch applier below writes them, inside the
 * same transaction and with the Action correlation attached.
 */
const SOURCE_MUTATION_AUDITS: Partial<Record<ActionEffectKind, string>> = {
  SOURCE_RECORD_UPDATED: 'record.updated',
  SOURCE_OWNER_ASSIGNED: 'record.owner_assigned',
};

/**
 * §32 / §36: 3 attempts on a write conflict (2 retries), the same bound the
 * invitations transaction loop uses. A deadlock is transient by construction —
 * PostgreSQL aborted one of the two contenders and rolled it back — so the
 * loser is expected to succeed on a re-run, but a permanently conflicting
 * environment must still fail rather than spin.
 */
const WORKFLOW_EXECUTE_ATTEMPTS = 3;

export interface WorkflowHistoryItem {
  id: string;
  transitionKey: string;
  transitionLabel: string;
  fromStateKey: string | null;
  fromStateLabel: string | null;
  toStateKey: string;
  toStateLabel: string;
  actorMemberId: string;
  actorDisplayName: string | null;
  createdAt: string;
}

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private readonly publishedObjects: PublishedObjectService,
    @Inject(RECORDS_REPOSITORY)
    private readonly records: RecordsRepository,
    private readonly actions: ActionEngineService,
  ) {}

  async get(
    context: TenantContext,
    objectCode: string,
    recordId: string,
  ): Promise<RuntimeWorkflowView> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.records.withTenant(context, async (store) => {
      const record = await requireReadableRecord(
        store,
        resolved.schema.object.id,
        recordId,
        context,
        resolved.access.readScope,
        resolved.access.canRead,
      );
      return runtimeWorkflowView({
        schema: resolved.schema,
        access: resolved.access,
        role: context.role,
        record,
      });
    });
  }

  /**
   * §23 — the fixed runtime execution order, in ONE Tenant DB Transaction (§4).
   *
   * Every step below shares the transaction the repository opened: the Source
   * publication read, the Actor membership lock, the Source Record lock, the
   * Action steps, the accumulated Source patch with the next state, the single
   * Transition History row and every audit. The caller is handed the
   * transaction itself as well as the store bound to it, so the Action Engine
   * nests nothing and a failure anywhere rolls the whole Transition back.
   *
   * §32: the lock order is source-record → relation endpoints, so two
   * concurrent Transitions acting on records A and B whose actions relate A↔B
   * can deadlock (T1 holds A, T2 holds B). PostgreSQL aborts one of them with a
   * write conflict, which would otherwise surface as a vague 500. The retry
   * below re-runs the WHOLE transaction on that one error class, bounded to
   * three attempts; every other failure propagates untouched.
   */
  async execute(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    transitionKey: string,
    input: { expectedVersion: number },
    meta: RequestMeta,
  ): Promise<RuntimeWorkflowView> {
    for (let attempt = 0; attempt < WORKFLOW_EXECUTE_ATTEMPTS; attempt += 1) {
      try {
        return await this.runTransition(
          context,
          objectCode,
          recordId,
          transitionKey,
          input,
          meta,
        );
      } catch (error) {
        // Retrying is safe because a write conflict means the attempt is one
        // transaction that rolled back having committed NOTHING: the
        // `workflowExecutionId` is generated inside the attempt, the record
        // lock is released with the aborted transaction, and the
        // `expectedVersion` guard is re-evaluated against a freshly locked row
        // on every attempt (so a Transition that lost the race on the version
        // now fails with RECORD_VERSION_CONFLICT instead of committing twice).
        // Anything that is not a write conflict — including every ApiException
        // — is rethrown unchanged, and an exhausted conflict is never turned
        // into a success or swallowed.
        if (
          !isWriteConflict(error) ||
          attempt === WORKFLOW_EXECUTE_ATTEMPTS - 1
        ) {
          throw error;
        }
      }
    }
    throw new Error('Unreachable workflow transition retry');
  }

  /**
   * One attempt: the whole §23 sequence in the one transaction the repository
   * opens. The retry loop above is the only caller; the retry deliberately
   * lives HERE and not in `RecordsRepository.withTenant` /
   * `withTenantTransaction`, which are shared with every ordinary read and
   * write path and must not silently start retrying.
   */
  private runTransition(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    transitionKey: string,
    input: { expectedVersion: number },
    meta: RequestMeta,
  ): Promise<RuntimeWorkflowView> {
    return this.records.withTenantTransaction(
      context,
      async ({ tx, store }) => {
        // §23 steps 3–4: resolve the Source's Active Publication and the Actor's
        // Effective Access INSIDE the transaction, so the schema the Transition
        // executes cannot move under it. The transaction-aware resolver omits the
        // UI read gate (§46.3), so the gate the read path applies is re-applied
        // here: a Transition must not gain read access the Actor does not have.
        const resolved = await resolvePublishedObjectInTransaction(
          tx,
          context,
          objectCode,
        );
        if (!isReadable(resolved.schema, resolved.access)) {
          throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
        }
        if (
          !resolved.access.canUpdate ||
          resolved.access.updateScope === 'NONE'
        ) {
          throw new ApiException('WORKFLOW_TRANSITION_FORBIDDEN', 403);
        }

        // §23 step 6 / §36: lock and re-check the acting membership. The guard on
        // the HTTP route ran before this transaction; the writes below must rest
        // on a check made inside it.
        await lockRelationActor(tx, context);

        // §23 step 7: lock the Source Record. The OWN update scope keeps its
        // owner predicate here, exactly as the read path applies it.
        const snapshot = await store.lockRecord({
          objectId: resolved.schema.object.id,
          recordId,
          ownerMemberId:
            resolved.access.updateScope === 'OWN' ? context.memberId : null,
        });
        if (!snapshot) throw new ApiException('RECORD_NOT_FOUND', 404);

        // §23 step 8 / §29: the optimistic check runs BEFORE any Action, so a
        // duplicate submit creates nothing downstream.
        if (snapshot.version !== input.expectedVersion) {
          throw new ApiException('RECORD_VERSION_CONFLICT', 409);
        }

        // §23 steps 9–10: current state, role and required fields are checked
        // against the published snapshot, and the Transition's frozen Action
        // steps come from that same snapshot.
        const transition = resolveExecutableTransition({
          schema: resolved.schema,
          access: resolved.access,
          role: context.role,
          record: snapshot,
          transitionKey,
        });

        // §23 step 11 / §30: one execution id per attempt that reaches Actions.
        const workflowExecutionId = randomUUID();

        // §23 steps 12–13: `snapshot` is the immutable pre-Transition record. The
        // engine reads SOURCE_FIELD / SOURCE_META / SOURCE_OWNER from it only
        // (§13); nothing below writes to it.
        const execution = await this.actions.execute({
          tx,
          context,
          store,
          source: { objectCode, resolved, snapshot },
          actions: transition.actions,
          // §32: the resolved Transition's published label travels with the
          // identity, so an Action failure can name the step the employee saw
          // instead of the admin-authored keys.
          execution: {
            workflowExecutionId,
            transitionKey: transition.key,
            transitionLabel: transition.label,
          },
          meta: { requestId: meta.requestId, ip: meta.ip },
        });

        // §23 steps 14–16: the engine validated the accumulated patch against the
        // snapshot; it is applied ONCE here, together with the next state and the
        // `version + 1`, guarded by the requested version.
        const updated = await store.applyTransition({
          recordId,
          expectedVersion: input.expectedVersion,
          patch: {
            ...(execution.sourcePatch ?? {
              values: snapshot.values,
              title: snapshot.title,
              ownerMemberId: snapshot.ownerMemberId,
            }),
            workflowStateKey: transition.toStateKey,
          },
          history: {
            objectDefinitionId: resolved.schema.object.id,
            objectPublicationId: resolved.schema.publication.id,
            transitionKey: transition.key,
            transitionLabel: transition.label,
            fromStateKey: transition.fromStateKey,
            fromStateLabel: transition.fromStateLabel,
            toStateKey: transition.toStateKey,
            toStateLabel: transition.toStateLabel,
            actorMemberId: context.memberId,
          },
        });
        if (!updated) throw new ApiException('RECORD_VERSION_CONFLICT', 409);

        // §23 step 18 / §30: the Source Record mutations are audited by whoever
        // applies the patch, one row per mutating Action, each carrying the
        // Transition / Action correlation. The `record.created`,
        // `record.relation_added` and `follow_up.created` rows of Action-created
        // data were already written by their own commands (Task 7).
        for (const effect of execution.effects) {
          const auditAction = SOURCE_MUTATION_AUDITS[effect.effect];
          if (!auditAction) continue;
          await store.appendAudit(
            recordAudit(
              context,
              {
                requestId: meta.requestId,
                ip: meta.ip,
                actionAudit: {
                  workflowExecutionId,
                  transitionKey: transition.key,
                  actionKey: effect.actionKey,
                  actionType: effect.type,
                },
              },
              auditAction,
              updated,
              snapshot,
            ),
          );
        }

        await store.appendAudit({
          tenantId: context.tenantId,
          actorType: 'USER',
          actorId: context.userId,
          action:
            transition.key === START_TRANSITION_KEY
              ? 'record.workflow_started'
              : 'record.transition_executed',
          resourceType: 'record',
          resourceId: recordId,
          after: {
            objectCode,
            transitionKey: transition.key,
            fromStateKey: transition.fromStateKey,
            toStateKey: transition.toStateKey,
            recordVersionBefore: snapshot.version,
            recordVersionAfter: updated.version,
            actionCount: transition.actions.length,
            workflowExecutionId,
          },
          requestId: meta.requestId,
          ip: meta.ip,
        });

        // §23 steps 19–20: the transaction commits everything above and the
        // Runtime Workflow View is projected from the record that was written.
        // §31: the execute response alone carries the lightweight execution
        // summary — same record view plus what the Transition did.
        return {
          ...runtimeWorkflowView({
            schema: resolved.schema,
            access: resolved.access,
            role: context.role,
            record: updated,
          }),
          executionSummary: runtimeExecutionSummary({
            workflowExecutionId,
            transitionKey: transition.key,
            actions: transition.actions,
          }),
        };
      },
    );
  }

  async history(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    query: { page: number; limit: number },
  ): Promise<{
    items: WorkflowHistoryItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.records.withTenant(context, async (store) => {
      await requireReadableRecord(
        store,
        resolved.schema.object.id,
        recordId,
        context,
        resolved.access.readScope,
        resolved.access.canRead,
      );
      return store.listTransitionHistory(recordId, query);
    });
  }
}

/**
 * The READ-side gate shared by `get` and `history`. The execute path no longer
 * uses it: it locks the Source Record inside the transaction instead, and
 * re-applies the same read gate to the resolved schema there.
 */
async function requireReadableRecord(
  store: {
    findRecord(
      objectId: string,
      recordId: string,
    ): Promise<DynamicRecord | null>;
  },
  objectId: string,
  recordId: string,
  context: TenantContext,
  scope: 'ALL' | 'OWN' | 'NONE',
  allowed: boolean,
): Promise<DynamicRecord> {
  if (!allowed || scope === 'NONE') {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  }
  const record = await store.findRecord(objectId, recordId);
  if (
    !record ||
    (scope === 'OWN' && record.ownerMemberId !== context.memberId)
  ) {
    throw new ApiException('RECORD_NOT_FOUND', 404);
  }
  return record;
}
