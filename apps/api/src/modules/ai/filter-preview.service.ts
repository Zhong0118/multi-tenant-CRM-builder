import {
  FILTER_FIELD_OPERATORS,
  FILTER_OPERATORS,
  recordFilterFieldType,
  RELATIVE_DATE_PRESETS,
  type FilterCondition,
  type FilterFieldType,
  type FilterPreview,
  type FilterPreviewRequest,
  type FilterRule,
} from '@crm/contracts';
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
import { MembershipsService } from '../memberships/memberships.service';
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

function fieldsFor(
  resolved: ResolvedObjectSchema,
  adminMembers: { key: string; label: string }[],
): FilterModelField[] {
  const members = [
    { key: '$me', label: '我' },
    ...adminMembers,
    ...(resolved.visibleSchema.ownerMembers ?? [])
      .filter((m) => m.status === 'ACTIVE')
      .map((m) => ({ key: m.id, label: m.displayName })),
  ];
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

function choiceLabel(c: FilterCondition, field: FilterModelField) {
  const v = c.value;
  let label = '';
  if (Array.isArray(v))
    label = v
      .map((k) => field.options?.find((o) => o.key === k)?.label ?? k)
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
    private readonly memberships: MembershipsService,
  ) {}

  async preview(
    actor: TenantContext,
    code: string,
    req: FilterPreviewRequest,
  ): Promise<FilterPreview> {
    const initial = await this.objects.resolveRuntimeSchema(actor, code);
    const adminMembers = async () => {
      const options: { key: string; label: string }[] = [];
      if (actor.role === 'TENANT_ADMIN') {
        for (let page = 1; ; page++) {
          const batch = await this.memberships.listMembers(actor, {
            page,
            limit: 100,
            status: 'ACTIVE',
          });
          for (const m of batch.items) {
            if (m.status === 'ACTIVE' && m.displayName)
              options.push({ key: m.id, label: m.displayName });
          }
          if (!batch.items.length || page * 100 >= batch.total) break;
        }
      }
      return options;
    };
    const withMetadata = <T>(
      fn: (
        fields: FilterModelField[],
        validate: (rule: unknown) => Promise<FilterRule>,
        today: string,
      ) => Promise<T>,
    ) =>
      adminMembers().then((roster) =>
        this.records.withTenant(actor, async (store) => {
          const resolved = await store.resolveCurrentObject(initial);
          if (req.baseViewId)
            await store.resolveRecordView(resolved, req.baseViewId);
          const zone = await store.getTenantTimezone?.();
          if (!isValidFollowUpTimeZone(zone ?? null))
            throw new ApiException('INTERNAL_ERROR', 500);
          const fields = fieldsFor(resolved, roster);
          const validate = async (raw: unknown) => {
            const rule = await validateRecordFilterRule(
              raw,
              resolved,
              actor,
              (id) => store.memberExists(id),
            );
            for (const c of rule.conditions) {
              const field =
                'fieldKey' in c &&
                fields.find((f) => f.fieldKey === c.fieldKey);
              if (
                !field ||
                !('fieldKey' in c) ||
                (c.fieldKey === '$followUp' &&
                  typeof c.value === 'object' &&
                  c.value &&
                  'assignee' in c.value &&
                  c.value.assignee === 'any' &&
                  actor.role !== 'TENANT_ADMIN') ||
                ((field.type === 'MEMBER' || field.type === 'OWNER') &&
                  Array.isArray(c.value) &&
                  c.value.some((k) => !field.options?.some((o) => o.key === k)))
              )
                throw new ApiException('RECORD_FILTER_INVALID', 400);
            }
            return rule;
          };
          return fn(fields, validate, localDateAt(new Date(), zone!));
        }),
      );
    try {
      const input = await withMetadata(async (fields, validate, today) => ({
        fields,
        today,
        text: req.text,
        currentRule: await validate(req.currentRule),
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
      return await withMetadata(async (fields, validate) => {
        await validate(input.currentRule);
        const options: { id: string; label: string; value: FilterRule }[] = [];
        for (const item of wire.data.rules) {
          const rule = await validate({
            ...item,
            conditions: item.conditions.map((c) =>
              c.value === null
                ? { fieldKey: c.fieldKey, operator: c.operator }
                : c,
            ),
          });
          if (!rule.conditions.length) return unavailable;
          const labels = [];
          for (const term of rule.conditions as FilterCondition[]) {
            const f = fields.find((field) => field.fieldKey === term.fieldKey)!;
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
            labels.push(choiceLabel(term, f));
          }
          const label = labels
            .sort()
            .join(rule.match === 'all' ? ' 且 ' : ' 或 ');
          if (options.some((o) => o.label === label)) return unavailable;
          options.push({ id: String(options.length + 1), label, value: rule });
        }
        return options.length === 1
          ? { kind: 'rule', rule: options[0]!.value }
          : { kind: 'clarify', options };
      });
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
