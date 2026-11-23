import { Prisma } from '@crm/database';
import { z } from 'zod';
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { PublishedField } from '../../objects/object-schema';
import { selectOptions } from '../../records/record-value-engine';
import { recordFieldAccess } from '../../objects/effective-access';
import { resolveReadableObjectByIdInTransaction } from '../../objects/published-object-transaction';
import { recordOwnerFilter } from '../../objects/record-read-scope';
import { inputs, outputs } from './admin.contract';
import { invalid, type Tx } from './admin-usage';

type Entry = z.infer<typeof outputs.operations>['items'][number];
const summary = Prisma.sql`r.id,r.member_id AS "memberId",r.feature,r.source,r.status,r.confirmed_by_member_id AS "confirmedByMemberId",
 to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;
const cursorSchema = z.strictObject({ time: z.iso.datetime(), id: z.uuid() });
export function cursorValue(cursor: string) {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
  } catch {
    throw new ApiException('AI_CURSOR_INVALID', 400);
  }
}
export async function listOperations(
  tx: Tx,
  c: TenantContext,
  q: z.infer<typeof inputs.operations>,
) {
  if (q.from && q.to && q.from > q.to) invalid('开始日期不能晚于结束日期。');
  const after = q.cursor ? cursorValue(q.cursor) : null;
  const conditions = [Prisma.sql`r.tenant_id=${c.tenantId}::uuid`];
  if (q.memberId) conditions.push(Prisma.sql`r.member_id=${q.memberId}::uuid`);
  if (q.operationType) {
    conditions.push(Prisma.sql`(r.changes->>'operationType'=${q.operationType} OR EXISTS
      (SELECT 1 FROM jsonb_each(COALESCE(r.changes->'items','{}'::jsonb)) item
       WHERE item.value->>'operationType'=${q.operationType}))`);
  }
  if (q.feature) conditions.push(Prisma.sql`r.feature=${q.feature}`);
  if (q.status) conditions.push(Prisma.sql`r.status=${q.status}`);
  if (q.source) conditions.push(Prisma.sql`r.source=${q.source}`);
  if (q.from)
    conditions.push(
      Prisma.sql`r.created_at >= (${q.from}::date::timestamp AT TIME ZONE t.timezone)`,
    );
  if (q.to)
    conditions.push(
      Prisma.sql`r.created_at < ((${q.to}::date+1)::timestamp AT TIME ZONE t.timezone)`,
    );
  if (after)
    conditions.push(
      Prisma.sql`(r.created_at,r.id)<(${after.time}::timestamptz,${after.id}::uuid)`,
    );
  const rows = await tx.$queryRaw<
    Entry[]
  >(Prisma.sql`SELECT ${summary} FROM ai_operation_records r JOIN tenants t ON t.id=r.tenant_id
 WHERE ${Prisma.join(conditions, ' AND ')} ORDER BY r.created_at DESC,r.id DESC LIMIT ${q.limit + 1}`);
  const items = rows.slice(0, q.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last && rows.length > q.limit
        ? Buffer.from(
            JSON.stringify({ time: last.createdAt, id: last.id }),
          ).toString('base64url')
        : null,
  };
}

const storedChange = z.object({
  fieldKey: z.string().optional(),
  label: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
});
const storedItem = z.object({
  operationType: z.enum([
    'UPDATE_RECORD',
    'CREATE_FOLLOW_UP',
    'ADD_ACTIVITY_NOTE',
  ]),
  status: z.string().optional(),
  changes: z.array(storedChange),
});
export function permittedChanges(
  source: string,
  status: string,
  stored: unknown,
  visible: ReadonlyMap<string, Pick<PublishedField, 'type' | 'config'>>,
) {
  let complete = true;
  const container = z
    .object({ items: z.record(z.string(), z.unknown()) })
    .safeParse(stored);
  const items =
    source === 'draft'
      ? container.success
        ? Object.values(container.data.items)
        : []
      : [stored];
  const result = items.flatMap((value) => {
    const parsed = storedItem.safeParse(value);
    if (!parsed.success) {
      complete = false;
      return [];
    }
    const item = parsed.data;
    const changes = item.changes.flatMap(({ fieldKey, ...change }) => {
      if (item.operationType !== 'UPDATE_RECORD') return [change];
      const field = fieldKey ? visible.get(fieldKey) : undefined;
      if (!field) {
        complete = false;
        return [];
      }
      if (field.type === 'SINGLE_SELECT') {
        const options = selectOptions(field);
        const optionLabel = (key: string) =>
          options.find((option) => option.key === key)?.label ??
          `${key}（选项已删除）`;
        if (change.before) change.before = optionLabel(change.before);
        if (change.after) change.after = optionLabel(change.after);
      }
      return [change];
    });
    return [
      {
        operationType: item.operationType,
        status: item.status ?? status,
        changes,
      },
    ];
  });
  return { items: result, complete };
}
type DetailRow = Entry & {
  objectId: string | null;
  recordId: string | null;
  requestText: string | null;
  auditId: string | null;
  requestId: string | null;
  changes: unknown;
};
export async function operationDetail(tx: Tx, c: TenantContext, id: string) {
  const [row] = await tx.$queryRaw<
    DetailRow[]
  >(Prisma.sql`SELECT ${summary},r.object_id AS "objectId",r.record_id AS "recordId",r.request_text AS "requestText",
 r.audit_id AS "auditId",r.request_id AS "requestId",r.changes FROM ai_operation_records r WHERE r.tenant_id=${c.tenantId}::uuid AND r.id=${id}::uuid`);
  if (!row)
    throw new ApiException('OBJECT_NOT_FOUND', 404, {
      message: '未找到这条 AI 操作记录。',
    });
  const {
    objectId,
    recordId,
    requestText,
    auditId,
    requestId,
    changes,
    ...entry
  } = row;
  const redacted = {
    ...entry,
    objectId: null,
    objectCode: null,
    recordId: null,
    requestText: null,
    items: [],
    auditId: null,
    requestId,
  };
  if (!objectId) return redacted;
  if (row.source === 'blueprint') {
    // The administrator's draft editor also permits unpublished live objects.
    const object = await tx.objectDefinition.findFirst({
      where: {
        id: objectId,
        tenantId: c.tenantId,
        deletedAt: null,
        archivedAt: null,
      },
      select: { code: true },
    });
    return object
      ? { ...redacted, objectId, objectCode: object.code, auditId }
      : redacted;
  }
  if (!recordId) return redacted;
  try {
    const resolved = await resolveReadableObjectByIdInTransaction(
      tx,
      c,
      objectId,
    );
    const record = await tx.record.findFirst({
      where: {
        id: recordId,
        tenantId: c.tenantId,
        objectId,
        deletedAt: null,
        ownerMemberId: recordOwnerFilter(resolved.access, c.memberId),
      },
      select: { ownerMemberId: true, inPublicPool: true },
    });
    if (!record) return redacted;
    const access = recordFieldAccess(resolved.access, record);
    const fields = new Map(
      resolved.schema.fields
        .filter((f) => access[f.fieldKey] && access[f.fieldKey] !== 'HIDDEN')
        .map((f) => [f.fieldKey, f]),
    );
    const display = permittedChanges(row.source, row.status, changes, fields);
    // A free-text question may name fields outside the proposed diff.
    const allVisible =
      display.complete && fields.size === resolved.schema.fields.length;
    return {
      ...entry,
      objectId,
      objectCode: resolved.schema.object.code,
      recordId,
      requestText: allVisible ? requestText : null,
      items: display.items,
      auditId,
      requestId,
    };
  } catch (error) {
    if (
      error instanceof ApiException &&
      ([403, 404].includes(error.getStatus()) ||
        error.code === 'OBJECT_ARCHIVED' ||
        error.code === 'OBJECT_NOT_PUBLISHED')
    )
      return redacted;
    throw error;
  }
}
