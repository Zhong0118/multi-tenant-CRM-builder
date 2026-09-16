"use client";

import { Alert, Button, Input, InputNumber, Select, Space, Typography } from "antd";
import type { SelectProps } from "antd";

import type { FieldErrors } from "@/lib/api/api-error";

import type { ObjectDraft, PublishedFieldType } from "./object-types";
import {
  ACTION_OUTPUT_LABELS,
  ACTION_OUTPUT_PROPERTIES,
  ACTION_SOURCE_META_LABELS,
  ACTION_SOURCE_META_PROPERTIES,
  MAX_ACTIONS_PER_TRANSITION,
  MAX_DUE_AT_OFFSET_DAYS,
  MAX_FIELD_MAPPINGS_PER_ACTION,
  MAX_FOLLOW_UP_TITLE_LENGTH,
  WORKFLOW_ACTION_LABELS,
  WORKFLOW_ACTION_TYPES,
  type ActionDateTimeValueSource,
  type ActionOutputProperty,
  type ActionRecordRef,
  type ActionSourceMetaProperty,
  type ActionStringSource,
  type ActionValueSource,
  type ActionValueSourceKind,
  type WorkflowActionDraft,
  type WorkflowActionType,
} from "./workflow-types";

import styles from "./objects.module.css";

/**
 * The ordered Action step editor of ONE Transition (§33).
 *
 * V1 is explicitly not a node canvas: the design is an ordered list with plain
 * buttons and selects, exactly as the spec sketches it. Everything the editor
 * knows about the *target* of a CREATE_RECORD comes from the existing admin
 * object list, so no new endpoint is introduced.
 */
export interface WorkflowActionEditorProps {
  /** 0-based index of the owning Transition, used to build unique labels. */
  transitionIndex: number;
  /** Ordered Action steps of the Transition (§28). */
  actions: WorkflowActionDraft[];
  onChange: (actions: WorkflowActionDraft[]) => void;
  /** Fields of the record the Transition runs on — the source of every mapping. */
  sourceFields: ActionTargetField[];
  /** Objects a CREATE_RECORD may target, with their published fields. */
  targetObjects: ActionTargetObject[];
  /** §34: backend field paths already attributed to this Transition. */
  errors?: ActionFieldPathError[];
}

/** One selectable field of a source or target schema. */
export interface ActionTargetField {
  fieldKey: string;
  label: string;
  type: PublishedFieldType;
}

export interface ActionTargetObject {
  code: string;
  name: string;
  fields: ActionTargetField[];
}

/**
 * §34: one field-error the API reported for this Transition's Actions.
 *
 * The API answers with paths like `transitions.0.actions.1.values.phone`, which
 * the generic failure message cannot express — the designer has to locate the
 * transition, the step and the field itself.
 */
export interface ActionFieldPathError {
  /** 0-based step index the path names; `null` when it names the whole list. */
  actionIndex: number | null;
  /** The API's exact field path, rendered verbatim. */
  field: string;
  messages: string[];
}

/**
 * §25: the objects a `CREATE_RECORD` may target.
 *
 * The rule mirrors the publish analyzer's `resolveTargetSchema()`: a target must
 * exist and be ACTIVE with a live publication — except the object being edited,
 * whose pending publication is what the analyzer resolves it through.
 *
 * Fields come from the *published* type, not the draft type: the Action Engine
 * resolves the Target Object's current Active Publication at execution time, so
 * a field that has never been published cannot be written by an Action. For the
 * object being edited the pending publication freezes its own ACTIVE draft
 * fields instead.
 */
export function actionTargetObjects(
  objects: readonly ObjectDraft[],
  current: ObjectDraft,
): ActionTargetObject[] {
  return objects
    .filter((object) => object.object.id === current.object.id || isPublishedObject(object))
    .map((object) => ({
      code: object.object.code,
      name: object.object.name,
      fields:
        object.object.id === current.object.id
          ? current.fields
              .filter((field) => field.status === "ACTIVE")
              .map((field) => ({
                fieldKey: field.fieldKey,
                label: field.label,
                type: field.type,
              }))
          : object.fields.flatMap((field) =>
              field.publishedType === null
                ? []
                : [
                    {
                      fieldKey: field.fieldKey,
                      label: field.label,
                      type: field.publishedType,
                    },
                  ],
            ),
    }));
}

function isPublishedObject(object: ObjectDraft): boolean {
  return object.object.status === "ACTIVE" && object.object.publicationNumber !== null;
}

/**
 * §34: every field error the API reported for one Transition's Actions, with
 * the step it belongs to. `fieldErrors` keys are the API's own paths, so the
 * path is handed to the editor verbatim instead of being parsed into prose.
 */
export function actionFieldErrors(
  fieldErrors: FieldErrors,
  transitionIndex: number,
): ActionFieldPathError[] {
  const prefix = `transitions.${transitionIndex}.actions`;
  const errors: ActionFieldPathError[] = [];
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (field !== prefix && !field.startsWith(`${prefix}.`)) continue;
    const match = /^\.(\d+)(?:\.|$)/.exec(field.slice(prefix.length));
    errors.push({
      actionIndex: match ? Number(match[1]) : null,
      field,
      messages,
    });
  }
  return errors;
}

/**
 * §16/§17: why one `ACTION_OUTPUT` reference cannot be sent as it stands, or
 * `null` while it is still valid.
 *
 * This mirrors the API's own reference resolver
 * (`apps/api/src/modules/actions/action-draft.policy.ts` →
 * `createReferenceResolver().assertOutput`): the referenced Action must still
 * exist, must sit at a LOWER index than the Action reading it, and must
 * actually produce the property being read. 上移 / 下移, 删除, editing an
 * Action's key and changing its type each break one of the three, so the editor
 * recomputes them on every render instead of letting the save fail with a raw
 * `ACTION_OUTPUT:<key>` value as the only clue.
 */
