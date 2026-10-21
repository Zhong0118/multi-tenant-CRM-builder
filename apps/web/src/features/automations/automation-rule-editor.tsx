"use client";

import { ArrowRightOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Form, Input, Select, Switch } from "antd";
import { useState, type ReactNode } from "react";
import {
  DynamicField,
  type DynamicFieldMember,
} from "@/features/records/dynamic-field";
import { FIELD_TYPE_LABELS } from "@/features/objects/object-types";
import {
  editableAutomationField,
  type AutomationInputField,
  type AutomationMapping,
  type AutomationRule,
  type AutomationTable,
  type AutomationValue,
} from "./automation-types";
import styles from "./automations.module.css";

export interface AutomationRuleEditorProps {
  initial: AutomationRule;
  source: AutomationTable;
  targets: AutomationTable[];
  onSave: (rule: AutomationRule) => void;
  onCancel: () => void;
  members?: DynamicFieldMember[];
  saving?: boolean;
  readOnly?: boolean;
  preview?: (rule: AutomationRule) => ReactNode;
}

function compatible(
  source: AutomationInputField,
  target: AutomationInputField,
) {
  return source.type === target.type;
}
function describeMapping(
  mapping: AutomationMapping | undefined,
  source: AutomationTable,
) {
  if (!mapping) return "不填写";
  if (mapping.source === "SOURCE_FIELD")
    return (
      source.fields.find((field) => field.fieldKey === mapping.fieldKey)
        ?.label ?? "字段已不可用"
    );
  if (mapping.source === "INPUT") return "执行时填写";
  if (mapping.source === "NOW") return "当前时间";
  return Array.isArray(mapping.value)
    ? mapping.value.join("、")
    : String(mapping.value ?? "空值");
}

