import { Prisma } from '@crm/database';
import { z } from 'zod';
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { listPublishedObjectsInTransaction } from '../../objects/published-object.repository';
import {
  isReadable,
  resolvePublishedObjectRecord,
} from '../../objects/published-object.service';
import {
  recordOwnerFilter,
  recordOwnerIds,
} from '../../objects/record-read-scope';

export const groupKeys = ['overdue', 'reclaim', 'stagnant', 'silent'] as const;
export const rulesSchema = z.strictObject({
  version: z.int().nonnegative(),
  objectIds: z.array(z.uuid()).max(1000).nullable(),
  contactDays: z.int().min(1).max(365),
  stagnantDays: z.int().min(1).max(365),
  reclaimDays: z.int().min(1).max(365),
});
type Rules = z.infer<typeof rulesSchema>;
export const defaults: Rules = {
  version: 0,
  objectIds: null,
  contactDays: 14,
  stagnantDays: 14,
  reclaimDays: 3,
};
export async function currentRules(
  tx: Prisma.TransactionClient,
  actor: TenantContext,
) {
  const [row] = await tx.$queryRaw<Rules[]>`
    SELECT version, object_ids AS "objectIds",contact_days AS "contactDays",stagnant_days AS "stagnantDays",reclaim_days AS "reclaimDays"
    FROM daily_brief_settings WHERE tenant_id=${actor.tenantId}::uuid`;
  return row ?? defaults;
}
export async function briefScope(
  tx: Prisma.TransactionClient,
  actor: TenantContext,
) {
  const rules = await currentRules(tx, actor);
  const [date] = await tx.$queryRaw<
    Array<{ localDate: string; timezone: string }>
  >`SELECT timezone,(CURRENT_TIMESTAMP AT TIME ZONE timezone)::date::text AS "localDate" FROM tenants WHERE id=${actor.tenantId}::uuid AND ai_is_member(id,${actor.memberId}::uuid)`;
  if (!date) throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  const objects = (await listPublishedObjectsInTransaction(tx, actor))
    .filter((r) => rules.objectIds === null || rules.objectIds.includes(r.id))
    .map((r) => resolvePublishedObjectRecord(r, actor.role))
    .filter((r) => isReadable(r.schema, r.access));
  return { ...date, rules, objects };
}
export type BriefScope = Awaited<ReturnType<typeof briefScope>>;
export interface BriefRow {
  recordId: string;
  objectId: string;
  ownerMemberId: string;
  inPublicPool: boolean;
  title: string;
  keyDate: Date;
  priority: number;
  total: number;
}
export type Selection =
  | { kind: 'preview' | 'candidates' }
  | { kind: 'page'; priority: number; after?: { date: string; id: string } };
