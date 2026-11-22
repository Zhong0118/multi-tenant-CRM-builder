import {
  FILTER_FIELD_OPERATORS,
  FILTER_OPERATORS,
  recordFilterFieldType,
  parseFilterRule,
  validateFilterCondition,
  RELATIVE_DATE_PRESETS,
  type FilterCondition,
  type FilterFieldType,
  type FilterPreview,
  type FilterPreviewRequest,
  type FilterRule,
} from '@crm/contracts';
import type { Prisma } from '@crm/database';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import {
  localDateAt,
  isValidFollowUpTimeZone,
} from '../follow-ups/follow-up-workbench-time';
import {
  PublishedObjectService,
  type ResolvedObjectSchema,
} from '../objects/published-object.service';
import { validateRecordFilterRule } from '../records/record-filter';
import { RECORDS_REPOSITORY } from '../records/records.service';
import type { RecordsRepository } from '../records/records.repository';
import { AI_PROVIDER, type AiProvider } from './ai-provider';
import { recordOwnerFilter } from '../objects/record-read-scope';
import { modelFields } from './model-fields';
import { filterWireSchema, type FilterModelField } from './filter-generation';
import { isQuotedNumber } from './communication-field-evidence';

const unavailable = { kind: 'unavailable' } as const;
const relativeLabels: Record<(typeof RELATIVE_DATE_PRESETS)[number], string> = {
  today: '今天',
  yesterday: '昨天',
  this_week: '本周',
  this_month: '本月',
  last_month: '上月',
  past_7_days: '近 7 天',
  past_30_days: '近 30 天',
};

function fieldsFor(resolved: ResolvedObjectSchema): FilterModelField[] {
  const members = [{ key: '$me', label: '我' }];
  return [
    ...modelFields(resolved).map(({ field, metadata }) => ({
      ...metadata,
      operators:
        FILTER_FIELD_OPERATORS[recordFilterFieldType(field) as FilterFieldType],
      ...(field.type === 'MEMBER' ? { options: members } : {}),
    })),
    {
      fieldKey: '$owner',
      label: '负责人',
      type: 'OWNER',
      operators: FILTER_FIELD_OPERATORS.OWNER,
      options: members,
    },
    {
      fieldKey: '$followUp',
      label: '待跟进',
      type: 'FOLLOW_UP',
      operators: FILTER_FIELD_OPERATORS.FOLLOW_UP,
    },
  ];
}

function invalid(): never {
  throw new ApiException('RECORD_FILTER_INVALID', 400);
}

function mapMembers(
  rule: FilterRule,
  fields: FilterModelField[],
  map: (ref: string) => string,
): FilterRule {
  return {
    ...rule,
    conditions: rule.conditions.map((c) => {
      if (!('fieldKey' in c)) return invalid();
      const type = fields.find((f) => f.fieldKey === c.fieldKey)?.type;
      return (type === 'MEMBER' || type === 'OWNER') && Array.isArray(c.value)
        ? { ...c, value: c.value.map(map) }
        : c;
    }),
  };
}

// IDs come only from a validated draft or its request-local handles. Names
// come only from the user's text. All lookups use the current CRM scope.
async function lookupMembers(
  tx: Prisma.TransactionClient,
  actor: TenantContext,
  resolved: ResolvedObjectSchema,
  ids: Set<string>,
  names: Set<string>,
) {
  if (!ids.size && !names.size) return [];
  const scope =
    actor.role === 'TENANT_ADMIN'
      ? undefined
      : resolved.access.readScope === 'GROUP'
        ? recordOwnerFilter(resolved.access, actor.memberId)
        : actor.memberId;
  const whereName = { in: [...names] };
  const rows = await tx.tenantMember.findMany({
    where: {
      tenantId: actor.tenantId,
      id: scope,
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      OR: [
        { id: { in: [...ids] } },
        { displayName: whereName },
        { displayName: null, user: { displayName: whereName } },
      ],
    },
    select: {
      id: true,
      displayName: true,
      user: { select: { displayName: true } },
    },
    take: ids.size + names.size + 1,
  });
  if (rows.length > ids.size + names.size) return invalid();
  return rows.map((m) => ({
    id: m.id,
    name: m.displayName ?? m.user.displayName,
  }));
}

