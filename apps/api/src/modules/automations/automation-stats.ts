import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma } from '@crm/database';
import {
  API_ERROR_MESSAGES,
  type ApiErrorCode,
} from '../../common/errors/api-error-code';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { isValidFollowUpTimeZone } from '../follow-ups/follow-up-workbench-time';
import type {
  AutomationRuleStatsDto,
  AutomationStatsDto,
  AutomationStatsQueryDto,
  AutomationStatsEventDto,
  AutomationStatsEventsDto,
  AutomationStatsEventsQueryDto,
} from './automation.dto';

function windowFor(query: AutomationStatsQueryDto) {
  const until = query.until ? new Date(query.until) : new Date();
  if (
    !Number.isFinite(until.getTime()) ||
    until.getTime() > Date.now() ||
    until.getTime() < Date.now() - 90 * 86400000
  )
    throw new ApiException('VALIDATION_FAILED', 400);
  return { from: new Date(until.getTime() - query.days * 86400000), until };
}
async function requireObject(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectId: string,
) {
  const object = await tx.objectDefinition.findFirst({
    where: { tenantId: context.tenantId, id: objectId },
    select: { activePublicationId: true, status: true },
  });
  if (!object) throw new ApiException('OBJECT_NOT_FOUND', 404);
  return object;
}

/** Publication joins bind both audit and success rows to this tenant's source table. */
function eventsSql(
  tenantId: string,
  objectId: string,
  window: ReturnType<typeof windowFor>,
) {
  return Prisma.sql`WITH events AS (
    SELECT e.id, e.rule_key, e.source_record_id, e.target_record_id, e.publication_id,
      e.created_at, 'SUCCEEDED'::text AS status, e.result->>'ruleLabel' AS rule_label,
      e.result->>'targetObjectCode' AS target_object_code,
      e.result->>'targetRecordNo' AS target_record_no, NULL::text AS error_code
    FROM record_automation_executions e
    JOIN object_publications p ON p.tenant_id = e.tenant_id AND p.id = e.publication_id
    WHERE e.tenant_id = ${tenantId}::uuid AND p.object_id = ${objectId}::uuid
      AND e.created_at >= ${window.from} AND e.created_at < ${window.until}
    UNION ALL
    SELECT a.id, a.after->>'ruleKey', a.resource_id, NULL::uuid, p.id, a.created_at,
      CASE WHEN a.action = 'automation.execution_failed' THEN 'FAILED' ELSE 'DEDUPLICATED' END,
      NULL::text, NULL::text, NULL::text,
      CASE WHEN a.action = 'automation.execution_failed' THEN a.after->>'code' END
    FROM audit_logs a
    JOIN object_publications p ON p.tenant_id = a.tenant_id AND p.id::text = a.after->>'publicationId'
    WHERE a.tenant_id = ${tenantId}::uuid AND p.object_id = ${objectId}::uuid
      AND a.resource_type = 'record'
      AND a.action IN ('automation.execution_failed', 'automation.execution_deduplicated')
      AND a.after->>'ruleKey' ~ '^[a-z][a-z0-9-]{0,63}$'
      AND a.created_at >= ${window.from} AND a.created_at < ${window.until}
  )`;
}