export function actionOutputError(
  reference: { actionKey: string; property: ActionOutputProperty },
  actions: readonly WorkflowActionDraft[],
  stepIndex: number,
): string | null {
  if (reference.actionKey === "") return "请选择要引用的前序执行动作。";
  let referenced: WorkflowActionDraft | undefined;
  let referencedIndex = -1;
  for (const [index, action] of actions.entries()) {
    if (action.key !== reference.actionKey) continue;
    referenced = action;
    referencedIndex = index;
    break;
  }
  const name = `「${reference.actionKey}」`;
  if (referenced === undefined) {
    return `引用的执行动作${name}已不存在，请重新选择或恢复该步骤的编码。`;
  }
  if (referencedIndex >= stepIndex) {
    return `引用的执行动作${name}是第 ${referencedIndex + 1} 步，必须排在当前步骤之前。`;
  }
  if (
    !ACTION_OUTPUT_PROPERTIES[referenced.type].includes(reference.property)
  ) {
    return `执行动作${name}不提供「${ACTION_OUTPUT_LABELS[reference.property]}」输出，请重新选择。`;
  }
  return null;
}

/** §17: the same check for a typed record reference — a relation side or a follow-up target. */
export function recordReferenceError(
  ref: ActionRecordRef,
  actions: readonly WorkflowActionDraft[],
  stepIndex: number,
): string | null {
  return ref.source === "SOURCE_RECORD"
    ? null
    : actionOutputError(ref, actions, stepIndex);
}

/**
 * §15/§22: a `SOURCE_FIELD` source names a field of the CURRENT record. The
 * field list is the draft's ACTIVE fields, so deactivating or removing a field
 * leaves the stored key dangling — the API rejects the whole step, and the
 * editor names the control to fix instead of showing the bare key.
 */
export function sourceFieldReferenceError(
  fieldKey: string,
  sourceFields: readonly ActionTargetField[],
): string | null {
  if (fieldKey === "") return null;
  if (sourceFields.some((field) => field.fieldKey === fieldKey)) return null;
  return `引用的当前记录字段「${fieldKey}」已不存在，请重新选择。`;
}

/** §22: 跟进时间 additionally requires a DATE / DATETIME field. */
export function dueAtFieldReferenceError(
  fieldKey: string,
  sourceFields: readonly ActionTargetField[],
): string | null {
  const missing = sourceFieldReferenceError(fieldKey, sourceFields);
  if (missing !== null) return missing;
  const field = sourceFields.find((candidate) => candidate.fieldKey === fieldKey);
  if (field === undefined || field.type === "DATE" || field.type === "DATETIME") {
    return null;
  }
  return `「${field.label}」不是日期或时间字段，不能作为跟进时间。`;
}

export function WorkflowActionEditor({
  transitionIndex,
  actions,
  onChange,
  sourceFields,
  targetObjects,
  errors,
}: WorkflowActionEditorProps) {
  const stepNumber = transitionIndex + 1;
  const atLimit = actions.length >= MAX_ACTIONS_PER_TRANSITION;

  const editorErrors: ActionFieldPathError[] = [];
  const stepErrors = new Map<number, ActionFieldPathError[]>();
  for (const error of errors ?? []) {
    if (error.actionIndex === null || error.actionIndex >= actions.length) {
      editorErrors.push(error);
      continue;
    }
    stepErrors.set(error.actionIndex, [
      ...(stepErrors.get(error.actionIndex) ?? []),
      error,
    ]);
  }

  return (
    <section className={styles.actionEditor} aria-label={`执行动作 ${stepNumber}`}>
      <div className={styles.actionEditorHead}>
        <div>
          <Typography.Text strong>执行动作</Typography.Text>
          <Typography.Text type="secondary">
            {" "}
            按顺序执行；每个流程动作最多 {MAX_ACTIONS_PER_TRANSITION} 个执行动作。
          </Typography.Text>
        </div>
        <Button
          size="small"
          disabled={atLimit}
          onClick={() => onChange([...actions, emptyAction("CREATE_RECORD", nextActionKey(actions))])}
        >
          添加执行动作
        </Button>
      </div>

      {editorErrors.length > 0 ? (
        <Alert
          type="error"
          showIcon
          title="执行动作配置有误"
          description={<ActionErrorList errors={editorErrors} />}
        />
      ) : null}

      {actions.length === 0 ? (
        <Typography.Text type="secondary">尚未配置执行动作。</Typography.Text>
      ) : null}

      {actions.map((action, index) => {
        const actionErrors = stepErrors.get(index) ?? [];
        return (
          <div
            key={`action-step-${index}`}
            className={styles.actionStep}
            data-action-step={index + 1}
          >
            <div className={styles.actionStepHead}>
              <Typography.Text strong>步骤 {index + 1}</Typography.Text>
              <Space size={4}>
                <Button
                  size="small"
                  aria-label={`上移步骤 ${stepNumber}-${index + 1}`}
                  disabled={index === 0}
                  onClick={() => onChange(moveAt(actions, index, index - 1))}
                >
                  上移
                </Button>
                <Button
                  size="small"
                  aria-label={`下移步骤 ${stepNumber}-${index + 1}`}
                  disabled={index === actions.length - 1}
                  onClick={() => onChange(moveAt(actions, index, index + 1))}
                >
                  下移
                </Button>
                <Button
                  size="small"
                  danger
                  aria-label={`删除步骤 ${stepNumber}-${index + 1}`}
                  onClick={() =>
                    onChange(actions.filter((_, current) => current !== index))
                  }
                >
                  删除
                </Button>
              </Space>
            </div>

            {actionErrors.length > 0 ? (
              <Alert type="error" showIcon title={<ActionErrorList errors={actionErrors} />} />
            ) : null}

            <div className={styles.actionStepForm}>
              <label className={styles.actionField}>
                <span>执行动作类型</span>
                <ActionSelect
                  name={`执行动作类型 ${stepNumber}-${index + 1}`}
                  value={action.type}
                  style={{ minWidth: 180 }}
                  options={WORKFLOW_ACTION_TYPES.map((type) => ({
                    value: type,
                    label: WORKFLOW_ACTION_LABELS[type],
                  }))}
                  onChange={(type: WorkflowActionType) =>
                    // A type change is a different Action: keeping the previous
                    // type's payload would send keys the API rejects.
                    onChange(
                      replaceAt(actions, index, emptyAction(type, action.key)),
                    )
                  }
                />
              </label>
              <label className={styles.actionField}>
                <span>执行动作编码</span>
                <Input
                  aria-label={`执行动作编码 ${stepNumber}-${index + 1}`}
                  value={action.key}
                  placeholder="例如 create-customer"
                  style={{ minWidth: 180 }}
                  onChange={(event) =>
                    onChange(
                      replaceAt(actions, index, {
                        ...action,
                        key: event.target.value,
                      }),
                    )
                  }
                />
              </label>
            </div>

            <ActionStepBody
              action={action}
              transitionIndex={transitionIndex}
              stepIndex={index}
              actions={actions}
              sourceFields={sourceFields}
              targetObjects={targetObjects}
              onChange={(next) => onChange(replaceAt(actions, index, next))}
            />
          </div>
        );
      })}
    </section>
  );
}

