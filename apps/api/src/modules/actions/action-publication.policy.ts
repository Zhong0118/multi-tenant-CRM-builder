import type { ApiErrorCode } from '../../common/errors/api-error-code';
import type { PublicationIssue } from '../objects/object-publication.policy';
import { resolveEffectiveAccess } from '../objects/effective-access';
import type {
  JsonValue,
  PublishedFieldAccess,
  PublishedFieldType,
  PublishedObjectSchema,
} from '../objects/object-schema';
import {
  EMPLOYEE_ROLE,
  findEmployeeAssignOwnerTransitions,
} from './action-draft.policy';
import type { ActionValueSource, WorkflowActionDraft } from './action.types';

/**
 * §25/§26: the publish-time cross-object analyzer for Workflow Actions.
 *
 * This is a PURE policy: the caller (the objects publication flow) loads the
 * current Target Object publications inside the tenant transaction and hands
 * them in. Nothing here queries, and nothing here is reachable from the
 * published-snapshot parser — `validateTransitionActions()` stays structural
 * (§ brief: the parser routes every stored snapshot through the draft
 * validator, so a cross-object rule added there would break every already
 * published object at runtime).
 */

/** The published shape of one field, as the analyzer needs to read it. */
export interface ActionPublicationField {
  fieldKey: string;
  type: PublishedFieldType;
  required: boolean;
  defaultValue: JsonValue;
  config: Record<string, JsonValue>;
  isSystem: boolean;
}

/**
 * A published object snapshot, or the schema the pending publication will
 * freeze. `employeeAccess` may be absent on a legacy/hand-made snapshot; the
 * analyzer then falls back to `resolveEffectiveAccess()`, which grants
 * employees nothing.
 */
export interface ActionPublicationSchema {
  fields: readonly ActionPublicationField[];
  employeeAccess?: PublishedObjectSchema['employeeAccess'] | null;
}

/** A referenced Target Object and its CURRENT Active Publication. */
export interface ActionPublicationTarget {
  code: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  /** `null` when the object has no Active Publication. */
  schema: ActionPublicationSchema | null;
}

/** One Transition of the Workflow Draft being published. */
export interface ActionPublicationTransition {
  key: string;
  allowedRoles: readonly string[];
  actions: readonly WorkflowActionDraft[];
}

export interface AnalyzeActionPublicationInput {
  /**
   * The object whose Workflow is being published. Its schema is both the source
   * of every `SOURCE_FIELD` and — after this publication succeeds — the target
   * of any Action that names the source object itself (§25, `action-engine.ts`
   * `resolveObjectFor()`).
   */
  source: { code: string; schema: ActionPublicationSchema };
  transitions: readonly ActionPublicationTransition[];
  /** Current Active Publications of the referenced Target Objects, by code. */
  targets: ReadonlyMap<string, ActionPublicationTarget>;
}

/**
 * §26: the Target Object codes a Workflow Draft needs publications for.
 *
 * Draft Actions are untrusted (they may come from persisted legacy JSON), so
 * anything that is not a `CREATE_RECORD` carrying a non-empty string code is
 * ignored here and reported by the draft validator instead.
 */
export function collectActionTargetObjectCodes(
  transitions:
    readonly { actions?: readonly unknown[] | null }[] | null | undefined,
): string[] {
  const codes: string[] = [];
  for (const transition of transitions ?? []) {
    for (const action of transition?.actions ?? []) {
      if (typeof action !== 'object' || action === null) continue;
      const record = action as Record<string, unknown>;
      if (record.type !== 'CREATE_RECORD') continue;
      const code = record.targetObjectCode;
      if (typeof code !== 'string') continue;
      const normalized = code.trim();
      if (normalized.length === 0 || codes.includes(normalized)) continue;
      codes.push(normalized);
    }
  }
  return codes;
}

/**
 * §34: the Transition and Action a cross-object issue originates from. §34
 * requires the UI to locate the offending Transition / Action / Field, and the
 * messages cannot do that on their own: two Transitions creating records into
 * the same missing Target Object produce byte-identical text.
 */
interface ActionIssueOrigin {
  transitionKey: string;
  actionKey: string;
}

/**
 * §34: build one located issue. `fieldKey` is only emitted when the issue is
 * about a single field, so the pre-existing non-action issues keep their exact
 * shape.
 */
