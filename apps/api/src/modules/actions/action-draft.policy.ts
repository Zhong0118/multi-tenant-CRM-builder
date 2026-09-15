import { ApiException } from '../../common/errors/api.exception';
import type { ApiErrorCode } from '../../common/errors/api-error-code';
import {
  ACTION_ALLOWED_KEYS,
  ACTION_KEY_PATTERN,
  ACTION_OUTPUT_PROPERTIES,
  ACTION_SOURCE_META_PROPERTIES,
  MAX_ACTIONS_PER_TRANSITION,
  MAX_DUE_AT_OFFSET_DAYS,
  MAX_FIELD_MAPPINGS_PER_ACTION,
  WORKFLOW_ACTION_TYPES,
  type ActionDateTimeSource,
  type ActionLiteralValue,
  type ActionMemberSource,
  type ActionOutputProperty,
  type ActionRecordRef,
  type ActionSourceMetaProperty,
  type ActionStringSource,
  type ActionValueSource,
  type WorkflowActionDraft,
  type WorkflowActionType,
} from './action.types';

/** §20: V1 never grants the Employee role an owner-change capability. */
export const EMPLOYEE_ROLE = 'EMPLOYEE';

export interface ActionValidationContext {
  /** Addressable field-error prefix, e.g. `transitions.0.actions`. */
  fieldPath: string;
}

/**
 * Validates the ordered Action steps of one Transition (§7, §15–§22, §28, §34).
 *
 * Pure function: structure and self-referential rules only. Cross-object checks
 * (target object / field existence, field type compatibility, required mapping
 * coverage, permission compatibility) belong to the publication analyzer.
 *
 * @param actions untrusted draft or legacy data; `null`/`undefined` means an
 *   old transition without actions and normalizes to `[]`.
 * @returns the canonical typed action list.
 */
export function validateTransitionActions(
  actions: readonly unknown[] | null | undefined,
  context: ActionValidationContext,
): WorkflowActionDraft[] {
  const list = actions ?? [];
  const base = context.fieldPath;
  if (!Array.isArray(list)) {
    throw actionError('WORKFLOW_ACTION_INVALID', base, '执行动作必须是数组。');
  }
  if (list.length > MAX_ACTIONS_PER_TRANSITION) {
    throw actionError(
      'WORKFLOW_ACTION_LIMIT_EXCEEDED',
      base,
      `每个流程动作最多配置 ${MAX_ACTIONS_PER_TRANSITION} 个执行动作。`,
    );
  }

  const headers = readActionHeaders(list, base);
  const references = createReferenceResolver(headers);
  const patchWriters = new Map<string, string>();
  const normalized: WorkflowActionDraft[] = [];
  let assignOwnerKey: string | null = null;

  for (const header of headers) {
    const path = `${base}.${header.index}`;
    const scope: ValidationScope = { index: header.index, references };

    switch (header.type) {
      case 'CREATE_RECORD': {
        const targetObjectCode = requireText(
          header.record.targetObjectCode,
          `${path}.targetObjectCode`,
          '「targetObjectCode」',
        );
        const values = normalizeFieldMappings(
          header.record.values,
          `${path}.values`,
          scope,
        );
        const owner =
          header.record.owner === undefined
            ? undefined
            : normalizeMemberSource(
                header.record.owner,
                `${path}.owner`,
                '记录负责人只支持执行人或当前记录负责人。',
              );
        normalized.push({
          key: header.key,
          type: 'CREATE_RECORD',
          targetObjectCode,
          values,
          ...(owner ? { owner } : {}),
        });
        break;
      }

      case 'UPDATE_RECORD': {
        requireSourceRecordTarget(header.record.target, `${path}.target`);
        const values = normalizeFieldMappings(
          header.record.values,
          `${path}.values`,
          scope,
        );
        assertSourcePatchFieldsFree(values, path, patchWriters, header.key);
        normalized.push({
          key: header.key,
          type: 'UPDATE_RECORD',
          target: 'SOURCE_RECORD',
          values,
        });
        break;
      }

      case 'CREATE_RELATION': {
        const left = normalizeRecordRef(
          header.record.left,
          `${path}.left`,
          scope,
        );
        const right = normalizeRecordRef(
          header.record.right,
          `${path}.right`,
          scope,
        );
        normalized.push({
          key: header.key,
          type: 'CREATE_RELATION',
          left,
          right,
        });
        break;
      }

      case 'CREATE_FOLLOW_UP': {
        const target = normalizeRecordRef(
          header.record.target,
          `${path}.target`,
          scope,
        );
        const title = normalizeStringSource(
          header.record.title,
          `${path}.title`,
        );
        const dueAt = normalizeDateTimeSource(
          header.record.dueAt,
          `${path}.dueAt`,
        );
        const assignee = normalizeMemberSource(
          header.record.assignee,
          `${path}.assignee`,
          '跟进负责人只支持执行人或当前记录负责人。',
        );
        normalized.push({
          key: header.key,
          type: 'CREATE_FOLLOW_UP',
          target,
          title,
          dueAt,
          assignee,
        });
        break;
      }

      case 'ASSIGN_OWNER': {
        if (assignOwnerKey !== null) {
          throw actionError(
            'WORKFLOW_ACTION_INVALID',
            `${path}.type`,
            '每个流程动作最多配置一个负责人变更。',
          );
        }
        requireSourceRecordTarget(header.record.target, `${path}.target`);
        const owner = requireRecord(
          header.record.owner,
          `${path}.owner`,
          '负责人',
        );
        assertAllowedKeys(owner, ['source'], `${path}.owner`, '负责人');
        if (owner.source !== 'ACTOR') {
          throw actionError(
            'WORKFLOW_ACTION_INVALID',
            `${path}.owner`,
            '负责人变更动作只能分配给执行人。',
          );
        }
        normalized.push({
          key: header.key,
          type: 'ASSIGN_OWNER',
          target: 'SOURCE_RECORD',
          owner: { source: 'ACTOR' },
        });
        assignOwnerKey = header.key;
        break;
      }
    }
  }

  return normalized;
}

