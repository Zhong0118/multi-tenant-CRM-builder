"use client";

import {
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";

import {
  selectOptions,
  type PublishedFieldView,
  type SelectOptionView,
} from "@/features/objects/object-types";

import styles from "./records.module.css";

export interface DynamicFieldMember {
  id: string;
  displayName: string | null;
}

export interface DynamicFieldProps {
  field: PublishedFieldView;
  value: unknown;
  onChange: (value: unknown) => void;
  members?: DynamicFieldMember[];
  error?: string;
  disabled?: boolean;
}

/**
 * Renders one published field. The published schema decides the control, and
 * every emitted value already matches what the record value engine accepts:
 * numbers for NUMBER, fixed-scale strings for MONEY, calendar days for DATE,
 * UTC instants for DATETIME and option keys for selects.
 *
 * Access is enforced server-side; this component reflects it so the page never
 * offers an edit the API would reject. HIDDEN renders nothing at all — not a
 * disabled control — so hidden data never reaches the DOM.
 */
export function DynamicField({
  field,
  value,
  onChange,
  members = [],
  error,
  disabled = false,
}: DynamicFieldProps) {
  if (field.access === "HIDDEN") return null;

  const controlId = `dynamic-field-${field.fieldKey}`;
  const errorId = `${controlId}-error`;
  const helpId = `${controlId}-help`;
  const help = field.config.help;
  const describedBy =
    [error ? errorId : undefined, help ? helpId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <Form.Item
      label={field.label}
      htmlFor={controlId}
      required={field.access === "EDIT" && field.required}
      validateStatus={error ? "error" : undefined}
    >
      {field.access === "READ_ONLY" ? (
        <ReadOnlyValue field={field} value={value} members={members} />
      ) : (
        <EditableControl
          field={field}
          value={value}
          onChange={onChange}
          members={members}
          controlId={controlId}
          describedBy={describedBy}
          invalid={Boolean(error)}
          disabled={disabled}
        />
      )}
      {error ? (
        <div id={errorId} className={styles.fieldError} role="alert">
          {error}
        </div>
      ) : null}
      {help ? (
        <div id={helpId} className={styles.fieldHelp}>
          {help}
        </div>
      ) : null}
    </Form.Item>
  );
}

function EditableControl({
  field,
  value,
  onChange,
  members,
  controlId,
  describedBy,
  invalid,
  disabled,
}: {
  field: PublishedFieldView;
  value: unknown;
  onChange: (value: unknown) => void;
  members: DynamicFieldMember[];
  controlId: string;
  describedBy?: string;
  invalid: boolean;
  disabled: boolean;
}) {
  const shared = {
    id: controlId,
    disabled,
    "aria-required": field.required || undefined,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
  } as const;

  switch (field.type) {
    case "TEXTAREA":
      return (
        <Input.TextArea
          {...shared}
          rows={4}
          value={asText(value)}
          placeholder={field.config.placeholder}
          maxLength={field.validation.maxLength}
          onChange={(event) => onChange(emptyToNull(event.target.value))}
        />
      );
    case "TEXT":
    case "PHONE":
    case "EMAIL":
      return (
        <Input
          {...shared}
          inputMode={INPUT_MODES[field.type]}
          autoComplete={field.type === "EMAIL" ? "email" : undefined}
          value={asText(value)}
          placeholder={field.config.placeholder}
          maxLength={field.validation.maxLength}
          onChange={(event) => onChange(emptyToNull(event.target.value))}
        />
      );
    case "NUMBER":
      return (
        <InputNumber
          {...shared}
          className={styles.fullWidth}
          value={typeof value === "number" ? value : null}
          min={field.validation.min}
          max={field.validation.max}
          precision={field.validation.scale}
          onChange={(next) => onChange(next ?? null)}
        />
      );
    case "MONEY":
      return (
        <MoneyControl
          shared={shared}
          field={field}
          value={value}
          onChange={onChange}
        />
      );
    case "DATE":
      return (
        <DatePicker
          {...shared}
          className={styles.fullWidth}
          format="YYYY-MM-DD"
          value={toDayjs(value)}
          onChange={(next: Dayjs | null) =>
            onChange(next ? next.format("YYYY-MM-DD") : null)
          }
        />
      );
    case "DATETIME":
      return (
        <DatePicker
          {...shared}
          className={styles.fullWidth}
          showTime
          format="YYYY-MM-DD HH:mm:ss"
          value={toDayjs(value)}
          onChange={(next: Dayjs | null) =>
            onChange(next ? next.toDate().toISOString() : null)
          }
        />
      );
    case "SINGLE_SELECT":
      return (
        <Select
          {...shared}
          className={styles.fullWidth}
          allowClear={!field.required}
          value={typeof value === "string" ? value : undefined}
          options={offeredOptions(selectOptions(field), toKeys(value))}
          onChange={(next?: string) => onChange(next ?? null)}
        />
      );
    case "MULTI_SELECT":
      return (
        <Select
          {...shared}
          className={styles.fullWidth}
          mode="multiple"
          value={toKeys(value)}
          options={offeredOptions(selectOptions(field), toKeys(value))}
          onChange={(next: string[]) => onChange(orderByConfig(field, next))}
        />
      );
    case "MEMBER":
      return (
        <Select
          {...shared}
          className={styles.fullWidth}
          allowClear={!field.required}
          showSearch
          optionFilterProp="label"
          value={typeof value === "string" ? value : undefined}
          options={members.map((member) => ({
            value: member.id,
            label: member.displayName ?? "未设置姓名",
          }))}
          onChange={(next?: string) => onChange(next ?? null)}
        />
      );
    case "BOOLEAN":
      return (
        <Switch
          id={controlId}
          disabled={disabled}
          aria-label={field.label}
          aria-describedby={describedBy}
          checked={value === true}
          onChange={(next) => onChange(next)}
        />
      );
  }
}

/**
 * MONEY stays a string end to end so a decimal never passes through a binary
 * float. The typed text is kept verbatim while editing and normalized to the
 * published scale on blur, which is what the API stores and compares.
 */
function MoneyControl({
  shared,
  field,
  value,
  onChange,
}: {
  shared: Record<string, unknown>;
  field: PublishedFieldView;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const scale = field.validation.scale ?? 2;
  const text = draft ?? asText(value);

  return (
    <Input
      {...shared}
      inputMode="decimal"
      value={text}
      placeholder={field.config.placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(emptyToNull(event.target.value));
      }}
      onBlur={() => {
        setDraft(undefined);
        onChange(normalizeMoney(text, scale));
      }}
    />
  );
}

function ReadOnlyValue({
  field,
  value,
  members,
}: {
  field: PublishedFieldView;
  value: unknown;
  members: DynamicFieldMember[];
}) {
  return (
    <div className={styles.readOnlyValue}>
      <span>{displayValue(field, value, members)}</span>
      <Typography.Text type="secondary" className={styles.readOnlyReason}>
        仅管理员可编辑
      </Typography.Text>
    </div>
  );
}

const INPUT_MODES = {
  TEXT: undefined,
  PHONE: "tel",
  EMAIL: "email",
} as const;

/**
 * Inactive options cannot be chosen for a new value, but a record that already
 * holds one keeps showing its label so history stays readable.
 */
function offeredOptions(options: SelectOptionView[], selected: string[]) {
  return options
    .filter(
      (option) => option.status === "ACTIVE" || selected.includes(option.key),
    )
    .map((option) => ({
      value: option.key,
      label:
        option.status === "INACTIVE"
          ? `${option.label}（已停用）`
          : option.label,
      disabled: option.status === "INACTIVE" && !selected.includes(option.key),
    }));
}

function orderByConfig(field: PublishedFieldView, keys: string[]): string[] {
  const chosen = new Set(keys);
  return selectOptions(field)
    .filter((option) => chosen.has(option.key))
    .map((option) => option.key);
}

function displayValue(
  field: PublishedFieldView,
  value: unknown,
  members: DynamicFieldMember[],
): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "BOOLEAN":
      return value === true ? "是" : "否";
    case "SINGLE_SELECT":
      return optionLabel(field, String(value));
    case "MULTI_SELECT":
      return toKeys(value)
        .map((key) => optionLabel(field, key))
        .join("、");
    case "MEMBER":
      return (
        members.find((member) => member.id === value)?.displayName ??
        String(value)
      );
    case "DATETIME":
      return dayjs(String(value)).format("YYYY-MM-DD HH:mm");
    default:
      return String(value);
  }
}

function optionLabel(field: PublishedFieldView, key: string): string {
  const option = selectOptions(field).find(
    (candidate) => candidate.key === key,
  );
  if (!option) return key;
  return option.status === "INACTIVE"
    ? `${option.label}（已停用）`
    : option.label;
}

function normalizeMoney(text: string, scale: number): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integerPart, fraction = ""] = unsigned.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  const sign = negative && Number(trimmed) !== 0 ? "-" : "";
  return scale === 0
    ? `${sign}${normalizedInteger}`
    : `${sign}${normalizedInteger}.${fraction.slice(0, scale).padEnd(scale, "0")}`;
}

function toDayjs(value: unknown): Dayjs | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function toKeys(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}
