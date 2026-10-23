"use client";

import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Button,
  ConfigProvider,
  DatePicker,
  InputNumber,
  Input,
  Popover,
  Select,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import { OptionBadge } from "@/features/objects/option-badge";

import type { DynamicFieldMember } from "./dynamic-field";
import {
  booleanFilterValue,
  dateRangeFilterValue,
  isDateRangeFilter,
  isNumericRangeFilter,
  isPresenceFilter,
  isRelativeDateFilter,
  isTextContainsFilter,
  numericRangeFilterValue,
  optionFilterValues,
  presenceFilterValue,
  relativeDateFilterValue,
  RELATIVE_DATE_PRESET_LABELS,
  RELATIVE_DATE_PRESETS,
  textContainsFilterValue,
  type RecordFilterValue,
  type RecordFilters,
} from "./record-query-state";
import styles from "./record-list.module.css";
import { memberSelectOptions } from "@/components/identity/member-identity";

const TEXT_TYPES = new Set(["TEXT", "TEXTAREA", "PHONE", "EMAIL"]);
const TEXT_DEBOUNCE_MS = 400;

/** The field types a condition row can edit, in the order they are offered. */
export function filterableFields(
  fields: PublishedFieldView[],
  titleFieldKey: string,
): PublishedFieldView[] {
  return fields.filter((field) => {
    if (field.access === "HIDDEN") return false;
    if (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT") {
      return selectOptions(field).length > 0;
    }
    if (TEXT_TYPES.has(field.type)) return field.fieldKey !== titleFieldKey;
    return [
      "DATE",
      "DATETIME",
      "NUMBER",
      "MONEY",
      "BOOLEAN",
      "MEMBER",
    ].includes(field.type);
  });
}

function memberName(members: DynamicFieldMember[], id: string) {
  const member = members.find((candidate) => candidate.id === id);
  if (!member) return "其他成员";
  const name = member.displayName?.trim() || "未设置姓名";
  return member.status === "DISABLED" ? `${name}（已停用）` : name;
}

function shortList(labels: string[]) {
  return labels.length <= 2
    ? labels.join("、")
    : `${labels.slice(0, 2).join("、")} 等 ${labels.length} 项`;
}

