import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';
import { createHash, randomUUID } from 'node:crypto';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { lockRuntimeObjectConfiguration } from '../objects/object-configuration-lock';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import { resolveReadablePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { lockMembers } from '../records/record-ownership-locks';
import type { CreateRecordViewDto, UpdateRecordViewDto } from './dto';
import {
  emptyRecordViewRule,
  resolveViewSettings,
  type StoredSettings,
} from './record-view-settings';

type Tx = Prisma.TransactionClient;
type View = Prisma.ViewDefinitionGetPayload<object>;
const presets = ['all', 'my_records', 'today_follow_up'];
const unavailableReason = '该视图条件不可用';

function conflict(
  message = '该视图已被修改，请重新加载或另存为个人视图。',
): never {
  throw new ApiException('CONFIG_VERSION_CONFLICT', 409, { message });
}

function whereVisible(
  context: TenantContext,
  objectId: string,
): Prisma.ViewDefinitionWhereInput {
  return {
    tenantId: context.tenantId,
    objectId,
    status: 'ACTIVE',
    OR: [
      { scope: 'SHARED' },
      { scope: 'PERSONAL', ownerMemberId: context.memberId },
    ],
  };
}

async function findView(
  tx: Tx,
  context: TenantContext,
  resolved: ResolvedObjectSchema,
  id: string,
) {
  const view = await tx.viewDefinition.findFirst({
    where: { ...whereVisible(context, resolved.schema.object.id), id },
  });
  if (!view)
    throw new ApiException('RECORD_NOT_FOUND', 404, {
      message: '未找到该视图。',
    });
  return view;
}

function memberLookup(tx: Tx, context: TenantContext) {
  const cache = new Map<string, Promise<boolean>>();
  return (id: string) => {
    let exists = cache.get(id);
    if (!exists) {
      exists = tx.tenantMember
        .findFirst({
          where: {
            tenantId: context.tenantId,
            id,
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
          },
          select: { id: true },
        })
        .then((member) => member !== null);
      cache.set(id, exists);
    }
    return exists;
  };
}

function canEdit(view: View, context: TenantContext) {
  return view.scope === 'SHARED'
    ? context.role === 'TENANT_ADMIN'
    : view.scope === 'PERSONAL' && view.ownerMemberId === context.memberId;
}

async function present(
  view: View,
  resolved: ResolvedObjectSchema,
  context: TenantContext,
  memberExists: ReturnType<typeof memberLookup>,
) {
  const { id, code, name, scope, revision } = view;
  const info = {
    id,
    code,
    name,
    scope,
    revision,
    canEdit: canEdit(view, context),
  };
  try {
    return {
      ...info,
      available: true as const,
      ...(await resolveViewSettings(view, resolved, context, memberExists)),
    };
  } catch (error) {
    if (!(error instanceof ApiException) || error.getStatus() !== 400)
      throw error;
    return { ...info, available: false as const, unavailableReason };
  }
}

/** Runs inside the records query transaction, after resolving current field permissions. */
export async function resolveRecordViewQuery(
  tx: Tx,
  context: TenantContext,
  resolved: ResolvedObjectSchema,
  viewId: string,
) {
  await lockMembers(tx, context);
  const view = await findView(tx, context, resolved, viewId);
  const projected = await present(
    view,
    resolved,
    context,
    memberLookup(tx, context),
  );
  if (!projected.available)
    throw new ApiException('RECORD_FILTER_INVALID', 400, {
      message: unavailableReason,
    });
  return projected;
}

const defaults = {
  filterRule: emptyRecordViewRule,
  queryOptions: {},
  columnFieldKeys: null,
  columnWidths: {},
  sort: null,
};
function applySettings(
  base: StoredSettings,
  input: Partial<StoredSettings>,
): StoredSettings {
  // Transformed DTO instances contain undefined properties for omitted JSON keys.
  return {
    filterRule:
      input.filterRule === undefined ? base.filterRule : input.filterRule,
    queryOptions:
      input.queryOptions === undefined ? base.queryOptions : input.queryOptions,
    columnWidths:
      input.columnWidths === undefined ? base.columnWidths : input.columnWidths,
    columnFieldKeys:
      input.columnFieldKeys === undefined
        ? base.columnFieldKeys
        : input.columnFieldKeys,
    sort: input.sort === undefined ? base.sort : input.sort,
  };
}
function json(value: unknown) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}
function viewName(value: string) {
  const name = value.trim();
  if (!name) throw new ApiException('VALIDATION_FAILED', 400);
  return name;
}

@Injectable()
export class RecordViewsService {
  constructor(private readonly runner: DatabaseContextRunner) {}

  private withObject<T>(
    context: TenantContext,
    code: string,
    work: (tx: Tx, resolved: ResolvedObjectSchema) => Promise<T>,
  ) {
    return this.runner.withTenant(context, async (tx) => {
      await lockRuntimeObjectConfiguration(tx, context.tenantId);
      await lockMembers(tx, context);
      const resolved = await resolveReadablePublishedObjectInTransaction(
        tx,
        context,
        code,
      );
      return work(tx, resolved);
    });
  }

