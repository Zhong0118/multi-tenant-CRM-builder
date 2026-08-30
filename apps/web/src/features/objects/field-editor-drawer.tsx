"use client";

import {
  Button,
  Drawer,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";

import { StatusTag } from "@/components/workbench/status-tag";

import { OptionBadge } from "./option-badge";
import {
  FIELD_ACCESS_LABELS,
  FIELD_TYPE_LABELS,
  PUBLISHED_FIELD_TYPES,
  SELECT_OPTION_COLORS,
  SELECT_OPTION_COLOR_LABELS,
  selectOptions,
  type PublishedFieldAccess,
  type PublishedFieldType,
  type SelectOptionView,
} from "./object-types";
import type { ConfigurableFieldView } from "./configuration-view";

import styles from "./objects.module.css";

export interface FieldDraftValues {
  fieldKey: string;
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
  field: ConfigurableFieldView | null;
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
}: FieldEditorDrawerProps & { field: ConfigurableFieldView }) {
  const [values, setValues] = useState<FieldDraftValues>(() =>
    initialValues(field),
  );

  const fieldKeyLocked =
    field.publishedFieldKey === undefined || field.publishedFieldKey !== null;
  const typeLocked = field.publishedType !== null;
  const patch = (next: Partial<FieldDraftValues>) =>
    setValues({ ...values, ...next });

  return (
    <Drawer
      open
      size={600}
      className={styles.fieldDrawer}
      title={
        <div className={styles.drawerTitle}>
          <span>FIELD CONFIGURATION</span>
          <div>
            <strong>{field.label}</strong>
            <StatusTag tone={field.status === "ACTIVE" ? "success" : "neutral"}>
              {field.status === "ACTIVE" ? "启用中" : "已停用"}
            </StatusTag>
          </div>
          <small>决定字段如何录入、校验，以及员工是否能看到或修改。</small>
        </div>
      }
      onClose={onClose}
      destroyOnHidden
      footer={
        <div className={styles.fieldDrawerFooter}>
          <span>保存后仍需保存对象或模板草稿。</span>
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
        </div>
      }
    >
      {error ? (
        <Typography.Paragraph type="danger">{error}</Typography.Paragraph>
      ) : null}

      <Form component={false} layout="vertical">
        <section className={styles.drawerSection}>
          <DrawerSectionHeading
            number="01"
            title="显示与标识"
            description="名称给人看，字段键供系统稳定识别。"
          />
          <div className={styles.drawerFormGrid}>
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
              extra="在对象内唯一，发布后不再变更。"
            >
              <Input
                id="field-key"
                value={values.fieldKey}
                disabled={fieldKeyLocked}
                onChange={(event) => patch({ fieldKey: event.target.value })}
              />
            </Form.Item>
          </div>
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
          <DrawerSectionHeading
            number="02"
            title="数据类型"
            description="类型决定输入控件和服务端校验方式，发布后会锁定。"
          />
          <div className={styles.drawerFormGrid}>
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
            <Form.Item label="录入要求" htmlFor="field-required">
              <div className={styles.requiredControl}>
                <Switch
                  id="field-required"
                  aria-label="必填"
                  checked={values.required}
                  onChange={(required) => patch({ required })}
                />
                <span>{values.required ? "必须填写" : "可以留空"}</span>
              </div>
            </Form.Item>
          </div>
          <p className={styles.fieldTypeDescription}>
            {fieldTypeDescription(values.type)}
          </p>
          {typeLocked ? (
            <p className={styles.lockNote}>字段发布后不能更改数据类型。</p>
          ) : null}
        </section>

        <section className={styles.drawerSection}>
          <DrawerSectionHeading
            number="03"
            title={SELECT_TYPES.includes(values.type) ? "选项设置" : "校验规则"}
            description="只配置这类数据真正需要的限制。"
          />
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
          <DrawerSectionHeading
            number="04"
            title="员工访问"
            description="平台管理员和公司管理员始终可见；这里控制普通员工。"
          />
          <Form.Item
            label="员工访问级别"
            htmlFor="field-access"
            extra="字段权限来自发布版本，成员覆盖不会改变它。"
          >
            <Radio.Group
              id="field-access"
              className={styles.accessChoices}
              value={values.employeeAccess}
              optionType="button"
              buttonStyle="solid"
              onChange={(event) =>
                patch({
                  employeeAccess: event.target.value as PublishedFieldAccess,
                })
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

function DrawerSectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.drawerSectionHeading}>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function fieldTypeDescription(type: PublishedFieldType): string {
  const descriptions: Record<PublishedFieldType, string> = {
    TEXT: "适合名称、编号等单行文字。",
    TEXTAREA: "适合备注、需求说明等多行内容。",
    NUMBER: "只接受数字，可进一步限制范围和小数位。",
    MONEY: "用于金额，列表和详情会按金额语义展示。",
    DATE: "只记录日期，不包含具体时间。",
    DATETIME: "记录精确日期和时间。",
    BOOLEAN: "用于是/否、完成/未完成等二选一状态。",
    SINGLE_SELECT: "从预设选项中选择一个值。",
    MULTI_SELECT: "可以同时选择多个预设值。",
    PHONE: "用于电话号码并按电话号码规则校验。",
    EMAIL: "用于电子邮箱并检查基本格式。",
    MEMBER: "从当前公司的有效成员中选择一人。",
  };
  return descriptions[type];
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
    <div className={styles.optionEditor}>
      <div className={styles.optionEditorHeader} aria-hidden>
        <span>选项名称</span>
        <span>选项键</span>
        <span>颜色</span>
        <span>状态</span>
      </div>
      {options.map((option, index) => (
        <div key={index} className={styles.optionEditorRow}>
          <Input
            aria-label={`选项名称 ${option.key}`}
            value={option.label}
            onChange={(event) => {
              const next = [...options];
              next[index] = { ...option, label: event.target.value };
              onChange(next);
            }}
          />
          <Input
            aria-label={`选项键 ${option.key}`}
            className={styles.optionKeyInput}
            value={option.key}
            onChange={(event) => {
              const next = [...options];
              next[index] = {
                ...option,
                key: event.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]/g, ""),
              };
              onChange(next);
            }}
          />
          <Select
            aria-label={`选项颜色 ${option.key}`}
            value={option.color}
            onChange={(color) => {
              const next = [...options];
              next[index] = { ...option, color };
              onChange(next);
            }}
            options={SELECT_OPTION_COLORS.map((color) => ({
              value: color,
              label: (
                <OptionBadge
                  option={{
                    label: SELECT_OPTION_COLOR_LABELS[color],
                    color,
                    status: "ACTIVE",
                  }}
                />
              ),
            }))}
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
        </div>
      ))}
      <Button
        className={styles.addOptionButton}
        onClick={() =>
          onChange([
            ...options,
            {
              key: `option_${options.length + 1}`,
              label: `选项 ${options.length + 1}`,
              status: "ACTIVE",
              color:
                SELECT_OPTION_COLORS[
                  (options.length + 1) % SELECT_OPTION_COLORS.length
                ],
            },
          ])
        }
      >
        添加选项
      </Button>
    </div>
  );
}

function initialValues(field: ConfigurableFieldView): FieldDraftValues {
  const validation = field.validation as Record<string, unknown>;
  return {
    fieldKey: field.fieldKey,
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