interface ActionStepBodyProps {
  action: WorkflowActionDraft;
  transitionIndex: number;
  stepIndex: number;
  /**
   * The WHOLE step list, not just the steps before this one: reference
   * validation has to tell "no longer exists" from "moved after me", and only
   * the full list can.
   */
  actions: readonly WorkflowActionDraft[];
  sourceFields: ActionTargetField[];
  targetObjects: ActionTargetObject[];
  onChange: (action: WorkflowActionDraft) => void;
}

/** §33: one layout per Action type — no single generic form. */
function ActionStepBody({
  action,
  transitionIndex,
  stepIndex,
  actions,
  sourceFields,
  targetObjects,
  onChange,
}: ActionStepBodyProps) {
  const prefix = `${transitionIndex + 1}-${stepIndex + 1}`;
  const priorActions = actions.slice(0, stepIndex);

  switch (action.type) {
    case "CREATE_RECORD": {
      const target = targetObjects.find(
        (object) => object.code === action.targetObjectCode,
      );
      return (
        <>
          <label className={styles.actionField}>
            <span>目标业务表</span>
            <ActionSelect
              name={`目标业务表 ${prefix}`}
              value={action.targetObjectCode === "" ? undefined : action.targetObjectCode}
              placeholder="选择目标业务表"
              status={action.targetObjectCode === "" ? "error" : undefined}
              style={{ minWidth: 180 }}
              options={targetObjects.map((object) => ({
                value: object.code,
                label: object.name,
              }))}
              onChange={(targetObjectCode: string) =>
                // The mappings named the previous target's fields; keeping them
                // would silently ship a mapping the analyzer must reject.
                onChange({ ...action, targetObjectCode, values: {} })
              }
            />
          </label>
          {action.targetObjectCode === "" ? (
            <Typography.Text type="danger">请选择目标业务表。</Typography.Text>
          ) : null}
          <MappingEditor
            transitionIndex={transitionIndex}
            stepIndex={stepIndex}
            actions={actions}
            values={action.values}
            fields={target?.fields ?? []}
            sourceFields={sourceFields}
            onChange={(values) => onChange({ ...action, values })}
          />
          <label className={styles.actionField}>
            <span>记录负责人</span>
            <ActionSelect
              name={`记录负责人 ${prefix}`}
              value={ownerValue(action.owner)}
              style={{ minWidth: 200 }}
              options={[
                { value: "NONE", label: "不指定（沿用默认负责人）" },
                { value: "ACTOR", label: "执行人" },
                { value: "SOURCE_OWNER", label: "当前记录负责人" },
              ]}
              onChange={(next: string) => {
                const owner = toMemberSource(next);
                // An unconfigured optional key stays absent: the API treats
                // `null` as a value and rejects it, and drops the owner rule
                // back to the ordinary record-create default.
                if (owner === null) {
                  onChange({
                    key: action.key,
                    type: action.type,
                    targetObjectCode: action.targetObjectCode,
                    values: action.values,
                  });
                  return;
                }
                onChange({ ...action, owner });
              }}
            />
          </label>
        </>
      );
    }

    case "UPDATE_RECORD":
      return (
        <>
          <Typography.Text type="secondary">
            目标固定为当前记录，只能修改本记录自己的字段；V1 不允许更新其它记录。
          </Typography.Text>
          <MappingEditor
            transitionIndex={transitionIndex}
            stepIndex={stepIndex}
            actions={actions}
            values={action.values}
            fields={sourceFields}
            sourceFields={sourceFields}
            onChange={(values) => onChange({ ...action, values })}
          />
        </>
      );

    case "CREATE_RELATION": {
      const leftError = recordReferenceError(action.left, actions, stepIndex);
      const rightError = recordReferenceError(action.right, actions, stepIndex);
      return (
        <>
          <Typography.Text type="secondary">
            记录引用只能选择当前记录或前序「创建记录」步骤的输出。
          </Typography.Text>
          <div className={styles.actionStepForm}>
            <label className={styles.actionField}>
              <span>左侧记录</span>
              <ActionSelect
                name={`左侧记录 ${prefix}`}
                value={referenceValue(action.left)}
                status={leftError === null ? undefined : "error"}
                style={{ minWidth: 220 }}
                options={referenceOptions(priorActions, action.left)}
                onChange={(next: string) =>
                  onChange({ ...action, left: toRecordRef(next) })
                }
              />
              {leftError === null ? null : (
                <Typography.Text type="danger">{leftError}</Typography.Text>
              )}
            </label>
            <label className={styles.actionField}>
              <span>右侧记录</span>
              <ActionSelect
                name={`右侧记录 ${prefix}`}
                value={referenceValue(action.right)}
                status={rightError === null ? undefined : "error"}
                style={{ minWidth: 220 }}
                options={referenceOptions(priorActions, action.right)}
                onChange={(next: string) =>
                  onChange({ ...action, right: toRecordRef(next) })
                }
              />
              {rightError === null ? null : (
                <Typography.Text type="danger">{rightError}</Typography.Text>
              )}
            </label>
          </div>
        </>
      );
    }

    case "CREATE_FOLLOW_UP": {
      const targetError = recordReferenceError(action.target, actions, stepIndex);
      const titleError =
        action.title.source === "SOURCE_FIELD"
          ? sourceFieldReferenceError(action.title.fieldKey, sourceFields)
          : null;
      const dueAtError =
        action.dueAt.source === "SOURCE_FIELD"
          ? dueAtFieldReferenceError(action.dueAt.fieldKey, sourceFields)
          : null;
      return (
        <>
          <div className={styles.actionStepForm}>
            <label className={styles.actionField}>
              <span>目标记录</span>
              <ActionSelect
                name={`目标记录 ${prefix}`}
                value={referenceValue(action.target)}
                status={targetError === null ? undefined : "error"}
                style={{ minWidth: 220 }}
                options={referenceOptions(priorActions, action.target)}
                onChange={(next: string) =>
                  onChange({ ...action, target: toRecordRef(next) })
                }
              />
              {targetError === null ? null : (
                <Typography.Text type="danger">{targetError}</Typography.Text>
              )}
            </label>
            <label className={styles.actionField}>
              <span>标题来源</span>
              <ActionSelect
                name={`标题来源 ${prefix}`}
                value={action.title.source}
                style={{ minWidth: 160 }}
                options={[
                  { value: "LITERAL", label: "固定文本" },
                  { value: "SOURCE_FIELD", label: "当前记录字段" },
                ]}
                onChange={(source: ActionStringSource["source"]) =>
                  onChange({
                    ...action,
                    title:
                      source === "LITERAL"
                        ? { source: "LITERAL", value: "" }
                        : { source: "SOURCE_FIELD", fieldKey: "" },
                  })
                }
              />
            </label>
            {action.title.source === "LITERAL" ? (
              <label className={styles.actionField}>
                <span>标题内容</span>
                <Input
                  aria-label={`标题内容 ${prefix}`}
                  value={action.title.value}
                  maxLength={MAX_FOLLOW_UP_TITLE_LENGTH}
                  placeholder="例如 首次回访"
                  style={{ minWidth: 200 }}
                  onChange={(event) =>
                    onChange({
                      ...action,
                      title: { source: "LITERAL", value: event.target.value },
                    })
                  }
                />
              </label>
            ) : (
              <label className={styles.actionField}>
                <span>标题字段</span>
                <ActionSelect
                  name={`标题字段 ${prefix}`}
                  value={action.title.fieldKey === "" ? undefined : action.title.fieldKey}
                  placeholder="选择标题字段"
                  status={
                    action.title.fieldKey === "" || titleError !== null
                      ? "error"
                      : undefined
                  }
                  style={{ minWidth: 200 }}
                  options={sourceFields.map((field) => ({
                    value: field.fieldKey,
                    label: field.label,
                  }))}
                  onChange={(fieldKey: string) =>
                    onChange({
                      ...action,
                      title: { source: "SOURCE_FIELD", fieldKey },
                    })
                  }
                />
                {titleError === null ? null : (
                  <Typography.Text type="danger">{titleError}</Typography.Text>
                )}
              </label>
            )}
          </div>
          <div className={styles.actionStepForm}>
            <label className={styles.actionField}>
              <span>跟进时间</span>
              <ActionSelect
                name={`跟进时间 ${prefix}`}
                value={action.dueAt.source}
                style={{ minWidth: 160 }}
                options={[
                  { value: "NOW", label: "当前时间" },
                  { value: "NOW_PLUS_DAYS", label: "当前时间加天数" },
                  { value: "LITERAL_DATETIME", label: "固定时间" },
                  { value: "SOURCE_FIELD", label: "当前记录字段" },
                ]}
                onChange={(source: ActionDateTimeValueSource["source"]) =>
                  onChange({
                    ...action,
                    dueAt: emptyDateTimeSource(source),
                  })
                }
              />
            </label>
            {renderDueAtControl(
              action.dueAt,
              prefix,
              sourceFields,
              dueAtError,
              (dueAt) => onChange({ ...action, dueAt }),
            )}
            <label className={styles.actionField}>
              <span>跟进人</span>
              <ActionSelect
                name={`跟进人 ${prefix}`}
                value={action.assignee.source}
                style={{ minWidth: 180 }}
                options={[
                  { value: "ACTOR", label: "执行人" },
                  { value: "SOURCE_OWNER", label: "当前记录负责人" },
                ]}
                onChange={(source: "ACTOR" | "SOURCE_OWNER") =>
                  onChange({ ...action, assignee: { source } })
                }
              />
            </label>
          </div>
        </>
      );
    }

    case "ASSIGN_OWNER":
      return (
        <>
          <Typography.Text>将当前记录分配给执行人。</Typography.Text>
          <Typography.Text type="secondary">
            V1 只有公司管理员可以执行该步骤，负责人固定为执行人，因此不提供成员选择。
          </Typography.Text>
        </>
      );
  }
}