  list(context: TenantContext, code: string) {
    return this.withObject(context, code, async (tx, resolved) => {
      const views = await tx.viewDefinition.findMany({
        where: whereVisible(context, resolved.schema.object.id),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const rank = (view: View) => {
        const i = presets.indexOf(view.code);
        return i === -1 ? presets.length : i;
      };
      const memberExists = memberLookup(tx, context);
      views.sort((a, b) => rank(a) - rank(b));
      return {
        items: await Promise.all(
          views.map((view) => present(view, resolved, context, memberExists)),
        ),
      };
    });
  }

  get(context: TenantContext, code: string, id: string) {
    return this.withObject(context, code, async (tx, resolved) =>
      present(
        await findView(tx, context, resolved, id),
        resolved,
        context,
        memberLookup(tx, context),
      ),
    );
  }

  create(
    context: TenantContext,
    objectCode: string,
    input: CreateRecordViewDto,
  ) {
    return this.withObject(context, objectCode, async (tx, resolved) => {
      if (input.scope === 'SHARED' && context.role !== 'TENANT_ADMIN')
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      if (
        input.importKey !== undefined &&
        (input.scope !== 'PERSONAL' || !input.importKey.trim())
      )
        throw new ApiException('VALIDATION_FAILED', 400);
      const memberExists = memberLookup(tx, context);
      const settings = applySettings(defaults, input);
      const valid = await resolveViewSettings(
        settings,
        resolved,
        context,
        memberExists,
        input,
      );
      const code = input.importKey
        ? 'import_' +
          createHash('sha256')
            .update(context.memberId + '\0' + input.importKey)
            .digest('hex')
            .slice(0, 56)
        : 'view_' + randomUUID();
      const data = {
        tenantId: context.tenantId,
        objectId: resolved.schema.object.id,
        code,
        name: viewName(input.name),
        scope: input.scope,
        ownerMemberId: input.scope === 'PERSONAL' ? context.memberId : null,
        filterRule: json(valid.filterRule),
        sort: json(settings.sort),
        queryOptions: json(valid.queryOptions),
        columnFieldKeys: json(settings.columnFieldKeys),
        columnWidths: json(valid.columnWidths),
      };
      let view: View;
      if (input.importKey) {
        await tx.viewDefinition.createMany({
          data: [data],
          skipDuplicates: true,
        });
        const existing = await tx.viewDefinition.findFirst({
          where: {
            ...whereVisible(context, data.objectId),
            code,
            scope: 'PERSONAL',
            ownerMemberId: context.memberId,
          },
        });
        if (!existing) conflict('该本机方案已导入并归档。');
        view = existing;
      } else {
        view = await tx.viewDefinition.create({ data });
      }
      const result = await present(view, resolved, context, memberExists);
      if (!result.available)
        throw new ApiException('RECORD_FILTER_INVALID', 400, {
          message: unavailableReason,
        });
      return result;
    });
  }

  update(
    context: TenantContext,
    code: string,
    id: string,
    input: UpdateRecordViewDto,
  ) {
    return this.withObject(context, code, async (tx, resolved) => {
      const view = await findView(tx, context, resolved, id);
      if (!canEdit(view, context))
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      if (view.revision !== input.expectedRevision) conflict();
      const memberExists = memberLookup(tx, context);
      const valid = await resolveViewSettings(
        applySettings(view, input),
        resolved,
        context,
        memberExists,
        input,
      );
      const updated = await tx.viewDefinition.updateManyAndReturn({
        where: {
          ...whereVisible(context, view.objectId),
          id,
          revision: input.expectedRevision,
        },
        data: {
          revision: { increment: 1 },
          ...(input.name !== undefined && { name: viewName(input.name) }),
          ...(input.filterRule !== undefined && {
            filterRule: json(valid.filterRule),
          }),
          ...(input.columnWidths !== undefined && {
            columnWidths: json(valid.columnWidths),
          }),
          ...(input.columnFieldKeys !== undefined && {
            columnFieldKeys: json(input.columnFieldKeys),
          }),
          ...(input.queryOptions !== undefined && {
            queryOptions: json(valid.queryOptions),
          }),
          ...(input.sort !== undefined && { sort: json(input.sort) }),
        },
      });
      if (!updated.length) conflict();
      return present(updated[0], resolved, context, memberExists);
    });
  }

  archive(
    context: TenantContext,
    code: string,
    id: string,
    expectedRevision?: number,
  ) {
    return this.withObject(context, code, async (tx, resolved) => {
      const view = await findView(tx, context, resolved, id);
      if (!canEdit(view, context))
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      const updated = await tx.viewDefinition.updateMany({
        where: {
          ...whereVisible(context, view.objectId),
          id,
          revision: expectedRevision ?? view.revision,
        },
        data: { status: 'INACTIVE', revision: { increment: 1 } },
      });
      if (!updated.count) conflict();
    });
  }
}
