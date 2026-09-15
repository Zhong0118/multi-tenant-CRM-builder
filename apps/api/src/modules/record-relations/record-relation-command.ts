import { randomUUID } from 'node:crypto';

import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditService } from '../audit/audit.service';
import type { PublishedObjectService } from '../objects/published-object.service';
import type { ResolvedObjectSchema } from '../objects/published-object.service';

/**
 * §21 / §24: the ONE Record Relation policy and the transaction-aware
 * `CREATE_RELATION` command.
 *
 * The command never opens a transaction: the caller owns the tenant
 * transaction and hands in the `Prisma.TransactionClient`, so a Transition, its
 * Actions, its History and its Audit commit or roll back together (§4) —
 * provided every injected dependency, above all `resolveScope`, is itself
 * bound to that transaction; see its contract below. The ordinary HTTP service
 * opens the same command inside its existing `runner.withTenant(…)` boundary,
 * so there is no second relation policy in the Action Engine (§21).
 */

export interface RecordRelationScope {
  id: string;
  objectId: string;
  owner?: string;
}

export interface RecordRelationMeta {
  requestId: string;
  ip?: string;
}

/** Only the one read path the ordinary relation service uses. */
type PublishedObjectReader = Pick<
  PublishedObjectService,
  'resolveRuntimeSchema'
>;

/**
 * The relation scope rule: a write side requires `canUpdate` and an update
 * scope other than `NONE`; the owner filter follows the READ scope, plus the
 * WRITE scope on the writing side. The UI read gate itself stays where it
 * always was — inside `PublishedObjectService.resolveRuntimeSchema`.
 */
export function recordRelationScope(
  resolved: Pick<ResolvedObjectSchema, 'schema' | 'access'>,
  context: TenantContext,
  id: string,
  write: boolean,
): RecordRelationScope {
  const { schema, access } = resolved;
  if (write && (!access.canUpdate || access.updateScope === 'NONE'))
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  return {
    id: id.toLowerCase(),
    objectId: schema.object.id,
    owner:
      access.readScope === 'OWN' || (write && access.updateScope === 'OWN')
        ? context.memberId
        : undefined,
  };
}

/**
 * Resolves one side of a relation through the ordinary published-object read
 * path. Callers that already hold a tenant transaction pass their own
 * transaction-bound resolution instead of this helper (§24).
 */
export function resolveRecordRelationScope(
  objects: PublishedObjectReader,
  context: TenantContext,
  code: string,
  id: string,
  write: boolean,
): Promise<RecordRelationScope> {
  return objects
    .resolveRuntimeSchema(context, code)
    .then((resolved) => recordRelationScope(resolved, context, id, write));
}

/**
 * Re-checks the acting member under lock before any relation row is written:
 * exactly one ACTIVE membership row for this tenant/member/user, whose role
 * still matches the context, and an ACTIVE user.
 */
export async function lockRelationActor(
  tx: Prisma.TransactionClient,
  context: TenantContext,
): Promise<void> {
  const actors = await tx.$queryRaw<
    Array<{ role: string }>
  >`SELECT m.role FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=${context.tenantId}::uuid AND m.id=${context.memberId}::uuid AND m.user_id=${context.userId}::uuid AND m.status='ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF m`;
  if (actors.length !== 1 || actors[0].role !== context.role)
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}

/**
 * Locks (and re-reads) one side of the relation. `lock` runs the `FOR UPDATE`
 * statement the mutation paths need; the read paths skip it. Both branches
 * reject a missing or soft-deleted record with `RECORD_NOT_FOUND`.
 */
