import {
  FIELD_KEY_PATTERN,
  NEW_OBJECT_CODE_PATTERN,
} from '../objects/object-code';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TABLE_EMPLOYEE_PRESETS } from '@crm/contracts';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateObjectDefinitionDto,
  CreateFieldDefinitionDto,
} from '../objects/dto/object.dto';
import type {
  FieldPlan,
  TableBlueprint,
  TableBuilderIssue,
  TableBuilderTarget,
} from '@crm/contracts';
import { ApiException } from '../../common/errors/api.exception';
import {
  PUBLISHED_FIELD_TYPES,
  type JsonValue,
} from '../objects/object-schema';
import { analyzeObjectConfiguration } from '../objects/object-configuration.policy';

export interface BlueprintMetadata {
  id: string;
  code: string;
  name: string;
  version?: number;
  publishedName?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  fields: { fieldKey: string; label: string; type: string }[];
}
const label = z.string().trim().max(100);
const reason = z.string().trim().max(1000);
const id = z.uuid();
const assigned = z.string().max(64);
const validation = z.strictObject({
  minLength: z.number().int().min(0).max(10000).optional(),
  maxLength: z.number().int().min(1).max(10000).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  scale: z.number().int().min(0).max(12).optional(),
  country: z.string().trim().min(1).max(16).optional(),
});
const fieldSchema = z.strictObject({
  id,
  fieldKey: assigned,
  label,
  type: z.enum(PUBLISHED_FIELD_TYPES),
  required: z.boolean(),
  reason,
  options: z
    .array(z.strictObject({ id, key: assigned, label, reason }))
    .max(100)
    .optional(),
  validation: validation.optional(),
});
export const blueprintSchema = z.strictObject({
  version: z.literal(1),
  assumptions: z.array(reason).max(100),
  omitted: z
    .array(
      z.strictObject({
        request: reason,
        reason,
        alternative: reason.optional(),
        tableId: id.optional(),
        manualField: fieldSchema.optional(),
      }),
    )
    .max(300),
  tables: z.array(
    z.strictObject({
      id,
      code: assigned,
      name: label,
      description: z.string().max(2000).optional(),
      icon: z.string().max(64).optional(),
      reason,
      fields: z.array(fieldSchema).max(40),
      titleFieldId: z.union([id, z.literal('')]),
      view: z.strictObject({ columnIds: z.array(id).max(40), reason }),
      employeeIntent: z
        .array(
          z.strictObject({
            request: reason,
            reason,
            recommendation: z.enum(TABLE_EMPLOYEE_PRESETS).nullish(),
          }),
        )
        .max(40),
    }),
  ),
});
export const targetSchema = z.strictObject({
  objectId: id,
  expectedVersion: z.number().int().min(1),
});
export function blueprintCode(
  value: string,
  kind: 'object' | 'field' | 'option',
) {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16);
  return (
    (kind === 'object' ? 'obj-' : kind === 'field' ? 'field_' : 'opt_') + digest
  );
}
export function allocateSuggestedCode(
  suggestion: string,
  id: string,
  kind: 'object' | 'field',
  used: Set<string>,
) {
  const pattern =
    kind === 'object' ? NEW_OBJECT_CODE_PATTERN : FIELD_KEY_PATTERN;
  let code = suggestion;
  if (code.length > 64 || !pattern.test(code) || used.has(code)) {
    const base = blueprintCode(id, kind);
    const separator = kind === 'object' ? '-' : '_';
    code = base;
    let suffix = 2;
    while (used.has(code)) code = base + separator + suffix++;
  }
  used.add(code);
  return code;
}
function isFallbackCode(code: string, id: string, kind: 'object' | 'field') {
  const base = blueprintCode(id, kind);
  return (
    code === base ||
    code.replace(kind === 'object' ? /-[0-9]+$/ : /_[0-9]+$/, '') === base
  );
}
export const canonicalName = (s: string) =>
  s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const platformFeatures = [
  {
    names: [
      '负责人',
      '记录负责人',
      '公海',
      '公海归属',
      'owner',
      'record owner',
      'owner id',
      'ownermemberid',
      'owner_member_id',
    ],
    use: '使用记录负责人和公海',
  },
  {
    names: [
      '编号',
      '记录编号',
      '系统编号',
      '创建时间',
      '更新时间',
      'recordno',
      'record_no',
      'createdat',
      'updatedat',
      'created_at',
      'updated_at',
      'created at',
      'updated at',
      'record number',
    ],
    use: '使用记录的系统编号和时间',
  },
  {
    names: [
      '跟进',
      '跟进表',
      '跟进记录',
      '跟进记录表',
      '跟进待办',
      '下次跟进',
      '下次跟进日期',
      '下次跟进时间',
      'follow-ups',
      'follow up',
      'follow-ups table',
      'next follow-up',
      'next follow-up date',
    ],
    use: '使用跟进待办',
  },
  {
    names: [
      '沟通动态',
      '活动纪要',
      '沟通纪要',
      '沟通记录',
      '活动历史',
      'activity notes',
      'activity history',
    ],
    use: '使用记录的沟通动态',
  },
  {
    names: [
      '附件',
      '附件表',
      '文件附件',
      '合同附件',
      '上传附件',
      'attachments',
      'attachment',
    ],
    use: '使用记录附件区',
  },
  {
    names: ['记录关联', '关联记录', 'record links', 'record relations'],
    use: '使用记录关联',
  },
];
export function builtInReason(name: string) {
  return platformFeatures.find((f) => f.names.includes(canonicalName(name)))
    ?.use;
}
export function blueprintFieldConfig(
  field: FieldPlan,
): Record<string, JsonValue> {
  return field.options
    ? {
        options: field.options.map((o) => ({
          key: o.key,
          label: o.label,
          status: 'ACTIVE',
        })),
      }
    : {};
}
export function validateBlueprint(
  raw: unknown,
  existing: BlueprintMetadata[],
  target?: TableBuilderTarget,
) {
  const parsed = blueprintSchema.safeParse(raw);
  if (!parsed.success)
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [
          i.path.join('.'),
          ['配置格式或数量不符合要求。'],
        ]),
      ),
    });
  const blueprint: TableBlueprint = parsed.data;
  const issues: TableBuilderIssue[] = [];
  const add = (
    code: string,
    message: string,
    path: string,
    tableId?: string,
    fieldId?: string,
    blocking = true,
  ) => issues.push({ code, message, path, tableId, fieldId, blocking });
  const dest = target && existing.find((t) => t.id === target.objectId);
  if (target && !dest) throw new ApiException('OBJECT_NOT_FOUND', 404);
  if (target && dest?.version !== target.expectedVersion)
    throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
  if (
    !blueprint.tables.length ||
    (target &&
      (blueprint.tables.length !== 1 ||
        blueprint.tables[0].id !== target.objectId))
  )
    add('TABLE_COUNT', '请选择有效的目标表。', 'tables');
  if (blueprint.tables.length > 6)
    add(
      'TABLE_COUNT',
      `一次最多创建 6 张，请移除 ${blueprint.tables.length - 6} 张`,
      'tables',
    );
  if (dest?.status === 'ARCHIVED')
    throw new ApiException('OBJECT_LIFECYCLE_CONFLICT', 409);
  const names = new Set(
    existing.flatMap((o) => [
      canonicalName(o.name),
      ...(o.publishedName ? [canonicalName(o.publishedName)] : []),
    ]),
  );
  const codes = new Set(existing.map((o) => o.code));
  const ids = new Set<string>();
  for (const t of blueprint.tables) {
    const fail = (
      code: string,
      message: string,
      path: string,
      fieldId?: string,
    ) => add(code, message, path, t.id, fieldId);
    const track = (value: string) => {
      if (ids.has(value))
        fail('DUPLICATE_ID', '项标识重复，请删除重复项。', 'id');
      ids.add(value);
    };
    track(t.id);
    if (dest && t.code !== dest.code)
      fail('TARGET_CHANGED', '补字段不能修改原表编码。', 'code');
    if (!dest) {
      if (!NEW_OBJECT_CODE_PATTERN.test(t.code))
        fail(
          'CODE_INVALID',
          '表编码须以小写英文字母开头，仅支持小写字母、数字和单个连字符。',
          'code',
        );
      else if (codes.has(t.code))
        fail('NAME_IN_USE', '表编码已占用，请修改。', 'code');
      else if (isFallbackCode(t.code, t.id, 'object'))
        add(
          'CODE_FALLBACK',
          '编码建议无效或已占用，已使用备用表编码，可在此修改。',
          'code',
          t.id,
          undefined,
          false,
        );
      codes.add(t.code);
      if (names.has(canonicalName(t.name)))
        fail('NAME_IN_USE', '业务表名称已占用。', 'name');
    }
    if (
      dest &&
      (t.name !== dest.name ||
        t.description !== undefined ||
        t.icon !== undefined ||
        t.employeeIntent.length)
    )
      fail('TARGET_CHANGED', '补字段不能修改原表名称。', 'name');
    if (!t.name || (!dest && builtInReason(t.name)))
      fail(
        'TABLE_NAME',
        '请输入独立业务实体名称；平台已内置的能力无需单独建表。',
        'name',
      );
    names.add(canonicalName(t.name));
    if (!t.fields.length || (target && t.fields.length > 10))
      fail(
        'FIELD_COUNT',
        target ? '请选 1–10 个新增字段。' : '请至少提供标题字段。',
        'fields',
      );
    const fieldNames = new Set(dest?.fields.map((f) => canonicalName(f.label)));
    const fieldKeys = new Set(dest?.fields.map((f) => f.fieldKey));
    for (const f of t.fields) {
      track(f.id);
      if (!FIELD_KEY_PATTERN.test(f.fieldKey))
        fail(
          'CODE_INVALID',
          '字段键须以小写英文字母开头，仅支持小写字母、数字和单个下划线。',
          'fieldKey',
          f.id,
        );
      else if (fieldKeys.has(f.fieldKey))
        fail('NAME_IN_USE', '字段键已占用，请修改。', 'fieldKey', f.id);
      else if (isFallbackCode(f.fieldKey, f.id, 'field'))
        add(
          'CODE_FALLBACK',
          '编码建议无效或已占用，已使用备用字段键，可在此修改。',
          'fieldKey',
          t.id,
          f.id,
          false,
        );
      fieldKeys.add(f.fieldKey);
      if (!f.label) fail('FIELD_NAME', '请填写字段名称。', 'label', f.id);
      if (fieldNames.has(canonicalName(f.label)))
        fail('NAME_IN_USE', '已有同名字段。', 'label', f.id);
      fieldNames.add(canonicalName(f.label));
      const builtin = builtInReason(f.label);
      if (builtin)
        fail('PLATFORM_BUILTIN', '平台已内置：' + builtin, 'label', f.id);
      if (f.options && !['SINGLE_SELECT', 'MULTI_SELECT'].includes(f.type))
        fail('OPTIONS_TYPE', '只有选项字段可以设置选项。', 'options', f.id);
      const labels = new Set<string>();
      f.options = f.options?.filter((o) => {
        track(o.id);
        o.key = blueprintCode(o.id, 'option');
        if (!o.label)
          fail('OPTION_NAME', '选项名称不能为空。', 'options', f.id);
        if (labels.has(canonicalName(o.label))) {
          add(
            'OPTION_MERGED',
            '已合并重复选项「' + o.label + '」。',
            'options',
            t.id,
            f.id,
            false,
          );
          return false;
        }
        labels.add(canonicalName(o.label));
        return true;
      });
    }
    if (dest && (t.titleFieldId || t.view.columnIds.length))
      fail('TARGET_CHANGED', '补充字段不能设置原表标题或视图。', 'view');
    const columns = t.view.columnIds.map(
      (id) => t.fields.find((f) => f.id === id)?.fieldKey ?? '',
    );
    if (!dest && (!columns.length || new Set(columns).size !== columns.length))
      fail('VIEW_COLUMNS', '请选择有效且不重复的视图列。', 'view');
    const fields = t.fields.map((f, i) => ({
      ...f,
      defaultValue: null,
      config: blueprintFieldConfig(f),
      validation: { ...f.validation },
      sortOrder: (i + 1) * 10,
      isSystem: false,
      status: 'ACTIVE' as const,
    }));
    const titleKey =
      t.fields.find((f) => f.id === t.titleFieldId)?.fieldKey ?? '';
    const dtoFields = fields.map(
      ({ fieldKey, label, type, required, validation, config }) => ({
        fieldKey,
        label,
        type,
        required,
        validation,
        config,
        defaultValue: null,
      }),
    );
    const options = { whitelist: true, forbidNonWhitelisted: true };
    if (
      !dest &&
      validateSync(
        plainToInstance(CreateObjectDefinitionDto, {
          name: t.name,
          code: t.code,
          icon: t.icon,
          titleFieldKey: titleKey,
          initialFields: dtoFields.filter((f) => f.type !== 'MEMBER'),
        }),
        options,
      ).length
    )
      fail('MANUAL_DTO_INVALID', '初始业务表配置未通过手动建表校验。', 'table');
    for (const [i, f] of dtoFields.entries()) {
      const errors = validateSync(
        plainToInstance(CreateFieldDefinitionDto, {
          ...f,
          expectedVersion: 1,
          isSystem: false,
        }),
        options,
      );
      for (const error of errors)
        fail(
          'MANUAL_DTO_INVALID',
          '字段配置未通过手动字段校验。',
          error.property,
          t.fields[i].id,
        );
    }
    const analysis = analyzeObjectConfiguration({
      object: {
        id: t.id,
        code: t.code,
        name: t.name,
        description: t.description ?? null,
        icon: t.icon ?? null,
        sortOrder: 0,
        titleFieldKey:
          t.fields.find((f) => f.id === t.titleFieldId)?.fieldKey ?? '',
      },
      fields,
      defaultView: {
        code: 'default',
        name: '全部记录',
        columnFieldKeys: columns,
        sort: { field: 'updatedAt', direction: 'desc' },
      },
      employeeAccess: {
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
        readScope: 'NONE',
        updateScope: 'NONE',
        fields: Object.fromEntries(
          fields.map((f) => [f.fieldKey, 'HIDDEN' as const]),
        ),
      },
    });
    if (
      dest &&
      analysis.blocking.some((i) => i.code === 'REQUIRED_FIELD_HIDDEN')
    )
      add(
        'APPENDED_REQUIRED_FIELDS_HIDDEN',
        '新增必填字段的员工权限尚未配置',
        'fields',
        t.id,
        undefined,
        false,
      );
    for (const issue of analysis.blocking) {
      if (issue.code === 'REQUIRED_FIELD_HIDDEN') continue;
      if (dest && issue.code === 'TITLE_FIELD_REQUIRED') continue;
      add(
        issue.code,
        issue.message,
        issue.fieldKey ? 'fields' : 'table',
        t.id,
        t.fields.find((f) => f.fieldKey === issue.fieldKey)?.id,
      );
    }
  }
  if (!dest && blueprint.tables.length)
    add(
      'EMPLOYEE_ACCESS_UNCONFIGURED',
      '员工权限尚未配置',
      'employeePresets',
      undefined,
      undefined,
      false,
    );
  return { blueprint, issues };
}