/**
 * §20: publication must block a Transition that allows EMPLOYEE and assigns the
 * owner, because V1 gives EMPLOYEE no owner-change capability.
 *
 * Pure predicate for the publication analyzer; it does not throw, so it can be
 * reported as a blocking publication issue on the offending transitions.
 *
 * @returns ascending indices of the incompatible transitions.
 */
export function findEmployeeAssignOwnerTransitions(
  transitions: readonly TransitionActionPermissionInput[],
): number[] {
  const offenders: number[] = [];
  for (const [index, transition] of transitions.entries()) {
    if (!transition.allowedRoles.includes(EMPLOYEE_ROLE)) continue;
    if (!transition.actions.some((action) => action.type === 'ASSIGN_OWNER')) {
      continue;
    }
    offenders.push(index);
  }
  return offenders;
}

export interface TransitionActionPermissionInput {
  allowedRoles: readonly string[];
  actions: readonly Pick<WorkflowActionDraft, 'type'>[];
}

interface ActionHeader {
  index: number;
  key: string;
  type: WorkflowActionType;
  record: Record<string, unknown>;
}

interface ValidationScope {
  index: number;
  references: ReferenceResolver;
}

interface ReferenceResolver {
  assertOutput(
    actionKey: string,
    property: string,
    currentIndex: number,
    path: string,
  ): void;
}

/**
 * First pass: action identity only (object, supported type, declared keys,
 * normalized key, uniqueness) so that later actions can be recognized as
 * forward references instead of unknown ones.
 */
function readActionHeaders(
  list: readonly unknown[],
  base: string,
): ActionHeader[] {
  const headers: ActionHeader[] = [];
  const indexByKey = new Map<string, number>();

  for (const [index, value] of list.entries()) {
    const path = `${base}.${index}`;
    const record = requireRecord(value, path, '执行动作');
    const type = requireActionType(record.type, `${path}.type`);
    assertAllowedKeys(record, ACTION_ALLOWED_KEYS[type], path, '执行动作');
    const key = requireKey(record.key, `${path}.key`);
    if (indexByKey.has(key)) {
      throw actionError(
        'WORKFLOW_ACTION_DUPLICATE_KEY',
        `${path}.key`,
        '执行动作编码不能重复。',
      );
    }
    indexByKey.set(key, index);
    headers.push({ index, key, type, record });
  }

  return headers;
}