export async function checkRelationRecord(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  scope: RecordRelationScope,
  lock = false,
) {
  if (lock) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM records WHERE tenant_id=${context.tenantId}::uuid AND id=${scope.id}::uuid AND object_id=${scope.objectId}::uuid AND deleted_at IS NULL AND (${scope.owner ?? null}::uuid IS NULL OR owner_member_id=${scope.owner ?? null}::uuid) FOR UPDATE`;
    if (!rows.length) throw new ApiException('RECORD_NOT_FOUND', 404);
  }
  const record = await tx.record.findFirst({
    where: {
      tenantId: context.tenantId,
      id: scope.id,
      objectId: scope.objectId,
      ownerMemberId: scope.owner,
      deletedAt: null,
    },
    include: { object: true },
  });
  if (!record) throw new ApiException('RECORD_NOT_FOUND', 404);
  return record;
}

export interface CreateRecordRelationCommandInput {
  /** Source object code, as supplied by the caller (never lower-cased). */
  code: string;
  /** Source record id, normalised by the command. */
  id: string;
  /** Target object code, as supplied by the caller. */
  objectCode: string;
  /** Target record id, normalised by the command. */
  recordId: string;
}

export interface CreateRecordRelationCommandDeps {
  /**
   * Resolves one side's scope. §24 constrains where this resolver MUST run,
   * not where the current production one actually runs.
   *
   * Today's only implementation is NOT bound to the `tx` handed to this
   * command: `RecordRelationsService.scope` → `PublishedObjectService
   * .resolveRuntimeSchema` → `PrismaPublishedObjectRepository.findByCode`
   * reaches the database through `DatabaseContextRunner.withTenant`, which
   * calls `prisma.$transaction`. It therefore opens its own transaction, and
   * the HTTP path's two scope resolutions — although invoked from inside
   * `runner.withTenant(…)` — are reads that do not join that write
   * transaction.
   *
   * That is only acceptable because the HTTP path is not itself nested in a
   * wider transaction. Do not hand this command a resolver that opens a
   * second, independent transaction while the command runs inside one: §4
   * requires a Transition, its Actions, its History and its Audit to commit
   * or roll back in ONE tenant transaction.
   *
   * To run this command inside the Action Engine's single Transition
   * transaction, pass a genuinely transaction-bound resolver — e.g. one built
   * on `resolvePublishedObjectInTransaction(tx, …)`, which reads through the
   * caller's `tx` and nests nothing. That resolver deliberately omits the UI
   * read gate (§46.3, so a Transition may target an object the Actor can
   * create but not read), so the Action Engine MUST re-apply the gate itself —
   * `isReadable`: `canRead && readScope !== 'NONE'` and a title field that is
   * not `HIDDEN` — or it would silently gain read access the Actor does not
   * have.
   */
  resolveScope: (
    context: TenantContext,
    code: string,
    id: string,
    write: boolean,
  ) => Promise<RecordRelationScope>;
  audit: AuditService;
}

/**
 * Creates one Record Relation between two existing records.
 *
 * `success: true` is returned both when the relation was inserted and when the
 * deterministic pair already existed: a duplicate is a no-op and writes no
 * audit row.
 */
export async function createRecordRelationCommand(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  input: CreateRecordRelationCommandInput,
  meta: RecordRelationMeta,
  deps: CreateRecordRelationCommandDeps,
): Promise<{ success: true }> {
  const id = input.id.toLowerCase();
  const recordId = input.recordId.toLowerCase();
  if (id === recordId) throw new ApiException('VALIDATION_FAILED', 400);
  const source = await deps.resolveScope(context, input.code, id, true);
  const target = await deps.resolveScope(
    context,
    input.objectCode,
    recordId,
    false,
  );
  await lockRelationActor(tx, context);
  for (const scope of [source, target].sort((a, b) => a.id.localeCompare(b.id)))
    await checkRelationRecord(tx, context, scope, true);
  const pair = [id, recordId].sort();
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`INSERT INTO record_relations (id,tenant_id,source_record_id,target_record_id) VALUES (${randomUUID()}::uuid,${context.tenantId}::uuid,${pair[0]}::uuid,${pair[1]}::uuid) ON CONFLICT (tenant_id,source_record_id,target_record_id) DO NOTHING RETURNING id`;
  if (rows.length)
    await deps.audit.append(tx, {
      tenantId: context.tenantId,
      actorType: 'USER',
      actorId: context.userId,
      action: 'record.relation_added',
      resourceType: 'record',
      resourceId: id,
      after: { targetRecordId: recordId },
      ...meta,
    });
  return { success: true };
}
