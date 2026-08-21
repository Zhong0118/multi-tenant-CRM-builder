"use client";

import {
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";

import {
  FIELD_ACCESS_LABELS,
  FIELD_TYPE_LABELS,
  PUBLISHED_FIELD_TYPES,
  selectOptions,
  type ObjectDraftField,
  type PublishedFieldAccess,
  type PublishedFieldType,
  type SelectOptionView,
} from "./object-types";

import styles from "./objects.module.css";

export interface FieldDraftValues {
  label: string;
  type: PublishedFieldType;
  required: boolean;
  employeeAccess: PublishedFieldAccess;
  options: SelectOptionView[];
  help: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  scale?: number;
}

export interface FieldEditorDrawerProps {
  field: ObjectDraftField | null;
  saving?: boolean;
  error?: string;
  onSubmit: (values: FieldDraftValues) => void;
  onClose: () => void;
}

const SELECT_TYPES: PublishedFieldType[] = ["SINGLE_SELECT", "MULTI_SELECT"];
const TEXT_TYPES: PublishedFieldType[] = ["TEXT", "TEXTAREA", "PHONE", "EMAIL"];
const NUMERIC_TYPES: PublishedFieldType[] = ["NUMBER", "MONEY"];

/**
 * Field configuration in four sections that mirror how a field is actually
 * decided: how it displays, what it stores, how it is validated, and what an
 * employee may do with it. A published field key and type are stable
 * identifiers, so they are shown but not editable.
 *
 * Selecting a different field remounts the editor, so the form always starts
 * from that field's saved configuration.
 */
export function FieldEditorDrawer(props: FieldEditorDrawerProps) {
  if (!props.field) return null;
  return <FieldEditor key={props.field.id} {...props} field={props.field} />;
}

function FieldEditor({
  field,
  saving = false,
  error,
  onSubmit,
  onClose,
}: FieldEditorDrawerProps & { field: ObjectDraftField }) {
  const [values, setValues] = useState<FieldDraftValues>(() =>
    initialValues(field),
  );

  const typeLocked = field.publishedType !== null;
  const patch = (next: Partial<FieldDraftValues>) =>
    setValues({ ...values, ...next });

  return (
    <Drawer
      open
      size={480}
      title={`配置字段 ${field.label}`}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={saving}
            onClick={() => onSubmit(values)}
          >
            保存字段
          </Button>
        </Space>
      }
    >
      {error ? (
        <Typography.Paragraph type="danger">{error}</Typography.Paragraph>
      ) : null}

      <Form component={false} layout="vertical">
        <section className={styles.drawerSection}>
          <span className={styles.drawerSectionLabel}>显示</span>
          <Form.Item label="字段名称" htmlFor="field-label">
            <Input
              id="field-label"
              value={values.label}
              onChange={(event) => patch({ label: event.target.value })}
            />
          </Form.Item>
          <Form.Item
            label="字段键"
            htmlFor="field-key"
            extra="字段键在对象内唯一，发布后不再变更。"
          >
            <Input id="field-key" value={field.fieldKey} disabled />
          </Form.Item>
          <Form.Item
            label="辅助说明"
            htmlFor="field-help"
            extra="只解释输入规则，不要重复字段名称。"
          >
            <Input
              id="field-help"
              value={values.help}
              onChange={(event) => patch({ help: event.target.value })}
            />
          </Form.Item>
        </section>

        <section className={styles.drawerSection}>
          <span className={styles.drawerSectionLabel}>数据类型</span>
          <Form.Item label="数据类型" htmlFor="field-type">
            <Select
              id="field-type"
              value={values.type}
              disabled={typeLocked}
              onChange={(type: PublishedFieldType) => patch({ type })}
              options={PUBLISHED_FIELD_TYPES.map((type) => ({
                value: type,
                label: FIELD_TYPE_LABELS[type],
              }))}
            />
          </Form.Item>
          {typeLocked ? (
            <p className={styles.lockNote}>字段发布后不能更改数据类型。</p>
          ) : null}
          <Form.Item label="必填" htmlFor="field-required">
            <Switch
              id="field-required"
              aria-label="必填"
              checked={values.required}
              onChange={(required) => patch({ required })}
            />
          </Form.Item>
        </section>

        <section className={styles.drawerSection}>
          <span className={styles.drawerSectionLabel}>
            {SELECT_TYPES.includes(values.type) ? "选项" : "校验"}
          </span>
          {TEXT_TYPES.includes(values.type) ? (
            <div className={styles.formGrid}>
              <NumberField
                id="field-min-length"
                label="最少字符"
                value={values.minLength}
                onChange={(minLength) => patch({ minLength })}
              />
              <NumberField
                id="field-max-length"
                label="最多字符"
                value={values.maxLength}
                onChange={(maxLength) => patch({ maxLength })}
              />
            </div>
          ) : null}
          {NUMERIC_TYPES.includes(values.type) ? (
            <div className={styles.formGrid}>
              <NumberField
                id="field-min"
                label="最小值"
                value={values.min}
                onChange={(min) => patch({ min })}
              />
              <NumberField
                id="field-max"
                label="最大值"
                value={values.max}
                onChange={(max) => patch({ max })}
              />
              <NumberField
                id="field-scale"
                label="小数位"
                value={values.scale}
                onChange={(scale) => patch({ scale })}
              />
            </div>
          ) : null}
          {SELECT_TYPES.includes(values.type) ? (
            <OptionEditor
              options={values.options}
              onChange={(options) => patch({ options })}
            />
          ) : null}
          {!TEXT_TYPES.includes(values.type) &&
          !NUMERIC_TYPES.includes(values.type) &&
          !SELECT_TYPES.includes(values.type) ? (
            <Typography.Paragraph type="secondary">
              该类型由服务端按固定规则校验，无需额外配置。
            </Typography.Paragraph>
          ) : null}
        </section>

        <section className={styles.drawerSection}>
          <span className={styles.drawerSectionLabel}>员工访问</span>
          <Form.Item
            label="员工访问级别"
            htmlFor="field-access"
            extra="字段权限来自发布版本，成员覆盖不会改变它。"
          >
            <Select
              id="field-access"
              value={values.employeeAccess}
              onChange={(employeeAccess: PublishedFieldAccess) =>
                patch({ employeeAccess })
              }
              options={(
                ["EDIT", "READ_ONLY", "HIDDEN"] as PublishedFieldAccess[]
              ).map((access) => ({
                value: access,
                label: FIELD_ACCESS_LABELS[access],
              }))}
            />
          </Form.Item>
        </section>
      </Form>
    </Drawer>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <Form.Item label={label} htmlFor={id}>
      <Input
        id={id}
        inputMode="numeric"
        value={value === undefined ? "" : String(value)}
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === "") return onChange(undefined);
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : undefined);
        }}
      />
    </Form.Item>
  );
}