function renderDueAtControl(
  dueAt: ActionDateTimeValueSource,
  prefix: string,
  sourceFields: ActionTargetField[],
  /** Why the stored `SOURCE_FIELD` no longer resolves, or `null`. */
  fieldError: string | null,
  onChange: (dueAt: ActionDateTimeValueSource) => void,
) {
  switch (dueAt.source) {
    case "NOW":
      return null;
    case "NOW_PLUS_DAYS":
      return (
        <label className={styles.actionField}>
          <span>跟进天数</span>
          <InputNumber
            aria-label={`跟进天数 ${prefix}`}
            value={dueAt.days}
            min={0}
            max={MAX_DUE_AT_OFFSET_DAYS}
            precision={0}
            style={{ minWidth: 120 }}
            onChange={(days) =>
              onChange({
                source: "NOW_PLUS_DAYS",
                days: typeof days === "number" ? days : 0,
              })
            }
          />
        </label>
      );
    case "LITERAL_DATETIME":
      return (
        <label className={styles.actionField}>
          <span>跟进时间点</span>
          <Input
            aria-label={`跟进时间点 ${prefix}`}
            value={dueAt.value}
            placeholder="例如 2026-10-01T09:00:00.000Z"
            style={{ minWidth: 240 }}
            onChange={(event) =>
              onChange({ source: "LITERAL_DATETIME", value: event.target.value })
            }
          />
        </label>
      );
    case "SOURCE_FIELD":
      return (
        <label className={styles.actionField}>
          <span>跟进时间字段</span>
          <ActionSelect
            name={`跟进时间字段 ${prefix}`}
            value={dueAt.fieldKey === "" ? undefined : dueAt.fieldKey}
            placeholder="选择日期字段"
            status={
              dueAt.fieldKey === "" || fieldError !== null ? "error" : undefined
            }
            style={{ minWidth: 200 }}
            options={sourceFields
              .filter((field) => field.type === "DATE" || field.type === "DATETIME")
              .map((field) => ({ value: field.fieldKey, label: field.label }))}
            onChange={(fieldKey: string) =>
              onChange({ source: "SOURCE_FIELD", fieldKey })
            }
          />
          {fieldError === null ? null : (
            <Typography.Text type="danger">{fieldError}</Typography.Text>
          )}
        </label>
      );
  }
}