export function briefSql(
  ctx: TenantContext,
  scope: BriefScope,
  selection: Selection,
) {
  const { localDate, timezone, rules } = scope;
  const t = Prisma.sql`${ctx.tenantId}::uuid`,
    me = Prisma.sql`${ctx.memberId}::uuid`;
  const scopes = scope.objects.map(({ schema, access }) => {
    const owners = recordOwnerIds(recordOwnerFilter(access, ctx.memberId));
    const states = schema.workflow?.states ?? [];
    return Prisma.sql`(${schema.object.id}::uuid,${owners}::uuid[],${states.filter((s) => !s.isTerminal).map((s) => s.key)}::text[],${states.filter((s) => s.isTerminal).map((s) => s.key)}::text[])`;
  });
  const day = Prisma.sql`${localDate}::date`;
  const cutoff = (days: number) =>
    Prisma.sql`((${day}+${days}::int)::timestamp AT TIME ZONE ${timezone})`;
  let selectionSql = Prisma.sql`SELECT * FROM ranked WHERE seq<=5`;
  if (selection.kind === 'candidates')
    selectionSql = Prisma.sql`SELECT * FROM ranked ORDER BY priority,at,id LIMIT 30`;
  if (selection.kind === 'page') {
    const after = selection.after;
    selectionSql = Prisma.sql`SELECT * FROM ranked WHERE priority=${selection.priority} ${after ? Prisma.sql`AND (at,id)>(${after.date}::timestamptz,${after.id}::uuid)` : Prisma.empty} ORDER BY at,id LIMIT 21`;
  }
  return Prisma.sql`WITH scopes(object_id,owners,open_states,terminal_states) AS (VALUES ${Prisma.join(scopes)}),
    due AS MATERIALIZED (
      SELECT record_id,min(due_at) AS due_at FROM record_follow_ups
      WHERE tenant_id=${t} AND assignee_member_id=${me} AND status='OPEN' AND due_at<now() GROUP BY record_id
    ), candidates AS MATERIALIZED (
      SELECT r.id,r.object_id,r.created_at,r.status_key,r.pool_stage,r.ownership_expires_at,r.owner_member_id,r.in_public_pool,d.due_at
      FROM records r LEFT JOIN due d ON d.record_id=r.id
      WHERE r.tenant_id=${t} AND r.owner_member_id=${me} AND r.deleted_at IS NULL
      UNION ALL
      SELECT r.id,r.object_id,r.created_at,r.status_key,r.pool_stage,r.ownership_expires_at,r.owner_member_id,r.in_public_pool,d.due_at
      FROM due d JOIN records r ON r.id=d.record_id AND r.tenant_id=${t}
      WHERE r.owner_member_id<>${me} AND r.deleted_at IS NULL
    ), eligible AS MATERIALIZED (
      SELECT r.*,r.status_key=ANY(s.open_states) AS known_state,
        r.pool_stage='FOLLOWING' AND r.ownership_expires_at<${cutoff(rules.reclaimDays + 1)} AS reclaim
      FROM candidates r JOIN scopes s ON s.object_id=r.object_id
      WHERE (s.owners IS NULL OR r.owner_member_id=ANY(s.owners))
        AND (r.status_key IS NULL OR NOT r.status_key=ANY(s.terminal_states))
    ), assess_state AS MATERIALIZED (
      SELECT e.*,CASE WHEN known_state THEN coalesce((SELECT created_at FROM record_transition_histories
        WHERE tenant_id=${t} AND record_id=e.id AND to_state_key=e.status_key ORDER BY created_at DESC LIMIT 1),e.created_at) END AS entered
      FROM eligible e WHERE due_at IS NULL AND owner_member_id=${me} AND NOT in_public_pool AND reclaim IS NOT TRUE
    ), assess_contact AS MATERIALIZED (
      SELECT e.id,coalesce(greatest((SELECT created_at FROM record_activities WHERE tenant_id=${t} AND record_id=e.id
        AND activity_type IN ('CALL','MESSAGE','MEETING','NOTE') ORDER BY created_at DESC LIMIT 1),
        (SELECT completed_at FROM record_follow_ups WHERE tenant_id=${t} AND record_id=e.id AND status='DONE'
         AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1)),e.created_at) AS contacted
      FROM assess_state e WHERE e.entered IS NULL OR e.entered>=${cutoff(1 - rules.stagnantDays)}
    ), matches AS (
      SELECT id,1 AS priority,due_at AS at FROM eligible WHERE due_at IS NOT NULL
      UNION ALL SELECT id,2,ownership_expires_at FROM eligible WHERE owner_member_id=${me} AND NOT in_public_pool AND reclaim
      UNION ALL SELECT id,3,entered FROM assess_state WHERE entered<${cutoff(1 - rules.stagnantDays)}
      UNION ALL SELECT id,4,contacted FROM assess_contact WHERE contacted<${cutoff(1 - rules.contactDays)}
    ), first_match AS (
      SELECT *,row_number() OVER(PARTITION BY id ORDER BY priority) AS first FROM matches
    ), ranked AS (
      SELECT *,count(*) OVER(PARTITION BY priority)::int AS total,row_number() OVER(PARTITION BY priority ORDER BY at,id) AS seq FROM first_match WHERE first=1
    ), selected AS (${selectionSql})
    SELECT r.id AS "recordId",r.object_id AS "objectId",r.owner_member_id AS "ownerMemberId",r.in_public_pool AS "inPublicPool",r.title,s.priority,s.at AS "keyDate",s.total
    FROM selected s JOIN records r ON r.id=s.id AND r.tenant_id=${t} ORDER BY s.priority,s.at,s.id`;
}
export async function readBriefRows(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  scope: BriefScope,
  selection: Selection,
): Promise<BriefRow[]> {
  return scope.objects.length
    ? tx.$queryRaw<BriefRow[]>(briefSql(ctx, scope, selection))
    : [];
}
