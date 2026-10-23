import type { Prisma } from '@crm/database';

import type { PlatformAuditItem } from './platform-operations.types';

/**
 * Turns raw tenant audit rows into what an administrator can read: the acting
 * member's name, the resource's own name (record title, business table, member,
 * dashboard, follow-up…) and, when a row carries both `before` and `after`, the
 * keys that changed with record field labels and option / member names.
 *
 * Every lookup is one batched query per resource kind for the whole page, run
 * inside the caller's tenant transaction, so RLS and the explicit `tenantId`
 * filter keep it to the caller's company exactly like the audit rows.
 */
export interface CompanyAuditChange {
  key: string;
  label: string | null;
  before: unknown;
  after: unknown;
}

export interface CompanyAuditItem extends PlatformAuditItem {
  resourceName: string | null;
  objectName: string | null;
  recordTitle: string | null;
  changes: CompanyAuditChange[] | null;
}

export interface AuditRow {
  id: string;
  tenantId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'INTEGRATION';
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string;
  ip: string | null;
  createdAt: Date;
}

interface FieldInfo {
  label: string;
  type: string;
  options: Map<string, string>;
}

/** Bookkeeping keys that change on every write and say nothing to a reader. */
const IGNORED_CHANGE_KEYS = new Set([
  'version',
  'draftVersion',
  'objectVersion',
  'recordVersionBefore',
  'recordVersionAfter',
  'updatedAt',
]);

/** Record-level keys worth showing next to the field values. */
const RECORD_CHANGE_KEYS = [
  'ownerMemberId',
  'inPublicPool',
  'ownershipExpiresAt',
  'poolStage',
];

const OBJECT_RESOURCES = new Set([
  'object_definition',
  'object',
  'object_permission',
]);
const RECORD_CHILD_RESOURCES = new Set([
  'record_attachment',
  'record_activity',
  'record_follow_up',
]);