/** "包含 制造" / "近 30 天" / "100–500": what a condition chip says after its field. */
export function describeFilter(
  field: PublishedFieldView,
  value: RecordFilterValue,
  members: DynamicFieldMember[],
): string {
  if (Array.isArray(value)) {
    if (field.type === "MEMBER")
      return shortList(value.map((id) => memberName(members, id)));
    const options = selectOptions(field);
    return shortList(
      value.map(
        (key) => options.find((option) => option.key === key)?.label ?? key,
      ),
    );
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (isPresenceFilter(value))
    return value.presence === "empty" ? "为空" : "有值";
  if (isTextContainsFilter(value)) return `包含 ${value.contains}`;
  if (isRelativeDateFilter(value))
    return RELATIVE_DATE_PRESET_LABELS[value.relative];
  if (isDateRangeFilter(value)) {
    if (value.from && value.to) return `${value.from} 至 ${value.to}`;
    return value.from ? `${value.from} 之后` : `${value.to} 之前`;
  }
  if (isNumericRangeFilter(value)) {
    if (value.min !== undefined && value.max !== undefined)
      return `${value.min}–${value.max}`;
    return value.min !== undefined ? `≥ ${value.min}` : `≤ ${value.max}`;
  }
  return "";
}

/** A quick filter for one option field: a borderless select named after the field. */
export function OptionQuickFilter({
  field,
  filters,
  onChange,
}: {
  field: PublishedFieldView;
  filters: RecordFilters;
  onChange: (fieldKey: string, value: RecordFilterValue | undefined) => void;
}) {
  return (
    <Select
      mode="multiple"
      aria-label={`按${field.label}筛选`}
      placeholder={field.label}
      variant="borderless"
      allowClear
      popupMatchSelectWidth={false}
      className={styles.quickFilter}
      value={optionFilterValues(filters, field.fieldKey)}
      onChange={(values: string[]) =>
        onChange(field.fieldKey, values.length === 0 ? undefined : values)
      }
      options={selectOptions(field).map((option) => ({
        value: option.key,
        label: <OptionBadge option={option} />,
      }))}
    />
  );
}

type TextOperator = "contains" | "not_empty" | "empty";
const CUSTOM_RANGE = "custom";

/** The operator and value controls for one field, writing the same filter shapes the URL carries. */
function ConditionValue({
  field,
  filters,
  members,
  onChange,
}: {
  field: PublishedFieldView;
  filters: RecordFilters;
  members: DynamicFieldMember[];
  onChange: (value: RecordFilterValue | undefined) => void;
}) {
  const key = field.fieldKey;
  const presence = presenceFilterValue(filters, key);
  const contains = textContainsFilterValue(filters, key);
  const [textOperator, setTextOperator] = useState<TextOperator>(
    presence ?? "contains",
  );
  const [text, setText] = useState(contains ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(debounce.current), []);
  const relative = relativeDateFilterValue(filters, key);
  const range = dateRangeFilterValue(filters, key);
  const [dateMode, setDateMode] = useState<string | undefined>(
    relative ?? (range ? CUSTOM_RANGE : undefined),
  );

  if (
    field.type === "SINGLE_SELECT" ||
    field.type === "MULTI_SELECT" ||
    field.type === "MEMBER"
  ) {
    const options: { value: string; label: ReactNode; searchText?: string }[] =
      field.type === "MEMBER"
        ? memberSelectOptions(members, { includeDisabled: true })
        : selectOptions(field).map((option) => ({
            value: option.key,
            label: <OptionBadge option={option} />,
            searchText: option.label,
          }));
    return (
      <>
        <span className={styles.conditionOperator}>是其中之一</span>
        <Select
          mode="multiple"
          allowClear
          showSearch={field.type === "MEMBER"}
          optionFilterProp="searchText"
          aria-label={`按${field.label}筛选`}
          placeholder="选择"
          className={styles.conditionInput}
          value={optionFilterValues(filters, key)}
          onChange={(values: string[]) =>
            onChange(values.length ? values : undefined)
          }
          options={options}
        />
      </>
    );
  }

  if (field.type === "BOOLEAN") {
    return (
      <>
        <span className={styles.conditionOperator}>等于</span>
        <Select
          allowClear
          aria-label={`按${field.label}筛选`}
          placeholder="选择"
          className={styles.conditionInput}
          value={booleanFilterValue(filters, key)}
          onChange={(next?: boolean) => onChange(next)}
          options={[
            { value: true, label: "是" },
            { value: false, label: "否" },
          ]}
        />
      </>
    );
  }

  if (field.type === "NUMBER" || field.type === "MONEY") {
    const current = numericRangeFilterValue(filters, key);
    const money = field.type === "MONEY";
    const write = (min?: number, max?: number) =>
      onChange(
        min === undefined && max === undefined ? undefined : { min, max },
      );
    return (
      <div
        role="group"
        aria-label={`按${field.label}筛选`}
        className={styles.conditionRange}
      >
        <InputNumber
          aria-label={`${field.label}最小值`}
          placeholder="最小"
          value={current?.min}
          min={field.validation.min}
          max={field.validation.max}
          precision={money ? (field.validation.scale ?? 2) : undefined}
          onChange={(next) =>
            write(typeof next === "number" ? next : undefined, current?.max)
          }
        />
        <span aria-hidden>至</span>
        <InputNumber
          aria-label={`${field.label}最大值`}
          placeholder="最大"
          value={current?.max}
          min={field.validation.min}
          max={field.validation.max}
          precision={money ? (field.validation.scale ?? 2) : undefined}
          onChange={(next) =>
            write(current?.min, typeof next === "number" ? next : undefined)
          }
        />
      </div>
    );
  }

  if (field.type === "DATE" || field.type === "DATETIME") {
    return (
      <div
        role="group"
        aria-label={`按${field.label}筛选`}
        className={styles.conditionRange}
      >
        <Select
          aria-label={`按${field.label}快捷筛选`}
          placeholder="选择时间"
          className={styles.conditionOperatorSelect}
          value={dateMode}
          onChange={(next: string) => {
            setDateMode(next);
            if (next !== CUSTOM_RANGE)
              onChange({
                relative: next as (typeof RELATIVE_DATE_PRESETS)[number],
              });
            else if (relative) onChange(undefined);
          }}
          options={[
            ...RELATIVE_DATE_PRESETS.map((preset) => ({
              value: preset,
              label: RELATIVE_DATE_PRESET_LABELS[preset],
            })),
            { value: CUSTOM_RANGE, label: "自定义范围" },
          ]}
        />
        {dateMode === CUSTOM_RANGE ? (
          <DatePicker.RangePicker
            allowEmpty={[true, true]}
            allowClear
            className={styles.conditionInput}
            separator="至"
            placeholder={["开始", "结束"]}
            value={[
              range?.from ? dayjs(range.from) : null,
              range?.to ? dayjs(range.to) : null,
            ]}
            onChange={(next: [Dayjs | null, Dayjs | null] | null) => {
              const from = next?.[0]?.isValid()
                ? next[0].format("YYYY-MM-DD")
                : undefined;
              const to = next?.[1]?.isValid()
                ? next[1].format("YYYY-MM-DD")
                : undefined;
              onChange(!from && !to ? undefined : { from, to });
            }}
          />
        ) : null}
      </div>
    );
  }

  // Text, phone and email: contains a phrase, or is empty / has a value.
  return (
    <>
      <Select
        aria-label={`按${field.label}填充筛选`}
        className={styles.conditionOperatorSelect}
        value={textOperator}
        onChange={(next: TextOperator) => {
          setTextOperator(next);
          clearTimeout(debounce.current);
          if (next === "contains")
            onChange(text.trim() ? { contains: text.trim() } : undefined);
          else onChange({ presence: next });
        }}
        options={[
          { value: "contains", label: "包含" },
          { value: "not_empty", label: "有值" },
          { value: "empty", label: "为空" },
        ]}
      />
      {textOperator === "contains" ? (
        <Input
          allowClear
          aria-label={`按${field.label}筛选`}
          placeholder="输入内容"
          className={styles.conditionInput}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            clearTimeout(debounce.current);
            debounce.current = setTimeout(
              () =>
                onChange(next.trim() ? { contains: next.trim() } : undefined),
              TEXT_DEBOUNCE_MS,
            );
          }}
          onPressEnter={() => {
            clearTimeout(debounce.current);
            onChange(text.trim() ? { contains: text.trim() } : undefined);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The "＋ 筛选" popover: one row per condition (field ▾ / operator ▾ / value / ×)
 * and "＋ 添加条件" at the bottom, as in Attio and 飞书. A row whose value is
 * still empty is kept locally until it has something to filter by.
 */
export function RecordFilterPopover({
  fields,
  filters,
  members,
  open,
  onOpenChange,
  onChange,
  children,
}: {
  fields: PublishedFieldView[];
  filters: RecordFilters;
  members: DynamicFieldMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (fieldKey: string, value: RecordFilterValue | undefined) => void;
  children: ReactNode;
}) {
  const [drafts, setDrafts] = useState<string[]>([]);
  const active = fields
    .filter((field) => filters[field.fieldKey] !== undefined)
    .map((field) => field.fieldKey);
  const rows = [...active, ...drafts.filter((key) => !active.includes(key))];
  const unused = fields.filter((field) => !rows.includes(field.fieldKey));

  function replace(previous: string, next: string) {
    if (filters[previous] !== undefined) onChange(previous, undefined);
    setDrafts((keys) => [
      ...keys.filter((key) => key !== previous && key !== next),
      next,
    ]);
  }

  function remove(fieldKey: string) {
    setDrafts((keys) => keys.filter((key) => key !== fieldKey));
    if (filters[fieldKey] !== undefined) onChange(fieldKey, undefined);
  }

  const content = (
    // Selects and date pickers open their menus inside the panel, so choosing a
    // field or a value is a click inside the popover rather than outside it.
    <ConfigProvider
      getPopupContainer={(trigger) =>
        trigger?.closest<HTMLElement>(`.${styles.filterPanel}`) ?? document.body
      }
    >
      <div className={styles.filterPanel} role="group" aria-label="筛选条件">
        {rows.length === 0 ? (
          <p className={styles.filterEmpty}>
            还没有条件。选择一个字段开始筛选。
          </p>
        ) : (
          <ul className={styles.conditionList}>
            {rows.map((fieldKey) => {
              const field = fields.find(
                (candidate) => candidate.fieldKey === fieldKey,
              );
              if (!field) return null;
              return (
                <li key={fieldKey} className={styles.conditionItem}>
                  <Select
                    aria-label={`条件字段 ${field.label}`}
                    className={styles.conditionField}
                    value={fieldKey}
                    popupMatchSelectWidth={false}
                    showSearch
                    optionFilterProp="label"
                    onChange={(next: string) => replace(fieldKey, next)}
                    options={[field, ...unused].map((candidate) => ({
                      value: candidate.fieldKey,
                      label: candidate.label,
                    }))}
                  />
                  <ConditionValue
                    key={fieldKey}
                    field={field}
                    filters={filters}
                    members={members}
                    onChange={(value) => onChange(fieldKey, value)}
                  />
                  <Button
                    type="text"
                    size="small"
                    className={styles.conditionRemove}
                    aria-label={`删除条件 ${field.label}`}
                    icon={<CloseOutlined aria-hidden />}
                    onClick={() => remove(fieldKey)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {unused.length ? (
          <Select
            aria-label="添加条件"
            className={styles.addCondition}
            variant="borderless"
            value={null}
            placeholder={
              <span>
                <PlusOutlined aria-hidden /> 添加条件
              </span>
            }
            showSearch
            optionFilterProp="label"
            popupMatchSelectWidth={240}
            suffixIcon={null}
            onChange={(next: string) =>
              setDrafts((keys) => [...keys.filter((key) => key !== next), next])
            }
            options={unused.map((field) => ({
              value: field.fieldKey,
              label: field.label,
            }))}
          />
        ) : null}
      </div>
    </ConfigProvider>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setDrafts([]);
      }}
      content={content}
    >
      {children}
    </Popover>
  );
}