function actionIssue(
  origin: ActionIssueOrigin,
  code: string,
  message: string,
  fieldKey?: string,
): PublicationIssue {
  return {
    code,
    message,
    ...(fieldKey === undefined ? {} : { fieldKey }),
    transitionKey: origin.transitionKey,
    actionKey: origin.actionKey,
  };
}

/** §34: the stable issue codes this analyzer can produce. */
const ACTION_ISSUE_CODES = {
  invalid: 'WORKFLOW_ACTION_INVALID',
  targetObject: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
  targetField: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
  fieldType: 'WORKFLOW_ACTION_FIELD_TYPE_MISMATCH',
  requiredMapping: 'WORKFLOW_ACTION_REQUIRED_MAPPING_MISSING',
  permission: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
} as const satisfies Record<string, ApiErrorCode>;

/**
 * §26: every cross-object reason a Transition's Actions could never execute
 * against the CURRENT Target Objects. The returned issues are BLOCKING.
 *
 * Structure (shape, limit, key syntax/uniqueness, supported type, payload,
 * `ACTION_OUTPUT` ordering and property, duplicate source patch field,
 * duplicate owner mutation) is NOT re-implemented here: the draft validator owns
 * it and the publication flow surfaces its §34 code unchanged.
 */
export function analyzeActionPublication(
  input: AnalyzeActionPublicationInput,
): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const sourceFields = fieldMap(input.source.schema);

  for (const transition of input.transitions) {
    for (const action of transition.actions) {
      const origin: ActionIssueOrigin = {
        transitionKey: transition.key,
        actionKey: action.key,
      };
      switch (action.type) {
        case 'CREATE_RECORD':
          analyzeCreateRecord(
            input,
            transition,
            action,
            sourceFields,
            issues,
            origin,
          );
          break;
        case 'UPDATE_RECORD':
          analyzeUpdateRecord(
            input,
            transition,
            action,
            sourceFields,
            issues,
            origin,
          );
          break;
        case 'CREATE_FOLLOW_UP':
          analyzeFollowUpFields(action, sourceFields, issues, origin);
          break;
        case 'CREATE_RELATION':
        case 'ASSIGN_OWNER':
          // No object lookup and no field mapping: §17/§20 references stay
          // structural (the draft validator owns them anyway).
          break;
      }
    }
  }

  // §20: the Transition-level seam Task 2 left ready. V1 gives EMPLOYEE no
  // owner-change capability, so an ignored ASSIGN_OWNER would be a silent
  // no-op — the publication must be refused, never degraded at runtime.
  for (const index of findEmployeeAssignOwnerTransitions(input.transitions)) {
    const transition = input.transitions[index];
    const ownerMutation = transition.actions.find(
      (action) => action.type === 'ASSIGN_OWNER',
    );
    issues.push({
      code: ACTION_ISSUE_CODES.permission,
      message: `流程动作「${transition.key}」允许员工执行，但包含变更记录负责人的步骤；V1 不允许员工变更记录负责人。`,
      transitionKey: transition.key,
      // The seam found this Transition through an ASSIGN_OWNER step, so the key
      // is present in practice; it is omitted only for a hand-made draft whose
      // Action carries no key (the blocking decision is unchanged either way).
      ...(ownerMutation ? { actionKey: ownerMutation.key } : {}),
    });
  }

  return issues;
}

/**
 * §18/§25/§26: a CREATE_RECORD must be provably creatable against the CURRENT
 * Target publication, for the roles that may run the Transition.
 */
