import { randomUUID } from 'node:crypto';
import type {
  FieldPlan,
  TableBlueprint,
  TableBuilderAnswer,
  TableBuilderResult,
  TableBuilderTarget,
  TablePlan,
} from '@crm/contracts';
import { z } from 'zod';
import { normalizeOmissions } from './table-omissions';
import { ApiException } from '../../common/errors/api.exception';
import { isPublishedFieldType } from '../objects/object-schema';
import type { AiProvider } from './ai-provider';
import {
  allocateSuggestedCode,
  builtInReason,
  blueprintCode,
  canonicalName,
  type BlueprintMetadata,
} from './table-blueprint';
import {
  tableModelSchema,
  type ModelTable,
  type TableProviderInput,
} from './table-model';

const definitions = [
  {
    key: 'industry',
    prompt: '你主要从事哪个行业？',
    options: [
      { id: 'rental', label: '设备租赁' },
      { id: 'education', label: '教育培训' },
      { id: 'services', label: '专业服务' },
      { id: 'trade', label: '贸易' },
      { id: 'other', label: '其他' },
    ],
  },
  {
    key: 'entities',
    prompt: '你最想管理哪类业务资料？',
    options: [
      { id: 'customers', label: '客户' },
      { id: 'contracts', label: '合同' },
      { id: 'projects', label: '项目' },
      { id: 'other', label: '其他' },
    ],
  },
] satisfies Omit<Extract<TableBuilderResult, { kind: 'question' }>, 'kind'>[];
const answerSchema = z
  .array(
    z.strictObject({
      key: z.enum(['industry', 'entities']),
      choiceId: z.string().max(32),
      otherText: z.string().trim().min(1).max(300).optional(),
    }),
  )
  .max(2);
function invalid(path: string, message: string): never {
  throw new ApiException('VALIDATION_FAILED', 400, {
    message,
    fieldErrors: { [path]: [message] },
  });
}
export function validateAnswers(
  answers: TableBuilderAnswer[] = [],
): TableBuilderAnswer[] {
  const parsed = answerSchema.safeParse(answers);
  if (!parsed.success)
    invalid('answers', '请使用当前问题的选项，其他答案限 1–300 字。');
  parsed.data.forEach((a, i) => {
    const question = definitions[i];
    if (
      question.key !== a.key ||
      !question.options.some((o) => o.id === a.choiceId) ||
      (a.choiceId === 'other') !== !!a.otherText
    )
      invalid('answers.' + i, '答案顺序或内容无效，请按顺序回答问题。');
  });
  return parsed.data;
}
export interface TableGenerationInput {
  mode: 'create' | 'refine' | 'append';
  description: string;
  existing: BlueprintMetadata[];
  answers?: TableBuilderAnswer[];
  table?: TablePlan;
  omitted?: TableBlueprint['omitted'];
  target?: TableBuilderTarget;
}
// For refinements the provider receives only these editable properties. Even the
// target table's database ID and existing field keys stay outside the prompt.
function modelTable(t: TablePlan, codeSuggestion: string): ModelTable {
  return {
    name: t.name,
    codeSuggestion,
    description: t.description ?? null,
    icon: t.icon ?? null,
    reason: t.reason,
    fields: t.fields.map((f) => ({
      ref: f.id,
      fieldKeySuggestion: f.fieldKey,
      label: f.label,
      type: f.type,
      required: f.required,
      reason: f.reason,
      options: (f.options ?? []).map((o) => ({
        ref: o.id,
        label: o.label,
        reason: o.reason,
      })),
      validation: f.validation
        ? {
            minLength: f.validation.minLength ?? null,
            maxLength: f.validation.maxLength ?? null,
            min: f.validation.min ?? null,
            max: f.validation.max ?? null,
            scale: f.validation.scale ?? null,
            country: f.validation.country ?? null,
          }
        : null,
    })),
    titleRef: t.titleFieldId || null,
    columnRefs: t.view.columnIds,
    viewReason: t.view.reason,
    employeeIntent: t.employeeIntent.map(
      ({ request, reason, recommendation }) => ({
        request,
        reason,
        recommendation: recommendation ?? null,
      }),
    ),
  };
}
function providerInput(
  input: TableGenerationInput,
  dest: BlueprintMetadata | undefined,
): TableProviderInput {
  const answers = validateAnswers(input.answers);
  const description = input.description.trim();
  if (!description || description.length > 4000)
    invalid('description', '请用 1–4000 字描述业务需求。');
  const request: TableProviderInput = {
    mode: input.mode,
    description,
    answers: answers.map((a, i) => ({
      key: a.key,
      label:
        a.otherText ??
        definitions[i].options.find((o) => o.id === a.choiceId)!.label,
    })),
    existing: [],
    mayAsk: input.mode === 'create' && answers.length === 0,
    ...(dest ? { targetName: dest.name } : {}),
    ...(input.table
      ? { table: modelTable(input.table, dest ? '' : input.table.code) }
      : {}),
  };
  const scope = canonicalName(
    [
      description,
      input.table?.name,
      ...request.answers.map((a) => a.label),
    ].join(' '),
  );
  const existing = dest ? [dest] : input.existing;
  const isRelated = (t: BlueprintMetadata) =>
    Boolean(dest) || scope.includes(canonicalName(t.name));
  request.existing = existing.map((t) => ({
    name: t.name,
    fields: isRelated(t)
      ? t.fields.map(({ label, type }) => ({ label, type }))
      : [],
  }));
  const budget = 32000;
  if (JSON.stringify(request).length > budget && !dest) {
    request.existing = request.existing.filter((t) =>
      scope.includes(canonicalName(t.name)),
    );
    if (!request.existing.length && existing.length)
      invalid(
        'description',
        '当前表结构较多，请在描述中写明相关表名以限定范围。',
      );
  }
  if (JSON.stringify(request).length > budget)
    invalid('description', '相关表结构超出生成预算，请缩小本次需求的范围。');
  return request;
}

