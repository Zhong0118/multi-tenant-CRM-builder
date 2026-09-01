"use client";

import { useEffect, useRef } from "react";

import type {
  DashboardCandidate,
  DashboardCandidateField,
  DashboardFilter,
  DashboardWidgetDraft,
} from "./dashboard-types";
import styles from "./dashboard-configuration.module.css";

export function DashboardWidgetInspector({
  widget,
  candidates,
  focusPath,
  onChange,
}: {
  widget?: DashboardWidgetDraft;
  candidates: DashboardCandidate[];
  focusPath?: string;
  onChange: (widget: DashboardWidgetDraft) => void;
}) {
  const objectRef = useRef<HTMLSelectElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focusPath) return;
    if (focusPath.endsWith("objectCode")) {
      objectRef.current?.focus();
      return;
    }
    const label = focusLabel(focusPath);
    inspectorRef.current
      ?.querySelector<HTMLElement>(`[aria-label="${label}"]`)
      ?.focus();
  }, [focusPath, widget?.id]);

  if (!widget) {
    return (
      <aside className={styles.inspector} aria-label="组件属性">
        <RailHeading />
        <p className={styles.inspectorEmpty}>
          组件的对象、字段、聚合和受众会在这里编辑。
        </p>
      </aside>
    );
  }

  const candidate = candidates.find(
    (item) => item.object.code === widget.objectCode,
  );
  const fields = candidate?.fields ?? [];
  const patch = (next: Partial<DashboardWidgetDraft>) =>
    onChange({ ...widget, ...next } as DashboardWidgetDraft);
  const selectObject = (objectCode: string) =>
    patch(resetForObject(widget, objectCode));

  return (
    <aside
      ref={inspectorRef}
      className={styles.inspector}
      aria-label="组件属性"
    >
      <RailHeading type={widget.type} />
      <label>
        当前组件
        <input aria-label="当前组件" readOnly value={widget.title} />
      </label>
      <label>
        标题
        <input
          aria-label="组件标题"
          value={widget.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>
      <label>
        业务表
        <select
          ref={objectRef}
          aria-label="业务表"
          value={widget.objectCode}
          onChange={(event) => selectObject(event.target.value)}
        >
          <option value="">选择业务表</option>
          {candidates.map((item) => (
            <option key={item.object.code} value={item.object.code}>
              {item.object.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        受众
        <select
          aria-label="组件受众"
          value={widget.audience}
          onChange={(event) =>
            patch({
              audience: event.target.value as DashboardWidgetDraft["audience"],
            })
          }
        >
          <option value="ALL">所有成员</option>
          <option value="TENANT_ADMIN">仅管理员</option>
          <option value="EMPLOYEE">仅员工</option>
        </select>
      </label>
      <label>
        说明
        <textarea
          aria-label="组件说明"
          value={widget.description ?? ""}
          onChange={(event) =>
            patch({ description: event.target.value || undefined })
          }
        />
      </label>
      <WidgetControls widget={widget} fields={fields} onChange={onChange} />
      <FilterControls widget={widget} fields={fields} onChange={onChange} />
    </aside>
  );
}

function RailHeading({ type }: { type?: string }) {
  return (
    <div className={styles.railHeading}>
      <span>属性</span>
      <small>{type ?? "选择画布中的组件"}</small>
    </div>
  );
}

function WidgetControls({
  widget,
  fields,
  onChange,
}: {
  widget: DashboardWidgetDraft;
  fields: DashboardCandidateField[];
  onChange: (widget: DashboardWidgetDraft) => void;
}) {
  const set = (patch: object) =>
    onChange({ ...widget, ...patch } as DashboardWidgetDraft);
  const numeric = fields.filter(
    (field) => field.type === "NUMBER" || field.type === "MONEY",
  );
  const select = fields.filter((field) => field.type === "SINGLE_SELECT");
  const dates = fields.filter(
    (field) => field.type === "DATE" || field.type === "DATETIME",
  );
  const members = fields.filter((field) => field.type === "MEMBER");
  const currentValueField =
    "valueFieldKey" in widget ? widget.valueFieldKey : undefined;
  const fieldOptions = (items: DashboardCandidateField[]) => (
    <>
      <option value="">选择字段</option>
      {items.map((field) => (
        <option key={field.fieldKey} value={field.fieldKey}>
          {field.label}
        </option>
      ))}
    </>
  );
  const aggregation = (value: string, allowed: string[]) => (
    <label>
      聚合
      <select
        aria-label="聚合方式"
        value={value}
        onChange={(event) =>
          set({
            aggregation: event.target.value,
            valueFieldKey:
              event.target.value === "COUNT" ? undefined : currentValueField,
          })
        }
      >
        {allowed.map((item) => (
          <option key={item} value={item}>
            {item === "COUNT" ? "记录数" : item === "SUM" ? "求和" : "平均值"}
          </option>
        ))}
      </select>
    </label>
  );
  const valueField = (show: boolean) =>
    show ? (
      <label>
        数值字段
        <select
          aria-label="数值字段"
          value={currentValueField ?? ""}
          onChange={(event) =>
            set({ valueFieldKey: event.target.value || undefined })
          }
        >
          {fieldOptions(numeric)}
        </select>
      </label>
    ) : null;
  switch (widget.type) {
    case "METRIC":
      return (
        <>
          {aggregation(widget.aggregation, ["COUNT", "SUM", "AVG"])}
          {valueField(widget.aggregation !== "COUNT")}
          <label>
            显示格式
            <select
              aria-label="显示格式"
              value={widget.displayFormat ?? "NUMBER"}
              onChange={(event) => set({ displayFormat: event.target.value })}
            >
              <option value="NUMBER">数字</option>
              <option value="MONEY">金额</option>
              <option value="PERCENT">百分比</option>
            </select>
          </label>
        </>
      );
    case "STATUS_DISTRIBUTION": {
      const selected = select.find(
        (field) => field.fieldKey === widget.groupByFieldKey,
      );
      return (
        <>
          <label>
            分组字段
            <select
              aria-label="分组字段"
              value={widget.groupByFieldKey}
              onChange={(event) =>
                set({ groupByFieldKey: event.target.value, optionKeys: [] })
              }
            >
              {fieldOptions(select)}
            </select>
          </label>
          <label>
            分组选项
            <select
              multiple
              aria-label="分组选项"
              value={widget.optionKeys}
              onChange={(event) =>
                set({
                  optionKeys: Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                })
              }
            >
              {selected?.config.options
                ?.filter((item) => item.status === "ACTIVE")
                .map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            展示形式
            <select
              aria-label="展示形式"
              value={widget.display}
              onChange={(event) => set({ display: event.target.value })}
            >
              <option value="FUNNEL">漏斗</option>
              <option value="BAR">条形图</option>
              <option value="DONUT">环图</option>
            </select>
          </label>
          {aggregation(widget.aggregation, ["COUNT", "SUM"])}
          {valueField(widget.aggregation === "SUM")}
        </>
      );
    }
    case "TREND":
      return (
        <>
          <label>
            日期字段
            <select
              aria-label="日期字段"
              value={widget.dateFieldKey}
              onChange={(event) => set({ dateFieldKey: event.target.value })}
            >
              {fieldOptions(dates)}
            </select>
          </label>
          <label>
            时间粒度
            <select
              aria-label="时间粒度"
              value={widget.granularity}
              onChange={(event) => set({ granularity: event.target.value })}
            >
              <option value="AUTO">自动</option>
              <option value="DAY">天</option>
              <option value="WEEK">周</option>
              <option value="MONTH">月</option>
            </select>
          </label>
          {aggregation(widget.aggregation, ["COUNT", "SUM"])}
          {valueField(widget.aggregation === "SUM")}
        </>
      );
    case "LEADERBOARD":
      return (
        <>
          <label>
            成员来源
            <select
              aria-label="成员来源"
              value={widget.memberSource}
              onChange={(event) =>
                set({
                  memberSource: event.target.value,
                  memberFieldKey: undefined,
                })
              }
            >
              <option value="RECORD_OWNER">记录负责人</option>
              <option value="FIELD">成员字段</option>
            </select>
          </label>
          {widget.memberSource === "FIELD" ? (
            <label>
              成员字段
              <select
                aria-label="成员字段"
                value={widget.memberFieldKey ?? ""}
                onChange={(event) =>
                  set({ memberFieldKey: event.target.value || undefined })
                }
              >
                {fieldOptions(members)}
              </select>
            </label>
          ) : null}
          {aggregation(widget.aggregation, ["COUNT", "SUM"])}
          {valueField(widget.aggregation === "SUM")}
          <BoundedInput
            label="显示人数"
            value={widget.limit}
            max={50}
            onChange={(limit) => set({ limit })}
          />
        </>
      );
    case "RECORD_LIST":
      return (
        <>
          <label>
            显示字段
            <select
              multiple
              aria-label="显示字段"
              value={widget.fieldKeys}
              onChange={(event) =>
                set({
                  fieldKeys: Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ).slice(0, 8),
                })
              }
            >
              {fields.map((field) => (
                <option key={field.fieldKey} value={field.fieldKey}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序字段
            <select
              aria-label="排序字段"
              value={widget.sort.field}
              onChange={(event) =>
                set({ sort: { ...widget.sort, field: event.target.value } })
              }
            >
              <option value="updatedAt">更新时间</option>
              <option value="createdAt">创建时间</option>
              <option value="recordNo">记录编号</option>
              {fields.map((field) => (
                <option key={field.fieldKey} value={field.fieldKey}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序方向
            <select
              aria-label="排序方向"
              value={widget.sort.direction}
              onChange={(event) =>
                set({ sort: { ...widget.sort, direction: event.target.value } })
              }
            >
              <option value="DESC">降序</option>
              <option value="ASC">升序</option>
            </select>
          </label>
          <BoundedInput
            label="显示记录数"
            value={widget.limit}
            max={20}
            onChange={(limit) => set({ limit })}
          />
        </>
      );
  }
}

function BoundedInput({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min="1"
        max={max}
        value={value}
        onChange={(event) =>
          onChange(Math.min(max, Math.max(1, Number(event.target.value) || 1)))
        }
      />
    </label>
  );
}

function FilterControls({
  widget,
  fields,
  onChange,
}: {
  widget: DashboardWidgetDraft;
  fields: DashboardCandidateField[];
  onChange: (widget: DashboardWidgetDraft) => void;
}) {
  const filters = widget.filters;
  const change = (next: DashboardFilter[]) =>
    onChange({ ...widget, filters: next });
  return (
    <section className={styles.filters}>
      <div>
        <strong>筛选条件</strong>
        <button
          type="button"
          onClick={() =>
            change([...filters, { fieldKey: "", operator: "EQ", value: "" }])
          }
        >
          添加筛选条件
        </button>
      </div>
      {filters.map((filter, index) => (
        <div key={`${filter.fieldKey}-${index}`} className={styles.filterRow}>
          <select
            aria-label={`筛选字段 ${index + 1}`}
            value={filter.fieldKey}
            onChange={(event) =>
              replaceFilter(
                filters,
                index,
                {
                  fieldKey: event.target.value,
                  operator: defaultOperator(
                    fields.find(
                      (field) => field.fieldKey === event.target.value,
                    )?.type,
                  ),
                  value: "",
                },
                change,
              )
            }
          >
            <option value="">选择字段</option>
            {fields.map((field) => (
              <option key={field.fieldKey} value={field.fieldKey}>
                {field.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`筛选操作符 ${index + 1}`}
            value={filter.operator}
            onChange={(event) =>
              replaceFilter(
                filters,
                index,
                {
                  ...filter,
                  operator: event.target.value as DashboardFilter["operator"],
                  value: "",
                },
                change,
              )
            }
          >
            {operators(
              fields.find((field) => field.fieldKey === filter.fieldKey)?.type,
            ).map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </select>
          {needsValue(filter.operator) ? (
            <input
              aria-label={`筛选值 ${index + 1}`}
              value={
                Array.isArray(filter.value)
                  ? filter.value.join(",")
                  : String(filter.value ?? "")
              }
              onChange={(event) =>
                replaceFilter(
                  filters,
                  index,
                  { ...filter, value: event.target.value },
                  change,
                )
              }
            />
          ) : null}
          <button
            type="button"
            aria-label={`删除筛选条件 ${index + 1}`}
            onClick={() => change(filters.filter((_, item) => item !== index))}
          >
            删除
          </button>
        </div>
      ))}
    </section>
  );
}
function replaceFilter(
  filters: DashboardFilter[],
  index: number,
  filter: DashboardFilter,
  change: (filters: DashboardFilter[]) => void,
) {
  change(
    filters.map((item, itemIndex) => (itemIndex === index ? filter : item)),
  );
}
function operators(type?: string): DashboardFilter["operator"][] {
  if (type === "SINGLE_SELECT" || type === "MULTI_SELECT")
    return ["IN", "NOT_IN"];
  if (type === "NUMBER" || type === "MONEY")
    return ["EQ", "GT", "GTE", "LT", "LTE", "BETWEEN"];
  if (type === "DATE" || type === "DATETIME")
    return [
      "TODAY",
      "THIS_WEEK",
      "THIS_MONTH",
      "PAST_N_DAYS",
      "NEXT_N_DAYS",
      "BETWEEN",
    ];
  if (type === "MEMBER") return ["IN", "CURRENT_USER", "RECORD_OWNER"];
  if (type === "BOOLEAN") return ["EQ"];
  return ["EQ", "CONTAINS", "NOT_EMPTY"];
}
function defaultOperator(type?: string) {
  return operators(type)[0];
}
function needsValue(operator: DashboardFilter["operator"]) {
  return ![
    "TODAY",
    "THIS_WEEK",
    "THIS_MONTH",
    "CURRENT_USER",
    "RECORD_OWNER",
    "NOT_EMPTY",
  ].includes(operator);
}
function resetForObject(
  widget: DashboardWidgetDraft,
  objectCode: string,
): Partial<DashboardWidgetDraft> {
  return {
    objectCode,
    filters: [],
    ...(widget.type === "STATUS_DISTRIBUTION"
      ? { groupByFieldKey: "", optionKeys: [], valueFieldKey: undefined }
      : {}),
    ...(widget.type === "TREND"
      ? { dateFieldKey: "", valueFieldKey: undefined }
      : {}),
    ...(widget.type === "LEADERBOARD"
      ? { memberFieldKey: undefined, valueFieldKey: undefined }
      : {}),
    ...(widget.type === "RECORD_LIST"
      ? { fieldKeys: [], sort: { field: "updatedAt", direction: "DESC" } }
      : {}),
  } as Partial<DashboardWidgetDraft>;
}
function focusLabel(path: string) {
  if (path.includes(".filters[")) {
    if (path.endsWith(".operator")) return "筛选操作符 1";
    if (path.endsWith(".value")) return "筛选值 1";
    return "筛选字段 1";
  }
  const key = path.split(".").at(-1);
  return (
    {
      aggregation: "聚合方式",
      valueFieldKey: "数值字段",
      displayFormat: "显示格式",
      groupByFieldKey: "分组字段",
      optionKeys: "分组选项",
      display: "展示形式",
      dateFieldKey: "日期字段",
      granularity: "时间粒度",
      memberSource: "成员来源",
      memberFieldKey: "成员字段",
      fieldKeys: "显示字段",
      limit: "显示记录数",
      sort: "排序字段",
    }[key ?? ""] ?? "组件标题"
  );
}