/**
 * Option keys are stable once published, so an option in use can only be
 * retired, never deleted or renamed into a different meaning.
 */
function OptionEditor({
  options,
  onChange,
}: {
  options: SelectOptionView[];
  onChange: (options: SelectOptionView[]) => void;
}) {
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      {options.map((option, index) => (
        <Space key={option.key} align="baseline">
          <span className={styles.stableKey}>{option.key}</span>
          <Input
            aria-label={`选项名称 ${option.key}`}
            value={option.label}
            onChange={(event) => {
              const next = [...options];
              next[index] = { ...option, label: event.target.value };
              onChange(next);
            }}
          />
          <Button
            type="link"
            aria-label={`${option.status === "ACTIVE" ? "停用" : "恢复"}选项 ${option.key}`}
            onClick={() => {
              const next = [...options];
              next[index] = {
                ...option,
                status: option.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
              };
              onChange(next);
            }}
          >
            {option.status === "ACTIVE" ? "停用" : "恢复"}
          </Button>
        </Space>
      ))}
      <Button
        onClick={() =>
          onChange([
            ...options,
            {
              key: `option_${options.length + 1}`,
              label: `选项 ${options.length + 1}`,
              status: "ACTIVE",
            },
          ])
        }
      >
        添加选项
      </Button>
    </Space>
  );
}

function initialValues(field: ObjectDraftField): FieldDraftValues {
  const validation = field.validation as Record<string, unknown>;
  return {
    label: field.label,
    type: field.type as PublishedFieldType,
    required: field.required,
    employeeAccess: field.employeeAccess as PublishedFieldAccess,
    options: selectOptions({ config: field.config as never }),
    help: readString(field.config as Record<string, unknown>, "help") ?? "",
    minLength: readNumber(validation, "minLength"),
    maxLength: readNumber(validation, "maxLength"),
    min: readNumber(validation, "min"),
    max: readNumber(validation, "max"),
    scale: readNumber(validation, "scale"),
  };
}

function readString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
