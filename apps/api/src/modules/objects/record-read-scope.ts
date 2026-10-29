import type { Prisma } from '@crm/database';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from './effective-access';

export type RecordOwnerFilter = string | { in: string[] };

export interface GroupOwnerMember {
  id: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
}

/** Resolve once per runtime access check, never cache membership in a publication. */
export async function resolveGroupOwnerMembers(
  tx: Prisma.TransactionClient,
  context: TenantContext,
): Promise<GroupOwnerMember[] | undefined> {
  if (context.role !== 'EMPLOYEE') return undefined;
  const members = await tx.$queryRaw<GroupOwnerMember[]>`
    SELECT owner.id, COALESCE(owner.display_name, owner_user.display_name) AS "displayName",
      CASE WHEN owner_user.status = 'ACTIVE' THEN owner.status ELSE 'DISABLED'::"MemberStatus" END AS status
    FROM member_groups g
    JOIN tenant_members leader ON leader.tenant_id = g.tenant_id
      AND leader.id = g.leader_member_id AND leader.group_id = g.id
    JOIN users u ON u.id = leader.user_id
    JOIN tenant_members owner ON owner.tenant_id = g.tenant_id
      AND owner.group_id = g.id AND owner.role = 'EMPLOYEE'
    JOIN users owner_user ON owner_user.id = owner.user_id
    WHERE g.tenant_id = ${context.tenantId}::uuid
      AND leader.id = ${context.memberId}::uuid
      AND leader.user_id = ${context.userId}::uuid
      AND leader.role = 'EMPLOYEE' AND leader.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
    ORDER BY owner.id`;
  return members.length ? members : undefined;
}

export async function resolveGroupOwnerMemberIds(
  tx: Prisma.TransactionClient,
  context: TenantContext,
): Promise<string[] | undefined> {
  return (await resolveGroupOwnerMembers(tx, context))?.map(
    (member) => member.id,
  );
}

/** Undefined alone means unrestricted. Empty GROUP/NONE sets always deny. */
export function recordOwnerFilter(
  access: Pick<
    EffectiveObjectAccess,
    | 'readScope'
    | 'updateScope'
    | 'groupOwnerMemberIds'
    | 'groupTitleHidden'
    | 'ownTitleHidden'
  >,
  memberId: string,
  write = false,
): RecordOwnerFilter | undefined {
  let ids: string[] | undefined;
  switch (access.readScope) {
    case 'ALL':
      ids = undefined;
      break;
    case 'OWN':
      ids = [memberId];
      break;
    case 'GROUP':
      ids = access.groupTitleHidden
        ? [memberId]
        : (access.groupOwnerMemberIds ?? []);
      if (access.ownTitleHidden) ids = ids.filter((id) => id !== memberId);
      break;
    default:
      ids = [];
  }
  if (write && access.updateScope !== 'ALL')
    ids =
      access.updateScope === 'OWN' &&
      (ids === undefined || ids.includes(memberId))
        ? [memberId]
        : [];
  return ids === undefined
    ? undefined
    : ids.length === 1
      ? ids[0]
      : { in: ids };
}

export function recordOwnerMatches(
  filter: RecordOwnerFilter | null | undefined,
  ownerMemberId: string | null,
): boolean {
  if (filter === undefined) return true;
  if (filter === null || typeof filter === 'string')
    return filter === ownerMemberId;
  return ownerMemberId !== null && filter.in.includes(ownerMemberId);
}

/** Parameter form for tagged SQL lock queries; null alone means unrestricted. */
export function recordOwnerIds(
  filter: RecordOwnerFilter | undefined,
): string[] | null {
  return filter === undefined
    ? null
    : typeof filter === 'string'
      ? [filter]
      : filter.in;
}