function createReferenceResolver(
  headers: readonly ActionHeader[],
): ReferenceResolver {
  const indexByKey = new Map(
    headers.map((header) => [header.key, header.index]),
  );
  const typeByKey = new Map(headers.map((header) => [header.key, header.type]));

  return {
    assertOutput(actionKey, property, currentIndex, path) {
      const referencedIndex = indexByKey.get(actionKey);
      if (referencedIndex === undefined) {
        throw actionError(
          'WORKFLOW_ACTION_OUTPUT_INVALID',
          path,
          `找不到执行动作「${actionKey}」。`,
        );
      }
      if (referencedIndex >= currentIndex) {
        throw actionError(
          'WORKFLOW_ACTION_FORWARD_REFERENCE',
          path,
          `只能引用前序执行动作的输出，「${actionKey}」不是前序动作。`,
        );
      }
      const referencedType = typeByKey.get(actionKey) as WorkflowActionType;
      if (
        !ACTION_OUTPUT_PROPERTIES[referencedType].includes(
          property as ActionOutputProperty,
        )
      ) {
        throw actionError(
          'WORKFLOW_ACTION_OUTPUT_INVALID',
          `${path}.property`,
          `执行动作「${actionKey}」不提供输出「${property}」。`,
        );
      }
    },
  };
}

function normalizeFieldMappings(
  value: unknown,
  path: string,
  scope: ValidationScope,
): Record<string, ActionValueSource> {
  const record = requireRecord(value, path, '字段映射');
  const entries = Object.entries(record);
  if (entries.length > MAX_FIELD_MAPPINGS_PER_ACTION) {
    throw actionError(
      'WORKFLOW_ACTION_LIMIT_EXCEEDED',
      path,
      `每个执行动作最多配置 ${MAX_FIELD_MAPPINGS_PER_ACTION} 个字段映射。`,
    );
  }

  const values: Record<string, ActionValueSource> = {};
  for (const [fieldKey, source] of entries) {
    values[fieldKey] = normalizeValueSource(
      source,
      `${path}.${fieldKey}`,
      scope,
    );
  }
  return values;
}

function normalizeValueSource(
  value: unknown,
  path: string,
  scope: ValidationScope,
): ActionValueSource {
  const record = requireRecord(value, path, '值来源');
  const source = record.source;
  if (typeof source !== 'string') {
    throw actionError(
      'WORKFLOW_ACTION_INVALID',
      `${path}.source`,
      '缺少必填配置「source」。',
    );
  }

  switch (source) {
    case 'LITERAL':
      assertAllowedKeys(record, ['source', 'value'], path, '值来源');
      return {
        source: 'LITERAL',
        value: requireLiteral(record.value, `${path}.value`),
      };

    case 'SOURCE_FIELD':
      assertAllowedKeys(record, ['source', 'fieldKey'], path, '值来源');
      return {
        source: 'SOURCE_FIELD',
        fieldKey: requireText(
          record.fieldKey,
          `${path}.fieldKey`,
          '「fieldKey」',
        ),
      };

    case 'SOURCE_META': {
      assertAllowedKeys(record, ['source', 'property'], path, '值来源');
      const property = requireText(
        record.property,
        `${path}.property`,
        '「property」',
      );
      if (!isSourceMetaProperty(property)) {
        throw actionError(
          'WORKFLOW_ACTION_INVALID',
          `${path}.property`,
          '来源属性不受支持。',
        );
      }
      return { source: 'SOURCE_META', property };
    }

    case 'ACTOR':
      assertAllowedKeys(record, ['source', 'memberId'], path, '值来源');
      return record.memberId === undefined
        ? { source: 'ACTOR' }
        : {
            source: 'ACTOR',
            memberId: requireText(
              record.memberId,
              `${path}.memberId`,
              '「memberId」',
            ),
          };

    case 'ACTION_OUTPUT': {
      assertAllowedKeys(
        record,
        ['source', 'actionKey', 'property'],
        path,
        '值来源',
      );
      const actionKey = requireKey(record.actionKey, `${path}.actionKey`);
      const property = requireText(
        record.property,
        `${path}.property`,
        '「property」',
      );
      scope.references.assertOutput(actionKey, property, scope.index, path);
      return {
        source: 'ACTION_OUTPUT',
        actionKey,
        property: property as ActionOutputProperty,
      };
    }

    case 'NOW':
      assertAllowedKeys(record, ['source'], path, '值来源');
      return { source: 'NOW' };

    case 'NOW_PLUS_DAYS':
      assertAllowedKeys(record, ['source', 'days'], path, '值来源');
      return {
        source: 'NOW_PLUS_DAYS',
        days: requireDays(record.days, `${path}.days`),
      };

    case 'LITERAL_DATETIME':
      assertAllowedKeys(record, ['source', 'value'], path, '值来源');
      return {
        source: 'LITERAL_DATETIME',
        value: requireDateTime(record.value, `${path}.value`),
      };

    default:
      throw actionError(
        'WORKFLOW_ACTION_INVALID',
        `${path}.source`,
        '字段映射的值来源不受支持。',
      );
  }
}