interface MappingEditorProps {
  transitionIndex: number;
  stepIndex: number;
  values: Record<string, ActionValueSource>;
  fields: readonly ActionTargetField[];
  sourceFields: readonly ActionTargetField[];
  /** The whole step list — an `ACTION_OUTPUT` mapping may reference any of it. */
  actions: readonly WorkflowActionDraft[];
  onChange: (values: Record<string, ActionValueSource>) => void;
}

/** §33: 目标字段 / 值来源 / 来源值 — one row per mapped field. */
function MappingEditor({
  transitionIndex,
  stepIndex,
  values,
  fields,
  sourceFields,
  actions,
  onChange,
}: MappingEditorProps) {
  const prefix = `${transitionIndex + 1}-${stepIndex + 1}`;
  const rows = Object.entries(values);
  const mapped = new Set(rows.map(([fieldKey]) => fieldKey));
  const available = fields.filter((field) => !mapped.has(field.fieldKey));
  const atLimit = rows.length >= MAX_FIELD_MAPPINGS_PER_ACTION;

  return (
    <div className={styles.actionMappings}>
      <div className={styles.actionMappingHead}>
        <span>目标字段</span>
        <span>值来源</span>
        <span>来源值</span>
      </div>

      {rows.length === 0 ? (
        <Typography.Text type="secondary">尚未配置字段映射。</Typography.Text>
      ) : null}

      {rows.map(([fieldKey, valueSource], rowIndex) => {
        const field = fields.find((candidate) => candidate.fieldKey === fieldKey);
        const fieldType = field?.type ?? "TEXT";
        // The row offers its own field (so the current choice is never rendered
        // as a bare key) plus the fields no other row has claimed. Renaming a
        // row onto a field another row already maps is therefore unreachable,
        // which is what used to drop that other row's source without a word.
        const rowOptions = [
          { value: fieldKey, label: field?.label ?? fieldKey },
          ...available.map((candidate) => ({
            value: candidate.fieldKey,
            label: candidate.label,
          })),
        ];
        return (
          <div key={fieldKey} className={styles.actionMappingRow}>
            <ActionSelect
              name={`映射目标字段 ${prefix}-${rowIndex + 1}`}
              value={fieldKey}
              style={{ minWidth: 160 }}
              options={rowOptions}
              onChange={(next: string) => onChange(renameMapping(values, fieldKey, next))}
            />
            <ActionSelect
              name={`映射值来源 ${prefix}-${rowIndex + 1}`}
              value={valueSource.source}
              style={{ minWidth: 150 }}
              options={valueSourceKinds(fieldType).map((kind) => ({
                value: kind,
                label: VALUE_SOURCE_LABELS[kind],
              }))}
              onChange={(kind: ActionValueSourceKind) =>
                onChange({
                  ...values,
                  [fieldKey]:
                    valueSource.source === kind
                      ? valueSource
                      : emptyValueSource(kind),
                })
              }
            />
            <ValueSourceControl
              label={`${prefix}-${rowIndex + 1}`}
              fieldType={fieldType}
              source={valueSource}
              sourceFields={sourceFields}
              actions={actions}
              stepIndex={stepIndex}
              onChange={(next) => onChange({ ...values, [fieldKey]: next })}
            />
            <Button
              size="small"
              aria-label={`删除字段映射 ${prefix}-${rowIndex + 1}`}
              onClick={() =>
                onChange(omitKey(values, fieldKey))
              }
            >
              删除字段映射
            </Button>
          </div>
        );
      })}

      <ActionSelect
        name={`添加字段映射 ${prefix}`}
        value={undefined}
        placeholder={
          atLimit
            ? `最多 ${MAX_FIELD_MAPPINGS_PER_ACTION} 个字段映射`
            : "添加字段映射"
        }
        disabled={atLimit || available.length === 0}
        style={{ minWidth: 200 }}
        options={available.map((field) => ({
          value: field.fieldKey,
          label: field.label,
        }))}
        onChange={(fieldKey: string) => {
          const field = fields.find((candidate) => candidate.fieldKey === fieldKey);
          if (!field) return;
          onChange({
            ...values,
            [fieldKey]: defaultValueSource(field.type, sourceFields),
          });
        }}
      />
    </div>
  );
}