function choiceLabel(
  c: FilterCondition,
  field: FilterModelField,
  memberLabels: Map<string, string>,
) {
  const v = c.value;
  let label = '';
  if (Array.isArray(v))
    label = v
      .map(
        (k) =>
          (field.type === 'MEMBER' || field.type === 'OWNER'
            ? memberLabels.get(k)
            : undefined) ??
          field.options?.find((o) => o.key === k)?.label ??
          k,
      )
      .join('、');
  else if (v && typeof v === 'object')
    label =
      'assignee' in v
        ? v.assignee === '$me'
          ? '我'
          : '任何人'
        : [v.from, v.to].join(' 至 ');
  else if (c.operator === 'relative')
    label = relativeLabels[v as keyof typeof relativeLabels];
  else if (v !== undefined)
    label = typeof v === 'boolean' ? (v ? '是' : '否') : String(v);
  return [field.label, FILTER_OPERATORS[c.operator].label, label]
    .filter(Boolean)
    .join(' ');
}

@Injectable()
export class FilterPreviewService {
  constructor(
    @Inject(RECORDS_REPOSITORY) private readonly records: RecordsRepository,
    private readonly objects: PublishedObjectService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async preview(
    actor: TenantContext,
    code: string,
    req: FilterPreviewRequest,
  ): Promise<FilterPreview> {
    const initial = await this.objects.resolveRuntimeSchema(actor, code);
    const idByHandle = new Map<string, string>();
    const handleById = new Map<string, string>();
    const withMetadata = <T>(
      fn: (
        fields: FilterModelField[],
        validate: (raw: unknown, fromModel?: boolean) => Promise<FilterRule>,
        today: string,
        memberLabels: Map<string, string>,
      ) => Promise<T>,
    ) =>
      this.records.withTenantTransaction(actor, async ({ tx, store }) => {
        const activeActor = await tx.tenantMember.findFirst({
          where: {
            id: actor.memberId,
            tenantId: actor.tenantId,
            userId: actor.userId,
            tenant: { status: 'ACTIVE' },
            role: actor.role,
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
          },
          select: { id: true },
        });
        if (!activeActor) return invalid();
        const resolved = await store.resolveCurrentObject(initial);
        if (req.baseViewId)
          await store.resolveRecordView(resolved, req.baseViewId);
        const zone = await store.getTenantTimezone?.();
        if (!isValidFollowUpTimeZone(zone ?? null))
          throw new ApiException('INTERNAL_ERROR', 500);
        const fields = fieldsFor(resolved);
        const memberLabels = new Map<string, string>();
        const validate = async (raw: unknown, fromModel = false) => {
          const ids = new Set<string>();
          const names = new Set<string>();
          let rule: FilterRule;
          try {
            rule = parseFilterRule(raw);
            for (const c of rule.conditions) {
              if (!('fieldKey' in c)) return invalid();
              const field = fields.find((f) => f.fieldKey === c.fieldKey);
              if (
                !field ||
                (field.type === 'FOLLOW_UP' &&
                  typeof c.value === 'object' &&
                  c.value &&
                  'assignee' in c.value &&
                  c.value.assignee === 'any' &&
                  actor.role !== 'TENANT_ADMIN')
              )
                return invalid();
              if (field.type !== 'MEMBER' && field.type !== 'OWNER') continue;
              if (!fromModel) validateFilterCondition(c, field.type);
              if (!Array.isArray(c.value)) continue;
              for (const ref of c.value) {
                if (ref === '$me') continue;
                const id = fromModel ? idByHandle.get(ref) : ref;
                if (id) ids.add(id);
                else if (
                  ref.length <= 100 &&
                  !ref.includes('\0') &&
                  req.text.includes(ref)
                )
                  names.add(ref);
                else return invalid();
              }
            }
          } catch {
            return invalid();
          }
          const members = await lookupMembers(tx, actor, resolved, ids, names);
          const idByName = new Map<string, string>();
          for (const { id, name } of members) {
            memberLabels.set(id, name);
            if (!names.has(name)) continue;
            if (idByName.has(name)) return invalid();
            idByName.set(name, id);
          }
          const memberIds = new Set(members.map((m) => m.id));
          rule = mapMembers(rule, fields, (ref) => {
            if (ref === '$me') return ref;
            const id = fromModel
              ? (idByHandle.get(ref) ?? idByName.get(ref))
              : ref;
            return id && memberIds.has(id) ? id : invalid();
          });
          return validateRecordFilterRule(rule, resolved, actor, (id) =>
            Promise.resolve(memberIds.has(id)),
          );
        };
        return fn(
          fields,
          validate,
          localDateAt(new Date(), zone!),
          memberLabels,
        );
      });
    try {
      const input = await withMetadata(async (fields, validate, today) => ({
        fields,
        today,
        text: req.text,
        currentRule: mapMembers(
          await validate(req.currentRule),
          fields,
          (id) => {
            if (id === '$me') return id;
            const existing = handleById.get(id);
            if (existing) return existing;
            const handle = `$selected-${randomUUID()}`;
            idByHandle.set(handle, id);
            handleById.set(id, handle);
            return handle;
          },
        ),
        relativeDates: RELATIVE_DATE_PRESETS,
        followUpAssignees:
          actor.role === 'TENANT_ADMIN' ? ['$me', 'any'] : ['$me'],
      }));
      if (!this.provider.generateFilter)
        throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
      if (Buffer.byteLength(JSON.stringify(input)) > 81920)
        throw new ApiException('AI_TOOL_PAYLOAD_LIMIT', 400);
      const signal = AbortSignal.timeout(45000);
      let output: unknown;
      try {
        output = await this.provider.generateFilter(input, signal);
      } catch {
        throw new ApiException(
          signal.aborted ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
          signal.aborted ? 504 : 503,
        );
      }
      const wire = filterWireSchema.safeParse(output);
      if (!wire.success || !wire.data.rules.length) return unavailable;
      return await withMetadata(
        async (fields, validate, _today, memberLabels) => {
          await validate(req.currentRule);
          const options: { id: string; label: string; value: FilterRule }[] =
            [];
          for (const item of wire.data.rules) {
            const rule = await validate(
              {
                ...item,
                conditions: item.conditions.map((c) =>
                  c.value === null
                    ? { fieldKey: c.fieldKey, operator: c.operator }
                    : c,
                ),
              },
              true,
            );
            if (!rule.conditions.length) return unavailable;
            const labels = [];
            for (const term of rule.conditions as FilterCondition[]) {
              const f = fields.find(
                (field) => field.fieldKey === term.fieldKey,
              )!;
              if (
                ['MONEY', 'NUMBER'].includes(f.type) &&
                term.value !== undefined &&
                !input.currentRule.conditions.some(
                  (c) =>
                    'fieldKey' in c &&
                    c.fieldKey === term.fieldKey &&
                    JSON.stringify(c.value) === JSON.stringify(term.value),
                )
              ) {
                const values =
                  typeof term.value === 'object'
                    ? Object.values(term.value)
                    : [term.value];
                if (!values.every((v) => isQuotedNumber(v, req.text, req.text)))
                  return unavailable;
              }
              labels.push(choiceLabel(term, f, memberLabels));
            }
            const label = labels
              .sort()
              .join(rule.match === 'all' ? ' 且 ' : ' 或 ');
            if (options.some((o) => o.label === label)) return unavailable;
            options.push({
              id: String(options.length + 1),
              label,
              value: rule,
            });
          }
          return options.length === 1
            ? { kind: 'rule', rule: options[0].value }
            : { kind: 'clarify', options };
        },
      );
    } catch (error) {
      if (
        error instanceof ApiException &&
        error.code === 'RECORD_FILTER_INVALID'
      )
        return unavailable;
      throw error;
    }
  }
}