export function AutomationRuleEditor({
  initial,
  source,
  targets,
  onSave,
  onCancel,
  members = [],
  saving = false,
  readOnly = false,
  preview,
}: AutomationRuleEditorProps) {
  const [rule, setRule] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const target = targets.find((table) => table.code === rule.targetObjectCode);
  const trigger = rule.trigger;
  const triggerField =
    trigger.type === "FIELD_CHANGED"
      ? source.fields.find((field) => field.fieldKey === trigger.fieldKey)
      : undefined;
  const update = (patch: Partial<AutomationRule>) => {
    setRule((current) => ({ ...current, ...patch }));
    setErrors([]);
  };
  function mapping(key: string, next?: AutomationMapping) {
    const mappings = { ...rule.mappings };
    if (next) mappings[key] = next;
    else delete mappings[key];
    update({ mappings });
  }
  function save() {
    const issues: string[] = [];
    if (!rule.label.trim()) issues.push("请填写规则名称");
    if (!target) issues.push("请选择已发布的目标业务表");
    if (!rule.allowedRoles.length) issues.push("请选择可以执行的角色");
    if (
      rule.trigger.type === "FIELD_CHANGED" &&
      (!triggerField ||
        rule.trigger.equals === null ||
        rule.trigger.equals === "")
    )
      issues.push("请选择触发字段和目标值");
    for (const field of target?.fields ?? []) {
      const value = rule.mappings[field.fieldKey];
      if (field.required && field.defaultValue == null && !value)
        issues.push(`${field.label}：请选择取值方式`);
      if (
        value?.source === "SOURCE_FIELD" &&
        !source.fields.some(
          (item) => item.fieldKey === value.fieldKey && compatible(item, field),
        )
      )
        issues.push(`${field.label}：请选择兼容的来源字段`);
      if (
        value?.source === "INPUT" &&
        field.type === "MEMBER" &&
        rule.allowedRoles.includes("EMPLOYEE")
      )
        issues.push(
          `${field.label}：员工不支持临时选择成员，请沿用来源字段或由管理员设置固定成员`,
        );
      if (value?.source === "INPUT" && rule.trigger.type !== "MANUAL")
        issues.push(`${field.label}：自动触发不能等待人工填写`);
    }
    setErrors(issues);
    if (!issues.length) onSave({ ...rule, label: rule.label.trim() });
  }
  return (
    <div className={styles.panel}>
      <div className={styles.steps}>
        <strong>1 设置触发方式</strong>
        <ArrowRightOutlined />
        <span>2 对应目标字段</span>
        <ArrowRightOutlined />
        <span>3 预览并保存</span>
      </div>
      <div className={styles.editor}>
        <Form
          layout="vertical"
          className={styles.form}
          disabled={saving || readOnly}
        >
          <Form.Item label="规则名称" htmlFor="automation-label" required>
            <Input
              id="automation-label"
              value={rule.label}
              maxLength={80}
              placeholder="例如 确认开单"
              onChange={(event) => update({ label: event.target.value })}
            />
          </Form.Item>
          <div className={styles.fieldGroup}>
            <Form.Item label="何时执行" htmlFor="automation-trigger">
              <Select
                id="automation-trigger"
                value={rule.trigger.type}
                onChange={(type: "MANUAL" | "FIELD_CHANGED") =>
                  update({
                    trigger:
                      type === "MANUAL"
                        ? { type }
                        : { type, fieldKey: "", equals: null },
                    mappings: Object.fromEntries(
                      Object.entries(rule.mappings).filter(
                        ([, value]) =>
                          type === "MANUAL" || value.source !== "INPUT",
                      ),
                    ),
                  })
                }
                options={[
                  { value: "MANUAL", label: "员工点击动作后确认" },
                  { value: "FIELD_CHANGED", label: "字段变为指定值时" },
                ]}
              />
            </Form.Item>
            <Form.Item label="新记录负责人" htmlFor="automation-owner">
              <Select
                id="automation-owner"
                value={rule.owner}
                options={[
                  { value: "SOURCE_OWNER", label: "沿用来源记录负责人" },
                  { value: "ACTOR", label: "执行本次操作的人" },
                ]}
                onChange={(owner) => update({ owner })}
              />
            </Form.Item>
          </div>
          {rule.trigger.type === "FIELD_CHANGED" && (
            <div className={styles.fieldGroup}>
              <Form.Item label="触发字段" htmlFor="automation-trigger-field">
                <Select
                  id="automation-trigger-field"
                  value={rule.trigger.fieldKey || undefined}
                  placeholder="选择来源字段"
                  options={source.fields
                    .filter((field) =>
                      ["SINGLE_SELECT", "BOOLEAN", "TEXT", "NUMBER"].includes(
                        field.type,
                      ),
                    )
                    .map((field) => ({
                      value: field.fieldKey,
                      label: field.label,
                    }))}
                  onChange={(fieldKey) =>
                    update({
                      trigger: {
                        type: "FIELD_CHANGED",
                        fieldKey,
                        equals: null,
                      },
                    })
                  }
                />
              </Form.Item>
              {triggerField && (
                <DynamicField
                  field={{
                    ...editableAutomationField(triggerField),
                    fieldKey: `trigger_${triggerField.fieldKey}`,
                    label: "变为以下值",
                    required: true,
                  }}
                  value={rule.trigger.equals}
                  onChange={(equals) =>
                    update({
                      trigger: {
                        type: "FIELD_CHANGED",
                        fieldKey: triggerField.fieldKey,
                        equals: equals as AutomationValue,
                      },
                    })
                  }
                />
              )}
            </div>
          )}
          <p className={styles.caption}>
            {rule.trigger.type === "MANUAL"
              ? "执行前可以补填信息。同一客户需要再次开单时，可再次点击此动作"
              : "仅从其他值变为指定值时执行，每条来源记录只自动创建一次。历史记录和导入不会自动触发"}
          </p>
          <Form.Item
            label="在哪张表创建记录"
            htmlFor="automation-target"
            required
          >
            <Select
              id="automation-target"
              showSearch
              optionFilterProp="label"
              value={rule.targetObjectCode || undefined}
              placeholder="选择已发布的业务表"
              options={targets.map((table) => ({
                value: table.code,
                label: table.name,
              }))}
              onChange={(targetObjectCode) =>
                update({ targetObjectCode, mappings: {} })
              }
            />
          </Form.Item>
          {target && (
            <section aria-label="字段映射" className={styles.mapping}>
              {target.fields.map((field) => {
                const value = rule.mappings[field.fieldKey];
                const label = `${field.label}取值方式`;
                return (
                  <div className={styles.mappingRow} key={field.fieldKey}>
                    <div className={styles.mappingControls}>
                      <Select
                        aria-label={label}
                        value={value?.source ?? "NONE"}
                        options={[
                          {
                            value: "NONE",
                            label: field.required
                              ? "请选择取值方式"
                              : "不填写 / 使用默认值",
                          },
                          { value: "SOURCE_FIELD", label: "来源记录的字段" },
                          { value: "LITERAL", label: "固定值" },
                          ...(rule.trigger.type === "MANUAL"
                            ? [
                                {
                                  value: "INPUT",
                                  label: "执行时填写",
                                  disabled:
                                    field.type === "MEMBER" &&
                                    rule.allowedRoles.includes("EMPLOYEE"),
                                },
                              ]
                            : []),
                          ...(["DATE", "DATETIME"].includes(field.type)
                            ? [{ value: "NOW", label: "当前时间" }]
                            : []),
                        ]}
                        onChange={(kind: string) =>
                          mapping(
                            field.fieldKey,
                            kind === "NONE"
                              ? undefined
                              : kind === "SOURCE_FIELD"
                                ? { source: kind, fieldKey: "" }
                                : kind === "LITERAL"
                                  ? { source: kind, value: null }
                                  : ({ source: kind } as AutomationMapping),
                          )
                        }
                      />
                      {value?.source === "SOURCE_FIELD" && (
                        <Select
                          aria-label={`${field.label}来源字段`}
                          placeholder="选择类型兼容的字段"
                          value={value.fieldKey || undefined}
                          options={source.fields
                            .filter((item) => compatible(item, field))
                            .map((item) => ({
                              value: item.fieldKey,
                              label: item.label,
                            }))}
                          onChange={(fieldKey) =>
                            mapping(field.fieldKey, {
                              source: "SOURCE_FIELD",
                              fieldKey,
                            })
                          }
                        />
                      )}
                      {value?.source === "LITERAL" && (
                        <DynamicField
                          members={members}
                          field={{
                            ...editableAutomationField(field),
                            fieldKey: `literal_${field.fieldKey}`,
                            label: `${field.label}固定值`,
                          }}
                          value={value.value}
                          onChange={(next) =>
                            mapping(field.fieldKey, {
                              source: "LITERAL",
                              value: next as AutomationValue,
                            })
                          }
                        />
                      )}
                    </div>
                    <ArrowRightOutlined aria-hidden />
                    <div className={styles.mappingTarget}>
                      <strong>
                        {field.label}
                        {field.required ? " *" : ""}
                      </strong>
                      <small>{FIELD_TYPE_LABELS[field.type]}</small>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          <Form.Item label="允许执行的角色">
            <Checkbox.Group
              value={rule.allowedRoles}
              options={[
                { value: "TENANT_ADMIN", label: "公司管理员" },
                { value: "EMPLOYEE", label: "员工" },
              ]}
              onChange={(allowedRoles) =>
                update({
                  allowedRoles: allowedRoles as AutomationRule["allowedRoles"],
                })
              }
            />
            <p className={styles.caption}>
              执行人仍须有来源记录修改权、目标表创建权和相关字段权限
            </p>
          </Form.Item>
          <Form.Item label="发布后启用">
            <Switch
              checked={rule.enabled}
              onChange={(enabled) => update({ enabled })}
            />
          </Form.Item>
        </Form>
        <aside className={styles.preview} aria-label="规则预览">
          <h3>
            {source.name} <ArrowRightOutlined /> {target?.name ?? "目标业务表"}
          </h3>
          <p className={styles.caption}>
            创建新记录并建立关联，来源记录保持保留
          </p>
          <dl className={styles.previewValues}>
            {target?.fields.map((field) => (
              <div key={field.fieldKey} style={{ display: "contents" }}>
                <dt>{field.label}</dt>
                <dd>
                  {describeMapping(rule.mappings[field.fieldKey], source)}
                </dd>
              </div>
            ))}
          </dl>
          {preview?.(rule)}
        </aside>
      </div>
      {errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          title="请完善规则"
          description={
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          }
        />
      )}
      <div className={styles.actions}>
        <Button onClick={onCancel} disabled={saving || readOnly}>
          {readOnly ? "关闭" : "取消"}
        </Button>
        {!readOnly && (
          <Button type="primary" loading={saving} onClick={save}>
            保存规则草稿
          </Button>
        )}
      </div>
    </div>
  );
}