interface ValueSourceControlProps {
  label: string;
  fieldType: PublishedFieldType;
  source: ActionValueSource;
  sourceFields: readonly ActionTargetField[];
  actions: readonly WorkflowActionDraft[];
  /** 0-based index of the Action this mapping belongs to. */
  stepIndex: number;
  onChange: (source: ActionValueSource) => void;
}

/** The third column: the control the chosen value source actually needs. */
function ValueSourceControl({
  label,
  fieldType,
  source,
  sourceFields,
  actions,
  stepIndex,
  onChange,
}: ValueSourceControlProps) {
  const priorActions = actions.slice(0, stepIndex);
  switch (source.source) {
    case "LITERAL":
      return <LiteralControl label={label} fieldType={fieldType} value={source} onChange={onChange} />;
    case "SOURCE_FIELD": {
      const error = sourceFieldReferenceError(source.fieldKey, sourceFields);
      return (
        <>
          <ActionSelect
            name={`映射来源字段 ${label}`}
            value={source.fieldKey === "" ? undefined : source.fieldKey}
            placeholder="选择来源字段"
            status={
              source.fieldKey === "" || error !== null ? "error" : undefined
            }
            style={{ minWidth: 180 }}
            // §15: a copied field must carry the SAME type as its target.
            options={sourceFields
              .filter((field) => field.type === fieldType)
              .map((field) => ({ value: field.fieldKey, label: field.label }))}
            onChange={(fieldKey: string) => onChange({ source: "SOURCE_FIELD", fieldKey })}
          />
          {error === null ? null : (
            <Typography.Text type="danger">{error}</Typography.Text>
          )}
        </>
      );
    }
    case "SOURCE_META":
      return (
        <ActionSelect
          name={`映射来源属性 ${label}`}
          value={source.property}
          style={{ minWidth: 150 }}
          options={ACTION_SOURCE_META_PROPERTIES.map((property) => ({
            value: property,
            label: ACTION_SOURCE_META_LABELS[property],
          }))}
          onChange={(property: ActionSourceMetaProperty) =>
            onChange({ source: "SOURCE_META", property })
          }
        />
      );
    case "ACTOR":
      return <Typography.Text type="secondary">执行人</Typography.Text>;
    case "ACTION_OUTPUT": {
      const error = actionOutputError(source, actions, stepIndex);
      const value =
        source.actionKey === ""
          ? undefined
          : outputValue(source.actionKey, source.property);
      // §15/§16: only an EARLIER step, and only a property it produces.
      const options = priorActions.flatMap((action, index) =>
        ACTION_OUTPUT_PROPERTIES[action.type].map((property) => ({
          value: outputValue(action.key, property),
          label: `步骤 ${index + 1} · ${ACTION_OUTPUT_LABELS[property]}`,
        })),
      );
      // A reference that no longer resolves is still SHOWN, as an explicitly
      // stale option, so the wire value alone is never the only clue.
      const withCurrent =
        value !== undefined && !options.some((option) => option.value === value)
          ? [
              ...options,
              { value, label: `已失效的引用（${source.actionKey}）` },
            ]
          : options;
      return (
        <>
          <ActionSelect
            name={`映射动作输出 ${label}`}
            value={value}
            placeholder="选择前序步骤输出"
            status={error === null ? undefined : "error"}
            style={{ minWidth: 220 }}
            options={withCurrent}
            onChange={(next: string) => onChange(toOutputSource(next))}
          />
          {error === null ? null : (
            <Typography.Text type="danger">{error}</Typography.Text>
          )}
        </>
      );
    }
    case "NOW":
      return <Typography.Text type="secondary">执行时的当前时间</Typography.Text>;
    case "NOW_PLUS_DAYS":
      return (
        <InputNumber
          aria-label={`映射天数 ${label}`}
          value={source.days}
          min={0}
          max={MAX_DUE_AT_OFFSET_DAYS}
          precision={0}
          style={{ minWidth: 120 }}
          onChange={(days) =>
            onChange({
              source: "NOW_PLUS_DAYS",
              days: typeof days === "number" ? days : 0,
            })
          }
        />
      );
    case "LITERAL_DATETIME":
      return (
        <Input
          aria-label={`映射固定时间 ${label}`}
          value={source.value}
          placeholder="例如 2026-10-01T09:00:00.000Z"
          style={{ minWidth: 240 }}
          onChange={(event) =>
            onChange({ source: "LITERAL_DATETIME", value: event.target.value })
          }
        />
      );
  }
}