const unsupported: Record<string, string> = {
  FORMULA: '可另行选择手工录入结果。',
  COMPUTED: '可另行选择手工录入结果。',
  ATTACHMENT: '使用记录附件区。',
  FILE: '使用记录附件区。',
  RELATION: '使用记录关联。',
  REFERENCE: '使用记录关联。',
  LOOKUP: '使用记录关联。',
};
function refId(
  ref: string,
  knownId: string | undefined,
  path: string,
  seen: Set<string>,
) {
  if (seen.has(ref)) invalid(path, '模型返回重复的字段或选项引用，请重试。');
  seen.add(ref);
  if (knownId) return knownId;
  if (!/^new:[a-zA-Z0-9_-]{1,64}$/.test(ref))
    invalid(path, '模型引用了不属于当前草稿的项，请重试。');
  return randomUUID();
}

export async function generateTablePlan(
  provider: AiProvider,
  input: TableGenerationInput,
  signal: AbortSignal,
): Promise<TableBuilderResult> {
  signal.throwIfAborted();
  const dest =
    input.target && input.existing.find((t) => t.id === input.target!.objectId);
  if (input.target && !dest) throw new ApiException('OBJECT_NOT_FOUND', 404);
  if (input.target && dest?.version !== input.target.expectedVersion)
    throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
  if (input.mode === 'append' && !dest)
    invalid('target', '请指定补字段的目标表。');
  if (input.mode === 'refine' && !input.table)
    invalid('table', '请选择一张草稿表。');
  const request = providerInput(input, dest);
  if (!provider.generateTableBlueprint)
    throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
  let raw: unknown;
  try {
    raw = await provider.generateTableBlueprint(request, signal);
  } catch {
    signal.throwIfAborted();
    throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
  }
  signal.throwIfAborted();
  const parsed = tableModelSchema.safeParse(raw);
  if (!parsed.success)
    invalid(
      parsed.error.issues[0]?.path.join('.') || 'blueprint',
      '模型返回的方案格式有误，请重新生成。',
    );
  const output = parsed.data;
  if (output.needsDetails && !output.tables.length && !output.omitted.length) {
    if (!request.mayAsk)
      invalid('needsDetails', '模型未完成方案，请重试或补充说明。');
    return { kind: 'question', ...definitions[request.answers.length] };
  }
  if ((dest || input.mode === 'refine') && output.tables.length !== 1)
    invalid('tables', '模型应仅返回所选表，请重试。');
  const omissions = [...output.omitted];
  function omit(
    request: string,
    reason: string,
    alternative: string,
    tableName: string | null = null,
    manualField: (typeof omissions)[number]['manualField'] = null,
  ) {
    omissions.push({ request, reason, alternative, tableName, manualField });
  }
  const tables: TablePlan[] = [];
  const usedCodes = new Set(input.existing.map((o) => o.code));
  for (const [ti, t] of output.tables.entries()) {
    const path = 'tables.' + ti;
    if (
      dest &&
      (t.name !== dest.name ||
        t.titleRef !== null ||
        t.columnRefs.length ||
        t.employeeIntent.length ||
        t.description !== null ||
        t.icon !== null)
    )
      invalid(path, '补字段方案包含对原表的修改，请重试。');
    const builtin = !dest && builtInReason(t.name);
    if (builtin) {
      omit(t.name, '平台已提供这项能力。', builtin);
      continue;
    }
    const previous = input.table;
    const id = dest?.id ?? previous?.id ?? randomUUID();
    const seen = new Set<string>();
    const fieldIds = new Map<string, string>();
    const fields: FieldPlan[] = [];
    const retainedRefs = new Set(t.fields.map((f) => f.ref));
    const usedKeys = new Set([
      ...(dest?.fields.map((f) => f.fieldKey) ?? []),
      ...(previous?.fields
        .filter((f) => retainedRefs.has(f.id))
        .map((f) => f.fieldKey) ?? []),
    ]);
    for (const [fi, f] of t.fields.entries()) {
      const fieldPath = path + '.fields.' + fi;
      const old = previous?.fields.find((p) => p.id === f.ref);
      const fieldId = refId(f.ref, old?.id, fieldPath + '.ref', seen);
      const platform = builtInReason(f.label);
      const alternative = Object.hasOwn(unsupported, f.type.toUpperCase())
        ? unsupported[f.type.toUpperCase()]
        : undefined;
      if (platform || alternative) {
        omit(
          f.label,
          platform ? '平台已提供这项能力。' : '本版不支持此字段类型。',
          (platform ?? alternative)!,
          t.name,
          !platform && !['ATTACHMENT', 'FILE'].includes(f.type.toUpperCase())
            ? { label: f.label, fieldKey: f.fieldKeySuggestion, type: 'TEXT' }
            : null,
        );
        continue;
      }
      if (!isPublishedFieldType(f.type))
        invalid(
          fieldPath + '.type',
          '未知字段类型 ' + f.type + '，请重新生成。',
        );
      fieldIds.set(f.ref, fieldId);
      const optionRefs = new Set<string>();
      const options = f.options.map((o) => {
        const oldOption = old?.options?.find(
          (existing) => existing.id === o.ref,
        );
        const oid = refId(
          o.ref,
          oldOption?.id,
          fieldPath + '.options',
          optionRefs,
        );
        return {
          id: oid,
          key: oldOption?.key ?? blueprintCode(oid, 'option'),
          label: o.label,
          reason: o.reason,
        };
      });
      fields.push({
        id: fieldId,
        fieldKey:
          old?.fieldKey ??
          allocateSuggestedCode(
            f.fieldKeySuggestion,
            fieldId,
            'field',
            usedKeys,
          ),
        label: f.label,
        type: f.type,
        required: f.required,
        reason: f.reason,
        ...(options.length ? { options } : {}),
        ...(f.validation
          ? {
              validation: Object.fromEntries(
                Object.entries(f.validation).filter(([, v]) => v !== null),
              ),
            }
          : {}),
      });
    }
    for (const ref of [...(t.titleRef ? [t.titleRef] : []), ...t.columnRefs])
      if (!seen.has(ref))
        invalid(path + '.view', '模型返回了无效的标题或视图字段引用，请重试。');
    tables.push({
      id,
      code:
        dest?.code ??
        previous?.code ??
        allocateSuggestedCode(t.codeSuggestion, id, 'object', usedCodes),
      name: t.name,
      ...(t.description !== null ? { description: t.description } : {}),
      ...(t.icon !== null ? { icon: t.icon } : {}),
      reason: t.reason,
      fields,
      titleFieldId: fieldIds.get(t.titleRef ?? '') ?? '',
      view: {
        columnIds: t.columnRefs.flatMap((k) =>
          fieldIds.has(k) ? [fieldIds.get(k)!] : [],
        ),
        reason: t.viewReason,
      },
      employeeIntent: t.employeeIntent,
    });
  }
  const omitted = normalizeOmissions(
    omissions,
    tables,
    input.omitted,
    input.table,
    dest?.fields.map((f) => f.fieldKey),
  );
  return {
    kind: 'blueprint',
    blueprint: { version: 1, tables, assumptions: output.assumptions, omitted },
    issues: [],
  };
}