export async function readAutomationStats(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectId: string,
  query: AutomationStatsQueryDto,
): Promise<AutomationStatsDto> {
  const object = await requireObject(tx, context, objectId);
  const tenant = await tx.tenant.findUnique({
    where: { id: context.tenantId },
    select: { timezone: true },
  });
  const timezone = tenant?.timezone ?? null;
  if (!isValidFollowUpTimeZone(timezone))
    throw new ApiException('INTERNAL_ERROR', 500, {
      message: '租户时区配置无效，请联系平台管理员。',
    });
  const window = windowFor(query);
  const definitions = await tx.$queryRaw<
    Array<{
      ruleKey: string;
      ruleLabel: string;
      targetObjectCode: string;
      targetObjectName: string | null;
      triggerType: 'MANUAL' | 'FIELD_CHANGED';
      enabled: boolean;
      current: boolean;
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (rule->>'key') rule->>'key' AS "ruleKey", rule->>'label' AS "ruleLabel",
      rule->>'targetObjectCode' AS "targetObjectCode", target_pub.configuration->'object'->>'name' AS "targetObjectName",
      rule->'trigger'->>'type' AS "triggerType", (rule->>'enabled')::boolean AS enabled,
      p.id = ${object.activePublicationId}::uuid AS current
    FROM object_publications p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.configuration->'automations', '[]'::jsonb)) rule
    LEFT JOIN object_definitions target ON target.tenant_id = p.tenant_id AND target.code = rule->>'targetObjectCode'
    LEFT JOIN object_publications target_pub ON target_pub.tenant_id = target.tenant_id AND target_pub.id = target.active_publication_id
    WHERE p.tenant_id = ${context.tenantId}::uuid AND p.object_id = ${objectId}::uuid
    ORDER BY rule->>'key', p.publication_no DESC
  `);
  const counts = await tx.$queryRaw<
    Array<{
      ruleKey: string;
      ruleLabel: string | null;
      succeeded: number;
      failed: number;
      deduplicated: number;
      lastExecutedAt: Date;
    }>
  >(Prisma.sql`${eventsSql(context.tenantId, objectId, window)}
    SELECT rule_key AS "ruleKey", MAX(rule_label) AS "ruleLabel",
      COUNT(*) FILTER (WHERE status = 'SUCCEEDED')::int AS succeeded,
      COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'DEDUPLICATED')::int AS deduplicated,
      MAX(created_at) AS "lastExecutedAt"
    FROM events GROUP BY rule_key
  `);
  const byKey = new Map(counts.map((row) => [row.ruleKey, row]));
  const labels = new Map(definitions.map((row) => [row.ruleKey, row]));
  const items: AutomationRuleStatsDto[] = [
    ...new Set([...labels.keys(), ...byKey.keys()]),
  ]
    .sort()
    .map((ruleKey) => {
      const definition = labels.get(ruleKey);
      const count = byKey.get(ruleKey);
      return {
        ruleKey,
        ruleLabel: definition?.ruleLabel ?? count?.ruleLabel ?? ruleKey,
        targetObjectCode: definition?.targetObjectCode ?? null,
        targetObjectName:
          definition?.targetObjectName ?? definition?.targetObjectCode ?? null,
        triggerType: definition?.triggerType ?? null,
        current: definition?.current ?? false,
        enabled: definition?.enabled ?? false,
        succeeded: count?.succeeded ?? 0,
        failed: count?.failed ?? 0,
        deduplicated: count?.deduplicated ?? 0,
        lastExecutedAt: count?.lastExecutedAt.toISOString() ?? null,
      };
    });
  return {
    timezone,
    days: query.days,
    from: window.from.toISOString(),
    until: window.until.toISOString(),
    deduplicationCoverage: 'SINCE_INSTRUMENTATION',
    totals: items.reduce(
      (total, item) => ({
        succeeded: total.succeeded + item.succeeded,
        failed: total.failed + item.failed,
        deduplicated: total.deduplicated + item.deduplicated,
      }),
      { succeeded: 0, failed: 0, deduplicated: 0 },
    ),
    items,
  };
}

export async function readAutomationStatsEvents(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectId: string,
  ruleKey: string,
  query: AutomationStatsEventsQueryDto,
): Promise<AutomationStatsEventsDto> {
  const object = await requireObject(tx, context, objectId);
  const window = windowFor(query);
  const filter = Prisma.sql`e.rule_key = ${ruleKey} AND (${query.status} = 'ALL' OR e.status = ${query.status})`;
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        context.tenantId,
        objectId,
        ruleKey,
        query.days,
        window.until.toISOString(),
        query.status,
      ]),
    )
    .digest('hex');
  const cursor = query.cursor
    ? decodeCursor(query.cursor, scope, window, query.until)
    : null;
  const after = cursor
    ? Prisma.sql`(e.created_at, e.id, e.status) < (${new Date(cursor.at)}, ${cursor.id}::uuid, ${cursor.status})`
    : Prisma.sql`TRUE`;
  type EventRow = Omit<AutomationStatsEventDto, 'errorMessage'>;
  // One statement gives the count and page the same MVCC snapshot. A fixed
  // window does not freeze visibility: transactions can commit into it later.
  const [result] = await tx.$queryRaw<
    Array<{ total: number; items: EventRow[] }>
  >(Prisma.sql`
    ${eventsSql(context.tenantId, objectId, window)},
    filtered AS MATERIALIZED (SELECT e.* FROM events e WHERE ${filter}),
    page AS (
    SELECT e.id::text AS id, e.rule_key AS "ruleKey",
      COALESCE(e.rule_label, published_rule.value->>'label', e.rule_key) AS "ruleLabel",
      e.status, e.created_at AS "executedAt", e.source_record_id::text AS "sourceRecordId",
      source.record_no::text AS "sourceRecordNo",
      (source.id IS NOT NULL AND source.deleted_at IS NULL AND ${object.status === 'ACTIVE'}) AS "sourceAvailable",
      COALESCE(e.target_object_code, published_rule.value->>'targetObjectCode') AS "targetObjectCode",
      COALESCE(target_pub.configuration->'object'->>'name', e.target_object_code, published_rule.value->>'targetObjectCode') AS "targetObjectName",
      e.target_record_id::text AS "targetRecordId", e.target_record_no AS "targetRecordNo",
      (target.id IS NOT NULL AND target.deleted_at IS NULL AND target_object.status = 'ACTIVE' AND target_object.active_publication_id IS NOT NULL) AS "targetAvailable",
      e.error_code AS "errorCode"
    FROM filtered e
    JOIN object_publications p ON p.tenant_id = ${context.tenantId}::uuid AND p.id = e.publication_id
    LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(COALESCE(p.configuration->'automations', '[]'::jsonb)) WHERE value->>'key' = e.rule_key LIMIT 1) published_rule ON true
    LEFT JOIN records source ON source.tenant_id = ${context.tenantId}::uuid AND source.object_id = ${objectId}::uuid AND source.id = e.source_record_id
    LEFT JOIN records target ON target.tenant_id = ${context.tenantId}::uuid AND target.id = e.target_record_id
    LEFT JOIN object_definitions target_object ON target_object.tenant_id = ${context.tenantId}::uuid AND target_object.code = COALESCE(e.target_object_code, published_rule.value->>'targetObjectCode')
    LEFT JOIN object_publications target_pub ON target_pub.tenant_id = target_object.tenant_id AND target_pub.id = target_object.active_publication_id
    WHERE ${after}
    ORDER BY e.created_at DESC, e.id DESC, e.status DESC LIMIT 21
    )
    SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(page ORDER BY "executedAt" DESC, id DESC, status DESC) FROM page), '[]'::jsonb) AS items
  `);
  const rows = result.items.slice(0, 20);
  const last = rows.at(-1);
  return {
    total: result.total,
    until: window.until.toISOString(),
    nextCursor:
      result.items.length > 20 && last
        ? Buffer.from(
            JSON.stringify({
              scope,
              at: new Date(last.executedAt).toISOString(),
              id: last.id,
              status: last.status,
            }),
          ).toString('base64url')
        : null,
    pageSize: 20,
    items: rows.map((row) => {
      const code =
        row.status !== 'FAILED'
          ? null
          : row.errorCode && Object.hasOwn(API_ERROR_MESSAGES, row.errorCode)
            ? (row.errorCode as ApiErrorCode)
            : 'INTERNAL_ERROR';
      return {
        ...row,
        executedAt: new Date(row.executedAt).toISOString(),
        errorCode: code,
        errorMessage: code ? API_ERROR_MESSAGES[code] : null,
      };
    }),
  };
}

interface StatsCursor {
  scope: string;
  at: string;
  id: string;
  status: string;
}
function decodeCursor(
  value: string,
  scope: string,
  window: ReturnType<typeof windowFor>,
  until?: string,
): StatsCursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<StatsCursor> | null;
    if (
      !until ||
      !cursor ||
      cursor.scope !== scope ||
      typeof cursor.at !== 'string' ||
      typeof cursor.id !== 'string' ||
      !isUUID(cursor.id) ||
      !['SUCCEEDED', 'FAILED', 'DEDUPLICATED'].includes(cursor.status ?? '')
    )
      throw new Error('Invalid cursor');
    const at = new Date(cursor.at);
    if (
      at.toISOString() !== cursor.at ||
      at < window.from ||
      at >= window.until
    )
      throw new Error('Invalid cursor date');
    return cursor as StatsCursor;
  } catch {
    throw new ApiException('VALIDATION_FAILED', 400);
  }
}