export async function presentCompanyAudit(
  tx: Prisma.TransactionClient,
  tenant: { id: string; name: string | null },
  rows: AuditRow[],
): Promise<CompanyAuditItem[]> {
  const tenantId = tenant.id;
  const actorIds = unique(
    rows.flatMap((row) =>
      row.actorType === 'USER' && row.actorId ? [row.actorId] : [],
    ),
  );
  const idsOf = (types: string | Set<string>) =>
    unique(
      rows.flatMap((row) =>
        (typeof types === 'string'
          ? row.resourceType === types
          : types.has(row.resourceType)) && row.resourceId
          ? [row.resourceId]
          : [],
      ),
    );

  const followUps = await when(idsOf('record_follow_up'), (ids) =>
    tx.recordFollowUp.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, title: true, recordId: true },
    }),
  );
  const followUpById = new Map(followUps.map((item) => [item.id, item]));

  const recordIds = unique([
    ...idsOf('record'),
    ...rows.flatMap((row) =>
      RECORD_CHILD_RESOURCES.has(row.resourceType)
        ? [payloadString(row, 'recordId')]
        : [],
    ),
    ...followUps.map((item) => item.recordId),
  ]);
  const memberIds = unique([
    ...idsOf('tenant_member'),
    ...rows.flatMap((row) => memberIdsIn(row)),
  ]);

  const [records, members, users, dashboards, publications, invitations] =
    await Promise.all([
      when(recordIds, (ids) =>
        tx.record.findMany({
          where: { tenantId, id: { in: ids } },
          select: { id: true, title: true, objectId: true },
        }),
      ),
      when(unique([...actorIds, ...memberIds]), () =>
        tx.tenantMember.findMany({
          where: {
            tenantId,
            OR: [{ userId: { in: actorIds } }, { id: { in: memberIds } }],
          },
          select: {
            id: true,
            userId: true,
            displayName: true,
            user: { select: { displayName: true } },
          },
        }),
      ),
      when(actorIds, (ids) =>
        tx.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true },
        }),
      ),
      when(idsOf('dashboard_definition'), (ids) =>
        tx.tenantDashboardConfiguration.findMany({
          where: { tenantId, id: { in: ids } },
          select: { id: true, name: true },
        }),
      ),
      when(idsOf('dashboard_publication'), (ids) =>
        tx.tenantDashboardPublication.findMany({
          where: { tenantId, id: { in: ids } },
          select: { id: true, definition: { select: { name: true } } },
        }),
      ),
      when(idsOf('tenant_invitation'), (ids) =>
        tx.tenantInvitation.findMany({
          where: { tenantId, id: { in: ids } },
          select: { id: true, displayName: true, targetPhone: true },
        }),
      ),
    ]);
  const recordById = new Map(records.map((item) => [item.id, item]));

  const objectIds = unique([
    ...idsOf(OBJECT_RESOURCES),
    ...records.map((item) => item.objectId),
    ...rows.flatMap((row) =>
      row.resourceType === 'record' ? [payloadString(row, 'objectId')] : [],
    ),
  ]);
  const fieldObjectIds = unique(
    rows.flatMap((row) =>
      row.resourceType === 'record' && hasBeforeAndAfter(row)
        ? [recordObjectId(row, recordById)]
        : [],
    ),
  );
  const [objects, fields] = await Promise.all([
    when(objectIds, (ids) =>
      tx.objectDefinition.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, name: true },
      }),
    ),
    when(fieldObjectIds, (ids) =>
      tx.fieldDefinition.findMany({
        where: { tenantId, objectId: { in: ids } },
        select: {
          objectId: true,
          fieldKey: true,
          label: true,
          type: true,
          config: true,
        },
      }),
    ),
  ]);

  const memberNameById = new Map(
    members.map((item) => [item.id, item.displayName ?? item.user.displayName]),
  );
  const memberNameByUser = new Map(
    members.map((item) => [
      item.userId,
      item.displayName ?? item.user.displayName,
    ]),
  );
  const userNameById = new Map(
    users.map((item) => [item.id, item.displayName]),
  );
  const objectNameById = new Map(objects.map((item) => [item.id, item.name]));
  const dashboardNameById = new Map(
    dashboards.map((item) => [item.id, item.name]),
  );
  const publicationNameById = new Map(
    publications.map((item) => [item.id, item.definition.name]),
  );
  const invitationNameById = new Map(
    invitations.map((item) => [
      item.id,
      item.displayName ?? maskedPhone(item.targetPhone),
    ]),
  );
  const fieldsByObject = new Map<string, Map<string, FieldInfo>>();
  for (const field of fields) {
    const byKey =
      fieldsByObject.get(field.objectId) ?? new Map<string, FieldInfo>();
    byKey.set(field.fieldKey, {
      label: field.label,
      type: field.type,
      options: fieldOptions(field.config),
    });
    fieldsByObject.set(field.objectId, byKey);
  }

  return rows.map((row) => {
    const names = describeResource(row);
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: tenant.name,
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: row.actorId
        ? (memberNameByUser.get(row.actorId) ??
          userNameById.get(row.actorId) ??
          null)
        : null,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      before: row.before,
      after: row.after,
      reason: row.reason,
      requestId: row.requestId,
      ip: row.ip,
      createdAt: row.createdAt,
      ...names,
      changes: changesOf(row),
    };
  });

  function describeResource(
    row: AuditRow,
  ): Pick<CompanyAuditItem, 'resourceName' | 'objectName' | 'recordTitle'> {
    const id = row.resourceId ?? '';
    const objectOfRecord = (recordId: string | undefined) => {
      const record = recordId ? recordById.get(recordId) : undefined;
      return {
        record,
        objectName: record
          ? (objectNameById.get(record.objectId) ?? null)
          : null,
      };
    };
    switch (row.resourceType) {
      case 'record': {
        const { record } = objectOfRecord(id);
        const objectId = recordObjectId(row, recordById);
        return {
          resourceName: record?.title ?? payloadString(row, 'title') ?? null,
          objectName: objectId ? (objectNameById.get(objectId) ?? null) : null,
          recordTitle: null,
        };
      }
      case 'record_follow_up': {
        const task = followUpById.get(id);
        const { record, objectName } = objectOfRecord(
          task?.recordId ?? payloadString(row, 'recordId'),
        );
        return {
          resourceName: task?.title ?? payloadString(row, 'title') ?? null,
          objectName,
          recordTitle: record?.title ?? null,
        };
      }
      case 'record_attachment':
      case 'record_activity': {
        const { record, objectName } = objectOfRecord(
          payloadString(row, 'recordId'),
        );
        return {
          resourceName:
            row.resourceType === 'record_attachment'
              ? (payloadString(row, 'filename') ?? null)
              : null,
          objectName,
          recordTitle: record?.title ?? null,
        };
      }
      case 'object_definition':
      case 'object':
      case 'object_permission': {
        const name =
          objectNameById.get(id) ?? payloadString(row, 'name') ?? null;
        return { resourceName: name, objectName: name, recordTitle: null };
      }
      case 'tenant_member':
        return {
          resourceName: memberNameById.get(id) ?? null,
          objectName: null,
          recordTitle: null,
        };
      case 'tenant_invitation':
        return {
          resourceName: invitationNameById.get(id) ?? null,
          objectName: null,
          recordTitle: null,
        };
      case 'dashboard_definition':
        return {
          resourceName:
            dashboardNameById.get(id) ?? payloadString(row, 'name') ?? null,
          objectName: null,
          recordTitle: null,
        };
      case 'dashboard_publication':
        return {
          resourceName: publicationNameById.get(id) ?? null,
          objectName: null,
          recordTitle: null,
        };
      case 'tenant':
        return {
          resourceName: id === tenantId ? tenant.name : null,
          objectName: null,
          recordTitle: null,
        };
      default:
        return { resourceName: null, objectName: null, recordTitle: null };
    }
  }

  function changesOf(row: AuditRow): CompanyAuditChange[] | null {
    const before = jsonObject(row.before);
    const after = jsonObject(row.after);
    if (!before || !after) return null;
    const memberValue = (key: string, value: unknown) =>
      isMemberKey(key) && typeof value === 'string'
        ? (memberNameById.get(value) ?? value)
        : value;

    if (row.resourceType !== 'record') {
      return changedKeys(before, after)
        .filter((key) => !IGNORED_CHANGE_KEYS.has(key))
        .map((key) => ({
          key,
          label: null,
          before: memberValue(key, before[key] ?? null),
          after: memberValue(key, after[key] ?? null),
        }));
    }

    const objectId = recordObjectId(row, recordById);
    const fieldInfo = objectId ? fieldsByObject.get(objectId) : undefined;
    const beforeValues = jsonObject(before.values) ?? {};
    const afterValues = jsonObject(after.values) ?? {};
    const fieldChanges = changedKeys(beforeValues, afterValues).map((key) => {
      const field = fieldInfo?.get(key);
      return {
        key,
        label: field?.label ?? null,
        before: fieldValue(field, beforeValues[key] ?? null),
        after: fieldValue(field, afterValues[key] ?? null),
      };
    });
    const recordChanges = RECORD_CHANGE_KEYS.filter(
      (key) =>
        (key in before || key in after) &&
        !sameJson(before[key] ?? null, after[key] ?? null),
    ).map((key) => ({
      key,
      label: null,
      before: memberValue(key, before[key] ?? null),
      after: memberValue(key, after[key] ?? null),
    }));
    return [...fieldChanges, ...recordChanges];
  }

  function fieldValue(field: FieldInfo | undefined, value: unknown): unknown {
    if (!field || value === null) return value;
    if (field.type === 'SINGLE_SELECT' && typeof value === 'string')
      return field.options.get(value) ?? value;
    if (field.type === 'MULTI_SELECT' && Array.isArray(value))
      return (value as unknown[]).map((item) =>
        typeof item === 'string' ? (field.options.get(item) ?? item) : item,
      );
    if (field.type === 'MEMBER' && typeof value === 'string')
      return memberNameById.get(value) ?? value;
    return value;
  }
}