function analyzeCreateRecord(
  input: AnalyzeActionPublicationInput,
  transition: ActionPublicationTransition,
  action: Extract<WorkflowActionDraft, { type: 'CREATE_RECORD' }>,
  sourceFields: ReadonlyMap<string, ActionPublicationField>,
  issues: PublicationIssue[],
  origin: ActionIssueOrigin,
): void {
  const targetSchema = resolveTargetSchema(
    input,
    action.targetObjectCode,
    issues,
    origin,
  );
  if (targetSchema === null) return;

  const targetFields = fieldMap(targetSchema);
  const employeeAccess = employeeAccessFor(transition, targetSchema);

  // §26: "then Source Object Publish should fail, instead of letting all
  // employees fail at runtime". When the object itself denies creation the
  // per-field complaints are noise, so they are not added on top.
  if (employeeAccess !== null && !employeeAccess.canCreate) {
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.permission,
        `流程动作「${transition.key}」允许员工执行，但目标业务对象「${action.targetObjectCode}」的员工默认权限不允许新建记录。`,
      ),
    );
  } else {
    for (const [fieldKey, valueSource] of Object.entries(action.values)) {
      const targetField = targetFields.get(fieldKey);
      if (!targetField) {
        issues.push(
          actionIssue(
            origin,
            ACTION_ISSUE_CODES.targetField,
            `目标业务对象「${action.targetObjectCode}」不存在字段「${fieldKey}」。`,
            fieldKey,
          ),
        );
        continue;
      }
      if (
        employeeAccess !== null &&
        employeeFieldAccess(employeeAccess, fieldKey) !== 'EDIT'
      ) {
        issues.push(
          actionIssue(
            origin,
            ACTION_ISSUE_CODES.permission,
            `流程动作「${transition.key}」允许员工执行，但员工不能填写「${action.targetObjectCode}.${fieldKey}」。`,
            fieldKey,
          ),
        );
      }
      analyzeCopiedField(
        valueSource,
        sourceFields,
        targetField,
        issues,
        origin,
      );
    }
  }

  // §27: target required editable fields − valid defaults − mapped fields.
  const mapped = new Set(Object.keys(action.values));
  for (const field of targetSchema.fields) {
    if (!field.required) continue;
    if (field.defaultValue !== null) continue;
    if (mapped.has(field.fieldKey)) continue;
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.requiredMapping,
        `目标业务对象「${action.targetObjectCode}」的必填字段「${field.fieldKey}」没有默认值，也没有配置取值。`,
        field.fieldKey,
      ),
    );
  }
}

/**
 * §19/§26: UPDATE_RECORD only ever writes the Source Record, so the "Target
 * Field exists" and Employee field-permission rules are checked against the
 * schema this publication is about to freeze.
 */
function analyzeUpdateRecord(
  input: AnalyzeActionPublicationInput,
  transition: ActionPublicationTransition,
  action: Extract<WorkflowActionDraft, { type: 'UPDATE_RECORD' }>,
  fields: ReadonlyMap<string, ActionPublicationField>,
  issues: PublicationIssue[],
  origin: ActionIssueOrigin,
): void {
  const employeeAccess = employeeAccessFor(transition, input.source.schema);

  for (const [fieldKey, valueSource] of Object.entries(action.values)) {
    const field = fields.get(fieldKey);
    if (!field) {
      issues.push(
        actionIssue(
          origin,
          ACTION_ISSUE_CODES.targetField,
          `当前记录不存在字段「${fieldKey}」，无法更新。`,
          fieldKey,
        ),
      );
      continue;
    }
    if (
      employeeAccess !== null &&
      employeeFieldAccess(employeeAccess, fieldKey) !== 'EDIT'
    ) {
      issues.push(
        actionIssue(
          origin,
          ACTION_ISSUE_CODES.permission,
          `流程动作「${transition.key}」允许员工执行，但员工不能修改字段「${fieldKey}」。`,
          fieldKey,
        ),
      );
    }
    analyzeCopiedField(valueSource, fields, field, issues, origin);
  }
}

/** §22: the follow-up title / dueAt may read a Source Object field. */
function analyzeFollowUpFields(
  action: Extract<WorkflowActionDraft, { type: 'CREATE_FOLLOW_UP' }>,
  sourceFields: ReadonlyMap<string, ActionPublicationField>,
  issues: PublicationIssue[],
  origin: ActionIssueOrigin,
): void {
  for (const reference of [action.title, action.dueAt]) {
    if (reference.source !== 'SOURCE_FIELD') continue;
    if (sourceFields.has(reference.fieldKey)) continue;
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.invalid,
        `执行动作「${action.key}」引用了当前记录中不存在的字段「${reference.fieldKey}」。`,
        reference.fieldKey,
      ),
    );
  }
}

/**
 * §15: a `SOURCE_FIELD` copy needs the Source and Target field types to be
 * *identical* — `TEXT→MONEY`, `DATE→DATETIME` and `NUMBER→TEXT` are rejected,
 * and no wider coercion is accepted either. Copying a select field additionally
 * requires every selectable Source option key to be accepted by the target.
 */
