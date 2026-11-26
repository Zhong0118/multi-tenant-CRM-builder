"use client";

import { FeatureGate } from "@/features/ai-governance/access";
import {
  CloseOutlined,
  FilterOutlined,
  PlusOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Popover, Select } from "antd";
import {
  FILTER_FIELD_OPERATORS,
  FILTER_OPERATORS,
  RELATIVE_DATE_PRESETS,
  recordFilterFieldType,
  parseFilterRule,
  validateFilterCondition,
  type FilterCondition,
  type FilterPreview,
  type FilterPreviewRequest,
  type PreviewChoice,
  type FilterFieldType,
  type FilterGroup,
  type FilterOperator,
  type FilterRule,
  type FilterValue,
} from "@crm/contracts";
import { useEffect, useRef, useState } from "react";
import {
  selectOptions,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { AiBadge } from "@/components/ai/ai-badge";
import { AiSparkIcon } from "@/components/icons/ai-spark-icon";
import { usePublishEditorDraft } from "@/features/ai/assistant-filter-draft";
import { PreviewChoices } from "@/components/forms/preview-choices";
import type { DynamicFieldMember } from "./dynamic-field";
import { RELATIVE_DATE_PRESET_LABELS } from "./record-query-state";
import { queryFields } from "./record-access";
import styles from "./record-filter-panel.module.css";

export interface RecordFilterPanelProps {
  schema: Pick<RuntimeObjectSchema, "fields" | "queryFieldKeys">;
  members: DynamicFieldMember[];
  rule: FilterRule;
  onApply: (rule: FilterRule) => void;
  onPreview: (
    request: FilterPreviewRequest,
    signal: AbortSignal,
  ) => Promise<FilterPreview>;
  isAdmin: boolean;
  editIndex: number | null;
  onEditIndex: (index: number | null) => void;
}
type Term = FilterCondition | FilterGroup;
type Option = { label: string; value: string };
type Field = {
  key: string;
  label: string;
  type: FilterFieldType;
  options: Option[];
};

function availableFields({ schema, members }: RecordFilterPanelProps): Field[] {
  const memberOptions = [
    { value: "$me", label: "我" },
    ...members.map((member) => ({
      value: member.id,
      label: member.displayName ?? "未设置姓名",
    })),
  ];
  return [
    ...queryFields(schema).map((field) => ({
      key: field.fieldKey,
      label: field.label,
      type: recordFilterFieldType(field) as FilterFieldType,
      options:
        field.type === "MEMBER"
          ? memberOptions
          : selectOptions(field)
              .filter((option) => option.status === "ACTIVE")
              .map((option) => ({ label: option.label, value: option.key })),
    })),
    { key: "$owner", label: "负责人", type: "OWNER", options: memberOptions },
    { key: "$followUp", label: "待跟进", type: "FOLLOW_UP", options: [] },
  ];
}

function leafCount(group: FilterGroup): number {
  return group.conditions.reduce(
    (total, child) => total + ("conditions" in child ? leafCount(child) : 1),
    0,
  );
}
function describeTerm(term: Term, fields: Field[], isAdmin: boolean): string {
  if ("conditions" in term) {
    const joiner = term.match === "all" ? " 且 " : " 或 ";
    return `${term.match === "all" ? "全部" : "任一"}（${term.conditions.map((item) => describeTerm(item, fields, isAdmin)).join(joiner)}）`;
  }
  const field = fields.find((f) => f.key === term.fieldKey);
  if (!field) return "条件不可用";
  const { value, operator } = term;
  const label = FILTER_OPERATORS[operator].label;
  if (operator === "dueThroughToday") {
    const team =
      value &&
      typeof value === "object" &&
      "assignee" in value &&
      value.assignee === "any";
    return `今天待跟进 · ${team && isAdmin ? "任何人" : "我"}`;
  }
  let text: string;
  if (Array.isArray(value))
    text = value
      .map(
        (v) =>
          field.options.find((option) => option.value === v)?.label ??
          "选项不可用",
      )
      .join(" / ");
  else if (operator === "relative")
    text =
      RELATIVE_DATE_PRESET_LABELS[
        value as keyof typeof RELATIVE_DATE_PRESET_LABELS
      ];
  else if (typeof value === "boolean") text = value ? "是" : "否";
  else if (value && typeof value === "object" && "from" in value)
    text = `${value.from} 至 ${value.to}`;
  else text = value === undefined ? "" : String(value);
  if (operator === "in") return `${field.label} · ${text}`;
  return `${field.label} · ${label}${text ? " " + text : ""}`;
}
export function describeRecordFilter(rule: FilterRule,props:RecordFilterPanelProps) {
  const fields=availableFields(props);
  return rule.conditions.map(term=>describeTerm(term,fields,props.isAdmin)).join(rule.match==="all" ? " 且 " : " 或 ") || "全部可见记录";
}

function removeAt(rule: FilterRule, index: number): FilterRule {
  const conditions = rule.conditions.filter((_, i) => i !== index);
  return { ...rule, conditions, match: conditions.length ? rule.match : "all" };
}

export function RecordFilterChips(props: RecordFilterPanelProps) {
  const { rule, onApply, onEditIndex, isAdmin } = props;
  if (!rule.conditions.length) return null;
  const fields = availableFields(props);
  return (
    <div className={styles.chips} role="group" aria-label="当前筛选条件">
      {rule.conditions.length > 1 && (
        <span className={styles.match}>
          {rule.match === "all" ? "全部满足" : "任一满足"}
        </span>
      )}
      {rule.conditions.map((term, index) => {
        const summary = describeTerm(term, fields, isAdmin);
        const label =
          "fieldKey" in term
            ? (fields.find((f) => f.key === term.fieldKey)?.label ??
              "不可用条件")
            : "条件组";
        return (
          <span key={index} className={styles.chip}>
            <button
              type="button"
              onClick={() => onEditIndex(index)}
              aria-label={`编辑 ${summary}`}
              title={summary}
            >
              {summary}
            </button>
            <button
              type="button"
              onClick={() => onApply(removeAt(rule, index))}
              aria-label={`移除条件 ${label}`}
            >
              <CloseOutlined />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function RecordFilterPanel(props: RecordFilterPanelProps) {
  const { editIndex, onEditIndex, rule } = props;
  const count = leafCount(rule);
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={editIndex !== null}
      onOpenChange={(open) => onEditIndex(open ? -1 : null)}
      destroyOnHidden
      fresh
      arrow={false}
      content={<>{editIndex !== null && <FilterEditor {...props} />}</>}
    >
      <Button
        className={styles.trigger}
        aria-expanded={editIndex !== null}
        aria-haspopup="dialog"
        aria-label={count ? `筛选 ${count}` : "筛选"}
        icon={<FilterOutlined />}
      >
        筛选{count > 0 && <span className={styles.count}>{count}</span>}
      </Button>
    </Popover>
  );
}

function newCondition(
  field: Field,
  operator: FilterOperator = FILTER_FIELD_OPERATORS[field.type][0],
): FilterCondition {
  const condition = { fieldKey: field.key, operator };
  if (operator === "relative") return { ...condition, value: "today" };
  if (operator === "dueThroughToday")
    return { ...condition, value: { assignee: "$me" } };
  return condition;
}
function isReady(rule: FilterRule, fields: Field[]): boolean {
  function check(term: Term) {
    if ("conditions" in term) {
      term.conditions.forEach(check);
      return;
    }
    const field = fields.find((f) => f.key === term.fieldKey);
    if (!field) throw new Error();
    validateFilterCondition(term, field.type);
    if (
      Array.isArray(term.value) &&
      (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT") &&
      !term.value.every((v) => field.options.some((o) => o.value === v))
    )
      throw new Error();
  }
  try {
    parseFilterRule(rule);
    check(rule);
    return true;
  } catch {
    return false;
  }
}
function conditionKey(term: Term, fields: Field[]) {
  if ("conditions" in term) return JSON.stringify(term);
  const money =
    fields.find((field) => field.key === term.fieldKey)?.type === "MONEY";
  function scalar(value: unknown) {
    if (!money || typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))
      return value;
    const [units, fraction] = value.split(".");
    const whole = BigInt(units).toString();
    const cents = fraction?.replace(/0+$/, "");
    return cents
      ? (whole === "0" && value.startsWith("-") ? "-0" : whole) + "." + cents
      : whole;
  }
  const value = term.value;
  const normalized = Array.isArray(value)
    ? [...value].sort()
    : value && typeof value === "object" && "from" in value
      ? [scalar(value.from), scalar(value.to)]
      : scalar(value);
  return JSON.stringify([term.fieldKey, term.operator, normalized]);
}

function FilterEditor(props: RecordFilterPanelProps) {
  const { isAdmin, onEditIndex, onApply, editIndex } = props;
  const fields = availableFields(props);
  const [draft, setDraft] = useState(props.rule);
  usePublishEditorDraft(draft);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<PreviewChoice<FilterRule>[]>([]);
  const [before, setBefore] = useState<FilterRule>();
  const [edited, setEdited] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const ready = isReady(draft, fields);
  const nested = draft.conditions.some((term) => "conditions" in term);
  const remaining =
    before?.conditions.map((term) => ({
      term,
      key: conditionKey(term, fields),
    })) ?? [];
  const added = draft.conditions.map((term) => {
    if (!before) return false;
    const index = remaining.findIndex(
      (old) => old.key === conditionKey(term, fields),
    );
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  function cancelRequest() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setChoices([]);
    setError("");
  }
  function edit(next: FilterRule) {
    cancelRequest();
    setDraft(next);
    setEdited(true);
  }
  function showRule(next: FilterRule) {
    setBefore(draft);
    setDraft(next);
    setChoices([]);
    setEdited(false);
  }
  async function generate() {
    cancelRequest();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const result = await props.onPreview(
        { text: text.trim(), currentRule: draft },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.kind === "rule") showRule(result.rule);
      else if (result.kind === "clarify") setChoices(result.options);
      else setError("无法生成可用条件，请调整描述或手动筛选");
    } catch {
      if (!controller.signal.aborted)
        setError("无法生成可用条件，请调整描述或手动筛选");
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
        request.current = null;
      }
    }
  }
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editIndex === null) return;
    const target =
      editIndex < 0
        ? panel.current?.querySelector("select")
        : panel.current?.querySelector<HTMLElement>(
            `[data-term="${editIndex}"] [data-primary]`,
          );
    target?.focus();
  }, [editIndex]);
  function replace(index: number, term: FilterCondition) {
    edit({
      ...draft,
      conditions: draft.conditions.map((node, i) =>
        i === index ? term : node,
      ),
    });
  }
  return (
    <div
      className={styles.panel}
      ref={panel}
      role="dialog"
      aria-label="筛选条件"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.stopPropagation();
        if (
          event.target instanceof HTMLElement &&
          event.target.closest('[role="combobox"][aria-expanded="true"]')
        )
          return;
        onEditIndex(null);
      }}
    >
      <FeatureGate feature="filter"><div className={styles.prompt}>
        <label htmlFor="filter-preview-text">用一句话描述条件</label>
        <div className={styles.promptLine}>
          <input
            id="filter-preview-text"
            placeholder="例如：我负责的、预计金额超过 10 万的客户"
            maxLength={2000}
            value={text}
            disabled={nested}
            onChange={(event) => {
              cancelRequest();
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                !pending &&
                ready &&
                text.trim()
              )
                void generate();
            }}
          />
          <Button
            icon={<AiSparkIcon aria-hidden />}
            loading={pending}
            disabled={nested || !ready || !text.trim()}
            onClick={() => void generate()}
          >
            {pending ? "生成中" : "生成条件"}
          </Button>
        </div>
        {nested && (
          <span className={styles.hint}>当前面板无法完整表达这组条件</span>
        )}
        {error && (
          <span role="alert" className={styles.hint}>
            {error}
          </span>
        )}
        {choices.length > 0 && (
          <PreviewChoices
            prompt="请选择你想表达的条件"
            options={choices}
            onSelect={showRule}
          />
        )}
      </div>
      </FeatureGate>
      <div className={styles.header}>
        <strong>筛选条件</strong>
        <select
          aria-label="匹配方式"
          value={draft.match}
          onChange={(event) =>
            edit({ ...draft, match: event.target.value as "any" | "all" })
          }
        >
          <option value="all">满足所有条件</option>
          <option value="any">满足任一条件</option>
        </select>
      </div>
      <div className={styles.rows}>
        {draft.conditions.map((term, index) => {
          const field =
            "fieldKey" in term
              ? fields.find((f) => f.key === term.fieldKey)
              : undefined;
          const label = `条件 ${index + 1}`;
          return (
            <div className={styles.rowWrap} key={index}>
              {/* Added by AI: the same mark as everything else AI wrote. */}
              {added[index] && (
                <span className={styles.newTag}>
                  <AiBadge>AI 新增</AiBadge>
                </span>
              )}
              <div data-term={index} className={styles.row}>
                {"conditions" in term || !field ? (
                  <span data-primary tabIndex={-1} className={styles.group}>
                    {describeTerm(term, fields, isAdmin)}
                  </span>
                ) : (
                  <>
                    <select
                      data-primary
                      aria-label={label + " 字段"}
                      value={field.key}
                      onChange={(e) =>
                        replace(
                          index,
                          newCondition(
                            fields.find((f) => f.key === e.target.value)!,
                          ),
                        )
                      }
                    >
                      {fields.map((f) => (
                        <option value={f.key} key={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={label + " 比较方式"}
                      value={term.operator}
                      onChange={(e) =>
                        replace(
                          index,
                          newCondition(field, e.target.value as FilterOperator),
                        )
                      }
                    >
                      {FILTER_FIELD_OPERATORS[field.type].map((op) => (
                        <option value={op} key={op}>
                          {FILTER_OPERATORS[op].label}
                        </option>
                      ))}
                    </select>
                    <ValueControl
                      label={label}
                      field={field}
                      condition={term}
                      isAdmin={isAdmin}
                      onChange={(value) => replace(index, { ...term, value })}
                    />
                  </>
                )}
                <Button
                  type="text"
                  size="small"
                  className={styles.delete}
                  icon={<CloseOutlined />}
                  aria-label={`删除${label}`}
                  onClick={() => edit(removeAt(draft, index))}
                />
              </div>
            </div>
          );
        })}
        <Button
          type="text"
          className={styles.add}
          icon={<PlusOutlined />}
          disabled={leafCount(draft) >= 16}
          onClick={() =>
            edit({
              ...draft,
              conditions: [...draft.conditions, newCondition(fields[0]!)],
            })
          }
        >
          添加条件
        </Button>
      </div>
      {remaining.length > 0 && (
        <div className={styles.removed}>
          <strong>将移除</strong>
          {remaining.map(({ term }, index) => (
            <span key={index}>{describeTerm(term, fields, isAdmin)}</span>
          ))}
        </div>
      )}
      {before && (
        <div className={styles.previewStatus}>
          {/* Conditions AI wrote carry the AI mark until the user edits
              them; either way nothing is applied yet. */}
          <span role="status" className={styles.previewState}>
            {edited ? (
              <span>已编辑 · 尚未应用</span>
            ) : (
              <>
                <AiBadge>AI 生成</AiBadge>
                <span>尚未应用</span>
              </>
            )}
          </span>
          <Button
            type="text"
            size="small"
            icon={<UndoOutlined aria-hidden />}
            onClick={() => {
              cancelRequest();
              setDraft(before);
              setBefore(undefined);
              setEdited(false);
            }}
          >
            撤销生成
          </Button>
        </div>
      )}
      <div className={styles.footer}>
        <Button autoInsertSpace={false} onClick={() => onEditIndex(null)}>
          取消
        </Button>
        <Button
          autoInsertSpace={false}
          type="primary"
          disabled={!ready || pending || choices.length > 0}
          onClick={() => {
            onApply(draft);
            onEditIndex(null);
          }}
        >
          {remaining.length ? "应用并替换条件" : "应用"}
        </Button>
      </div>
    </div>
  );
}

function ValueControl({
  label,
  field,
  condition,
  onChange,
  isAdmin,
}: {
  label: string;
  field: Field;
  condition: FilterCondition;
  isAdmin: boolean;
  onChange: (value: FilterValue) => void;
}) {
  const { operator, value } = condition;
  const shape = FILTER_OPERATORS[operator].valueShape;
  const aria = label + " 值";
  if (shape === "none") return null;
  if (shape === "list")
    return (
      <Select
        mode="multiple"
        virtual={false}
        showSearch={{ optionFilterProp: "label" }}
        maxCount={20}
        aria-label={aria}
        className={styles.multi}
        placeholder="选择值"
        popupMatchSelectWidth={false}
        getPopupContainer={(node: HTMLElement) =>
          node.closest<HTMLElement>('[role="dialog"]') ?? node.parentElement!
        }
        maxTagCount={2}
        value={Array.isArray(value) ? value : []}
        options={field.options}
        onChange={onChange}
      />
    );
  if (shape === "assignee") {
    const assignee =
      value && typeof value === "object" && "assignee" in value
        ? value.assignee
        : "$me";
    return (
      <select
        aria-label={aria}
        value={assignee}
        onChange={(e) =>
          onChange({ assignee: e.target.value as "$me" | "any" })
        }
      >
        <option value="$me">我</option>
        {(isAdmin || assignee === "any") && (
          <option value="any" disabled={!isAdmin}>
            {isAdmin ? "任何人" : "我可见的待办"}
          </option>
        )}
      </select>
    );
  }
  if (shape === "relative")
    return (
      <select
        aria-label={aria}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        {RELATIVE_DATE_PRESETS.map((key) => (
          <option key={key} value={key}>
            {RELATIVE_DATE_PRESET_LABELS[key]}
          </option>
        ))}
      </select>
    );
  if (field.type === "BOOLEAN")
    return (
      <select
        aria-label={aria}
        value={typeof value === "boolean" ? String(value) : ""}
        onChange={(e) => onChange(e.target.value === "true")}
      >
        <option value="" disabled>
          选择值
        </option>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    );

  const type =
    field.type === "DATE" ||
    field.type === "DATETIME" ||
    (field.type === "DATE_TEXT" &&
      ["on", "before", "after", "between"].includes(operator))
      ? "date"
      : field.type === "NUMBER"
        ? "number"
        : "text";
  const read = (text: string) =>
    field.type === "NUMBER" && text !== "" ? Number(text) : text;
  const input = {
    type,
    step: type === "number" ? "any" : undefined,
    inputMode: field.type === "MONEY" ? ("decimal" as const) : undefined,
  };
  if (shape === "range") {
    const range =
      value && typeof value === "object" && "from" in value
        ? value
        : { from: "", to: "" };
    return (
      <span className={styles.range}>
        <input
          {...input}
          aria-label={label + " 起始值"}
          value={range.from}
          onChange={(e) => onChange({ ...range, from: read(e.target.value) })}
        />
        <span>至</span>
        <input
          {...input}
          aria-label={label + " 结束值"}
          value={range.to}
          onChange={(e) => onChange({ ...range, to: read(e.target.value) })}
        />
      </span>
    );
  }
  return (
    <input
      {...input}
      aria-label={aria}
      placeholder="输入值"
      value={
        typeof value === "string" || typeof value === "number" ? value : ""
      }
      onChange={(e) => onChange(read(e.target.value))}
    />
  );
}