interface LiteralControlProps {
  label: string;
  fieldType: PublishedFieldType;
  value: { source: "LITERAL"; value: string | number | boolean };
  onChange: (source: ActionValueSource) => void;
}

/**
 * A literal is validated by the TARGET field's own validator, so the control
 * follows the target field type instead of always collecting text.
 */
function LiteralControl({ label, fieldType, value, onChange }: LiteralControlProps) {
  if (fieldType === "BOOLEAN") {
    return (
      <ActionSelect
        name={`映射固定值 ${label}`}
        value={typeof value.value === "boolean" ? String(value.value) : undefined}
        placeholder="选择布尔值"
        style={{ minWidth: 120 }}
        options={[
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ]}
        onChange={(next: string) =>
          onChange({ source: "LITERAL", value: next === "true" })
        }
      />
    );
  }
  if (fieldType === "NUMBER" || fieldType === "MONEY") {
    return (
      <InputNumber
        aria-label={`映射固定值 ${label}`}
        value={typeof value.value === "number" ? value.value : undefined}
        placeholder="输入数值"
        style={{ minWidth: 140 }}
        onChange={(next) =>
          // An emptied number box is "not filled in yet"; the API rejects
          // `null`, so the empty string is the placeholder until it is typed.
          onChange({
            source: "LITERAL",
            value: typeof next === "number" ? next : "",
          })
        }
      />
    );
  }
  return (
    <Input
      aria-label={`映射固定值 ${label}`}
      value={typeof value.value === "string" ? value.value : ""}
      placeholder="输入固定值"
      style={{ minWidth: 180 }}
      onChange={(event) =>
        onChange({ source: "LITERAL", value: event.target.value })
      }
    />
  );
}

function ActionErrorList({ errors }: { errors: ActionFieldPathError[] }) {
  return (
    <ul className={styles.actionErrorList}>
      {errors.map((error) => (
        <li key={error.field}>
          <code>{error.field}</code>
          <span>{error.messages.join("；")}</span>
        </li>
      ))}
    </ul>
  );
}

const VALUE_SOURCE_LABELS: Record<ActionValueSourceKind, string> = {
  LITERAL: "固定值",
  SOURCE_FIELD: "当前记录字段",
  SOURCE_META: "当前记录属性",
  ACTOR: "执行人",
  ACTION_OUTPUT: "前序动作输出",
  NOW: "当前时间",
  NOW_PLUS_DAYS: "当前时间加天数",
  LITERAL_DATETIME: "固定时间",
};

/**
 * §15: the mapping sources of one target field. The three temporal sources are
 * only offered for DATE/DATETIME targets, because the resolver rejects them for
 * every other field type.
 */
function valueSourceKinds(
  type: PublishedFieldType,
): ActionValueSourceKind[] {
  const kinds: ActionValueSourceKind[] = [
    "LITERAL",
    "SOURCE_FIELD",
    "SOURCE_META",
    "ACTOR",
    "ACTION_OUTPUT",
  ];
  if (type === "DATE" || type === "DATETIME") {
    kinds.push("NOW", "NOW_PLUS_DAYS", "LITERAL_DATETIME");
  }
  return kinds;
}

function emptyValueSource(kind: ActionValueSourceKind): ActionValueSource {
  switch (kind) {
    case "LITERAL":
      return { source: "LITERAL", value: "" };
    case "SOURCE_FIELD":
      return { source: "SOURCE_FIELD", fieldKey: "" };
    case "SOURCE_META":
      return { source: "SOURCE_META", property: "recordId" };
    case "ACTOR":
      return { source: "ACTOR" };
    case "ACTION_OUTPUT":
      return { source: "ACTION_OUTPUT", actionKey: "", property: "recordId" };
    case "NOW":
      return { source: "NOW" };
    case "NOW_PLUS_DAYS":
      return { source: "NOW_PLUS_DAYS", days: 0 };
    case "LITERAL_DATETIME":
      return { source: "LITERAL_DATETIME", value: "" };
  }
}

/**
 * The mapping a newly added row starts with: the first source field of the
 * exact same type, or an unset `SOURCE_FIELD` the administrator must fill in.
 */
function defaultValueSource(
  type: PublishedFieldType,
  sourceFields: readonly ActionTargetField[],
): ActionValueSource {
  const match = sourceFields.find((field) => field.type === type);
  return { source: "SOURCE_FIELD", fieldKey: match?.fieldKey ?? "" };
}

function emptyDateTimeSource(
  source: ActionDateTimeValueSource["source"],
): ActionDateTimeValueSource {
  switch (source) {
    case "NOW":
      return { source: "NOW" };
    case "NOW_PLUS_DAYS":
      return { source: "NOW_PLUS_DAYS", days: 0 };
    case "LITERAL_DATETIME":
      return { source: "LITERAL_DATETIME", value: "" };
    case "SOURCE_FIELD":
      return { source: "SOURCE_FIELD", fieldKey: "" };
  }
}