function memberIdsIn(row: AuditRow): string[] {
  const ids: string[] = [];
  for (const payload of [jsonObject(row.before), jsonObject(row.after)]) {
    if (!payload) continue;
    for (const [key, value] of Object.entries(payload))
      if (isMemberKey(key) && typeof value === 'string') ids.push(value);
    // MEMBER-type record fields hold a member id; collecting every string that
    // looks like a UUID would also pull in relation ids, so only values of
    // record rows are scanned and the lookup simply finds nothing for those.
    const values =
      row.resourceType === 'record' ? jsonObject(payload.values) : null;
    if (values)
      for (const value of Object.values(values))
        if (typeof value === 'string' && UUID.test(value)) ids.push(value);
  }
  return ids;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMemberKey(key: string): boolean {
  return key === 'memberId' || key.endsWith('MemberId');
}

function recordObjectId(
  row: AuditRow,
  recordById: Map<string, { objectId: string }>,
): string | undefined {
  return (
    (row.resourceId ? recordById.get(row.resourceId)?.objectId : undefined) ??
    payloadString(row, 'objectId')
  );
}

function hasBeforeAndAfter(row: AuditRow): boolean {
  return Boolean(jsonObject(row.before) && jsonObject(row.after));
}

function payloadString(row: AuditRow, key: string): string | undefined {
  for (const payload of [jsonObject(row.after), jsonObject(row.before)]) {
    const value = payload?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return unique([...Object.keys(before), ...Object.keys(after)]).filter(
    (key) => !sameJson(before[key] ?? null, after[key] ?? null),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldOptions(config: unknown): Map<string, string> {
  const options = jsonObject(config)?.options;
  const map = new Map<string, string>();
  if (Array.isArray(options))
    for (const option of options) {
      const item = jsonObject(option);
      if (typeof item?.key === 'string' && typeof item.label === 'string')
        map.set(item.key, item.label);
    }
  return map;
}

function maskedPhone(phone: string): string {
  return `尾号 ${phone.slice(-4)}`;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

async function when<T>(
  ids: string[],
  query: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  return ids.length ? query(ids) : [];
}