function analyzeCopiedField(
  valueSource: ActionValueSource,
  sourceFields: ReadonlyMap<string, ActionPublicationField>,
  targetField: ActionPublicationField,
  issues: PublicationIssue[],
  origin: ActionIssueOrigin,
): void {
  if (valueSource.source !== 'SOURCE_FIELD') return;
  const sourceField = sourceFields.get(valueSource.fieldKey);
  if (!sourceField) {
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.invalid,
        `执行动作「${origin.actionKey}」引用了当前记录中不存在的字段「${valueSource.fieldKey}」。`,
        valueSource.fieldKey,
      ),
    );
    return;
  }
  if (sourceField.type !== targetField.type) {
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.fieldType,
        `执行动作「${origin.actionKey}」把「${valueSource.fieldKey}」（${sourceField.type}）写入「${targetField.fieldKey}」（${targetField.type}），字段类型必须完全一致。`,
        targetField.fieldKey,
      ),
    );
    return;
  }
  if (!isSelectFieldType(targetField.type)) return;

  const accepted = new Set(selectableOptionKeys(targetField));
  const missing = selectableOptionKeys(sourceField).filter(
    (key) => !accepted.has(key),
  );
  if (missing.length === 0) return;
  issues.push(
    actionIssue(
      origin,
      ACTION_ISSUE_CODES.targetField,
      `执行动作「${origin.actionKey}」复制字段「${valueSource.fieldKey}」，但目标字段「${targetField.fieldKey}」不接受选项：${missing.join('、')}。`,
      targetField.fieldKey,
    ),
  );
}

/**
 * §25: the Target Object's CURRENT Active Publication. A Target that names the
 * Source Object itself resolves through this pending publication, exactly as
 * the runtime does (`action-engine.ts` `resolveObjectFor()`), so the first
 * publication of an object whose workflow creates a record in that same object
 * is not refused for "not published yet".
 */
function resolveTargetSchema(
  input: AnalyzeActionPublicationInput,
  objectCode: string,
  issues: PublicationIssue[],
  origin: ActionIssueOrigin,
): ActionPublicationSchema | null {
  if (objectCode === input.source.code) return input.source.schema;

  const target = input.targets.get(objectCode);
  if (!target) {
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.targetObject,
        `找不到目标业务对象「${objectCode}」，无法发布该执行动作。`,
      ),
    );
    return null;
  }
  if (target.status !== 'ACTIVE') {
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.targetObject,
        `目标业务对象「${objectCode}」当前不是启用状态，无法创建记录。`,
      ),
    );
    return null;
  }
  if (target.schema === null) {
    issues.push(
      actionIssue(
        origin,
        ACTION_ISSUE_CODES.targetObject,
        `目标业务对象「${objectCode}」尚未发布，无法创建记录。`,
      ),
    );
    return null;
  }
  return target.schema;
}

/**
 * §26: the Employee default permission of a schema, resolved through the SAME
 * implementation the runtime uses (`effective-access.ts`) — including its
 * `isSystem` → READ_ONLY rule and its "no employee policy means no access"
 * fallback. `null` means "the Transition cannot be run by an employee", so no
 * Employee check applies. Member Override is deliberately not consulted: §26
 * keeps it a runtime decision.
 */
function employeeAccessFor(
  transition: ActionPublicationTransition,
  schema: ActionPublicationSchema,
): ReturnType<typeof resolveEffectiveAccess> | null {
  return transition.allowedRoles.includes(EMPLOYEE_ROLE)
    ? resolveEffectiveAccess({ schema, role: EMPLOYEE_ROLE })
    : null;
}

function employeeFieldAccess(
  access: ReturnType<typeof resolveEffectiveAccess>,
  fieldKey: string,
): PublishedFieldAccess {
  return access.fields[fieldKey] ?? 'HIDDEN';
}

function fieldMap(
  schema: ActionPublicationSchema,
): Map<string, ActionPublicationField> {
  return new Map(schema.fields.map((field) => [field.fieldKey, field]));
}

function isSelectFieldType(type: PublishedFieldType): boolean {
  return type === 'SINGLE_SELECT' || type === 'MULTI_SELECT';
}

/**
 * The option keys a select field can actually hold: declared, well-formed and
 * not deactivated. Deactivated options stay in records, so they are not treated
 * as "copyable" keys the Target must accept.
 */
function selectableOptionKeys(field: ActionPublicationField): string[] {
  const options = field.config.options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (
      typeof option !== 'object' ||
      option === null ||
      Array.isArray(option)
    ) {
      return [];
    }
    const record = option as Record<string, JsonValue>;
    if (typeof record.key !== 'string') return [];
    if (record.status === 'INACTIVE') return [];
    return [record.key];
  });
}