/** §7/§28: a brand new step is complete for every type except CREATE_RECORD. */
function emptyAction(
  type: WorkflowActionType,
  key: string,
): WorkflowActionDraft {
  switch (type) {
    case "CREATE_RECORD":
      return { key, type, targetObjectCode: "", values: {} };
    case "UPDATE_RECORD":
      return { key, type, target: "SOURCE_RECORD", values: {} };
    case "CREATE_RELATION":
      return {
        key,
        type,
        left: { source: "SOURCE_RECORD" },
        right: { source: "SOURCE_RECORD" },
      };
    case "CREATE_FOLLOW_UP":
      return {
        key,
        type,
        target: { source: "SOURCE_RECORD" },
        title: { source: "LITERAL", value: "" },
        dueAt: { source: "NOW" },
        assignee: { source: "ACTOR" },
      };
    case "ASSIGN_OWNER":
      return { key, type, target: "SOURCE_RECORD", owner: { source: "ACTOR" } };
  }
}

/** A default key that does not collide with a step already in the list. */
function nextActionKey(actions: readonly WorkflowActionDraft[]): string {
  const used = new Set(actions.map((action) => action.key));
  let index = 1;
  while (used.has(`action-${index}`)) index += 1;
  return `action-${index}`;
}

/**
 * The DOM id of one editor control, derived from its unique name.
 *
 * antd derives the ARIA listbox id from the select's own id, and every select
 * otherwise shares one generated id in a test environment — so the dropdown of
 * a specific select cannot be told apart from a stale one. A stable id keeps
 * each control's listbox, and therefore its dropdown, unambiguous.
 */
function actionControlId(name: string): string {
  return `workflow-action-${name.replace(/\s+/g, "-")}`;
}

type ActionSelectProps = Omit<SelectProps, "id" | "aria-label"> & {
  /** Unique, human-readable control name; also the accessible name. */
  name: string;
};

/** A labelled Select whose accessible name and id come from one string. */
function ActionSelect({ name, ...props }: ActionSelectProps) {
  return <Select {...props} id={actionControlId(name)} aria-label={name} />;
}

/**
 * §17: only the current record and earlier CREATE_RECORD outputs are offered.
 *
 * `current` is the reference the step already holds. When it no longer
 * resolves it is still returned — labelled as stale rather than as the bare
 * `ACTION_OUTPUT:<key>` wire value — because dropping it would silently rewrite
 * the administrator's configuration.
 */
function referenceOptions(
  priorActions: readonly WorkflowActionDraft[],
  current?: ActionRecordRef,
): Array<{ value: string; label: string }> {
  const options = [
    { value: "SOURCE_RECORD", label: "当前记录" },
    ...priorActions.flatMap((action, index) =>
      action.type === "CREATE_RECORD"
        ? [
            {
              value: `ACTION_OUTPUT:${action.key}`,
              label: `步骤 ${index + 1}（${action.key}）`,
            },
          ]
        : [],
    ),
  ];
  const currentValue = current === undefined ? null : referenceValue(current);
  if (
    currentValue === null ||
    currentValue === "SOURCE_RECORD" ||
    options.some((option) => option.value === currentValue)
  ) {
    return options;
  }
  return [
    ...options,
    {
      value: currentValue,
      label: `已失效的引用（${
        current !== undefined && current.source === "ACTION_OUTPUT"
          ? current.actionKey
          : ""
      }）`,
    },
  ];
}

function referenceValue(ref: ActionRecordRef): string {
  return ref.source === "SOURCE_RECORD"
    ? "SOURCE_RECORD"
    : `ACTION_OUTPUT:${ref.actionKey}`;
}

function toRecordRef(value: string): ActionRecordRef {
  if (value === "SOURCE_RECORD") return { source: "SOURCE_RECORD" };
  return {
    source: "ACTION_OUTPUT",
    actionKey: value.slice("ACTION_OUTPUT:".length),
    property: "recordId",
  };
}

function outputValue(actionKey: string, property: ActionOutputProperty): string {
  return `${actionKey}:${property}`;
}

function toOutputSource(value: string): ActionValueSource {
  const separator = value.indexOf(":");
  const actionKey = value.slice(0, separator);
  const property = value.slice(separator + 1);
  if (!isOutputProperty(property)) {
    // The value can only come from this component's own option list.
    throw new Error(`未知的执行动作输出属性「${property}」`);
  }
  return { source: "ACTION_OUTPUT", actionKey, property };
}

function isOutputProperty(value: string): value is ActionOutputProperty {
  return Object.values(ACTION_OUTPUT_PROPERTIES).some((properties) =>
    (properties as readonly string[]).includes(value),
  );
}

function ownerValue(owner: { source: "ACTOR" | "SOURCE_OWNER" } | undefined): string {
  return owner?.source ?? "NONE";
}

function toMemberSource(value: string): { source: "ACTOR" | "SOURCE_OWNER" } | null {
  if (value === "ACTOR" || value === "SOURCE_OWNER") return { source: value };
  return null;
}

function omitKey(
  values: Record<string, ActionValueSource>,
  drop: string,
): Record<string, ActionValueSource> {
  return Object.fromEntries(
    Object.entries(values).filter(([fieldKey]) => fieldKey !== drop),
  );
}

function renameMapping(
  values: Record<string, ActionValueSource>,
  from: string,
  to: string,
): Record<string, ActionValueSource> {
  return Object.fromEntries(
    Object.entries(values).map(([fieldKey, value]) => [
      fieldKey === from ? to : fieldKey,
      value,
    ]),
  );
}

function moveAt<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, current) => (current === index ? next : item));
}