function normalizeRecordRef(
  value: unknown,
  path: string,
  scope: ValidationScope,
): ActionRecordRef {
  const record = requireRecord(value, path, '记录引用');
  const source = record.source;
  if (source === 'SOURCE_RECORD') {
    assertAllowedKeys(record, ['source'], path, '记录引用');
    return { source: 'SOURCE_RECORD' };
  }
  if (source === 'ACTION_OUTPUT') {
    assertAllowedKeys(
      record,
      ['source', 'actionKey', 'property'],
      path,
      '记录引用',
    );
    const actionKey = requireKey(record.actionKey, `${path}.actionKey`);
    if (record.property !== 'recordId') {
      throw actionError(
        'WORKFLOW_ACTION_OUTPUT_INVALID',
        `${path}.property`,
        '记录引用只能使用前序执行动作的 recordId 输出。',
      );
    }
    scope.references.assertOutput(actionKey, 'recordId', scope.index, path);
    return { source: 'ACTION_OUTPUT', actionKey, property: 'recordId' };
  }
  throw actionError(
    'WORKFLOW_ACTION_INVALID',
    `${path}.source`,
    '记录引用只支持当前记录或前序执行动作的输出。',
  );
}

function normalizeStringSource(
  value: unknown,
  path: string,
): ActionStringSource {
  const record = requireRecord(value, path, '标题来源');
  const source = record.source;
  if (source === 'LITERAL') {
    assertAllowedKeys(record, ['source', 'value'], path, '标题来源');
    return {
      source: 'LITERAL',
      value: requireText(record.value, `${path}.value`, '「value」'),
    };
  }
  if (source === 'SOURCE_FIELD') {
    assertAllowedKeys(record, ['source', 'fieldKey'], path, '标题来源');
    return {
      source: 'SOURCE_FIELD',
      fieldKey: requireText(
        record.fieldKey,
        `${path}.fieldKey`,
        '「fieldKey」',
      ),
    };
  }
  throw actionError(
    'WORKFLOW_ACTION_INVALID',
    `${path}.source`,
    '跟进标题只支持固定文本或当前记录字段。',
  );
}

function normalizeDateTimeSource(
  value: unknown,
  path: string,
): ActionDateTimeSource {
  const record = requireRecord(value, path, '跟进时间');
  const source = record.source;
  if (source === 'NOW') {
    assertAllowedKeys(record, ['source'], path, '跟进时间');
    return { source: 'NOW' };
  }
  if (source === 'NOW_PLUS_DAYS') {
    assertAllowedKeys(record, ['source', 'days'], path, '跟进时间');
    return {
      source: 'NOW_PLUS_DAYS',
      days: requireDays(record.days, `${path}.days`),
    };
  }
  if (source === 'LITERAL_DATETIME') {
    assertAllowedKeys(record, ['source', 'value'], path, '跟进时间');
    return {
      source: 'LITERAL_DATETIME',
      value: requireDateTime(record.value, `${path}.value`),
    };
  }
  if (source === 'SOURCE_FIELD') {
    assertAllowedKeys(record, ['source', 'fieldKey'], path, '跟进时间');
    return {
      source: 'SOURCE_FIELD',
      fieldKey: requireText(
        record.fieldKey,
        `${path}.fieldKey`,
        '「fieldKey」',
      ),
    };
  }
  throw actionError(
    'WORKFLOW_ACTION_INVALID',
    `${path}.source`,
    '跟进时间只支持固定时间、当前时间、当前时间加天数或当前记录字段。',
  );
}

function normalizeMemberSource(
  value: unknown,
  path: string,
  message: string,
): ActionMemberSource {
  const record = requireRecord(value, path, '成员来源');
  assertAllowedKeys(record, ['source'], path, '成员来源');
  const source = record.source;
  if (source === 'ACTOR' || source === 'SOURCE_OWNER') {
    return { source };
  }
  throw actionError('WORKFLOW_ACTION_INVALID', `${path}.source`, message);
}

function assertSourcePatchFieldsFree(
  values: Record<string, ActionValueSource>,
  path: string,
  patchWriters: Map<string, string>,
  actionKey: string,
): void {
  for (const fieldKey of Object.keys(values)) {
    const writer = patchWriters.get(fieldKey);
    if (writer !== undefined) {
      throw actionError(
        'WORKFLOW_ACTION_SOURCE_PATCH_CONFLICT',
        `${path}.values.${fieldKey}`,
        `字段「${fieldKey}」已被执行动作「${writer}」更新，不能重复写入。`,
      );
    }
    patchWriters.set(fieldKey, actionKey);
  }
}

function requireSourceRecordTarget(value: unknown, path: string): void {
  if (value !== 'SOURCE_RECORD') {
    throw actionError(
      'WORKFLOW_ACTION_INVALID',
      path,
      '执行动作只能作用于当前记录。',
    );
  }
}

function requireActionType(value: unknown, path: string): WorkflowActionType {
  if (typeof value !== 'string' || !isActionType(value)) {
    throw actionError(
      'WORKFLOW_ACTION_INVALID',
      path,
      '执行动作类型不受支持。',
    );
  }
  return value;
}

function requireRecord(
  value: unknown,
  path: string,
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw actionError('WORKFLOW_ACTION_INVALID', path, `${label}格式不正确。`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  label: string,
): void {
  // `undefined`-valued properties are ignored on purpose. On the real HTTP path
  // the record is a `WorkflowActionDraftDto` class instance, and with
  // `target: ES2023` (`useDefineForClassFields`) every declared field is an own
  // enumerable property even when the request body omitted it — so a valid
  // CREATE_RECORD would otherwise arrive carrying `target`, `left`, `right`,
  // `title`, `dueAt` and `assignee` as `undefined` and be rejected. A JSON
  // request body can never produce `undefined`, so strictness for real input is
  // unaffected; this only ignores the class-field artifact.
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (!allowed.includes(key)) {
      throw actionError(
        'WORKFLOW_ACTION_INVALID',
        `${path}.${key}`,
        `${label}不支持配置项「${key}」。`,
      );
    }
  }
}

function requireKey(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw actionError(
      'WORKFLOW_ACTION_INVALID',
      path,
      '执行动作编码不能为空。',
    );
  }
  const key = value.trim().toLowerCase();
  if (!ACTION_KEY_PATTERN.test(key)) {
    throw actionError(
      'WORKFLOW_ACTION_INVALID',
      path,
      '仅支持小写字母、数字和单个连字符。',
    );
  }
  return key;
}

function requireText(value: unknown, path: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw actionError('WORKFLOW_ACTION_INVALID', path, `${label}不能为空。`);
  }
  return value.trim();
}

function requireLiteral(value: unknown, path: string): ActionLiteralValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw actionError(
    'WORKFLOW_ACTION_INVALID',
    path,
    '「value」必须是字符串、数字或布尔值。',
  );
}

function requireDays(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_DUE_AT_OFFSET_DAYS
  ) {
    throw actionError(
      'WORKFLOW_ACTION_INVALID',
      path,
      `NOW_PLUS_DAYS 只能在 0 到 ${MAX_DUE_AT_OFFSET_DAYS} 天之间。`,
    );
  }
  return value;
}

function requireDateTime(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw actionError('WORKFLOW_ACTION_INVALID', path, '日期时间格式不正确。');
  }
  return value.trim();
}

function isActionType(value: string): value is WorkflowActionType {
  return (WORKFLOW_ACTION_TYPES as readonly string[]).includes(value);
}

function isSourceMetaProperty(
  value: string,
): value is ActionSourceMetaProperty {
  return (ACTION_SOURCE_META_PROPERTIES as readonly string[]).includes(value);
}

function actionError(
  code: ApiErrorCode,
  field: string,
  message: string,
): ApiException {
  return new ApiException(code, 400, { fieldErrors: { [field]: [message] } });
}
