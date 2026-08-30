"use client";

import { Alert, Button, Radio, Select, Spin } from "antd";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { StatusTag } from "@/components/workbench/status-tag";
import { DataPanel, ReadingPanel } from "@/components/workbench/surface";

import { saveDashboardConfiguration } from "./dashboard-api";
import type {
  DashboardCandidateOption,
  DashboardConfigurationView,
  DashboardOpportunityConfiguration,
} from "./dashboard-types";
import styles from "./dashboard-configuration.module.css";

type StageGroup = "ACTIVE" | "WON" | "LOST" | "IGNORE";

export function DashboardConfigurationForm({
  tenantCode,
  initial,
}: {
  tenantCode: string;
  initial: DashboardConfigurationView;
}) {
  const saved = initial.record?.configuration.opportunity;
  const [version, setVersion] = useState(initial.record?.version ?? 0);
  const [objectCode, setObjectCode] = useState(saved?.objectCode ?? "");
  const [stageFieldKey, setStageFieldKey] = useState(
    saved?.stageFieldKey ?? "",
  );
  const [amountFieldKey, setAmountFieldKey] = useState(
    saved?.amountFieldKey ?? "",
  );
  const [dateFieldKey, setDateFieldKey] = useState(saved?.dateFieldKey ?? "");
  const [stageGroups, setStageGroups] = useState<Record<string, StageGroup>>(
    () => initialStageGroups(saved),
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | undefined
  >();

  const candidate = initial.candidates.find(
    (item) => item.object.code === objectCode,
  );
  const stageFields =
    candidate?.fields.filter((field) => field.type === "SINGLE_SELECT") ?? [];
  const amountFields =
    candidate?.fields.filter(
      (field) => field.type === "MONEY" || field.type === "NUMBER",
    ) ?? [];
  const dateFields =
    candidate?.fields.filter(
      (field) => field.type === "DATE" || field.type === "DATETIME",
    ) ?? [];
  const stageOptions = useMemo(
    () =>
      stageFields
        .find((field) => field.fieldKey === stageFieldKey)
        ?.config.options?.filter((option) => option.status === "ACTIVE") ?? [],
    [stageFieldKey, stageFields],
  );
  const grouped = Object.values(stageGroups);
  const canSave = Boolean(
    objectCode &&
    stageFieldKey &&
    grouped.includes("ACTIVE") &&
    grouped.includes("WON") &&
    grouped.includes("LOST"),
  );

  function chooseObject(next: string) {
    setObjectCode(next);
    setStageFieldKey("");
    setAmountFieldKey("");
    setDateFieldKey("");
    setStageGroups({});
    setFeedback(undefined);
  }

  function chooseStage(next: string) {
    setStageFieldKey(next);
    setStageGroups(
      Object.fromEntries(
        (
          stageFields.find((field) => field.fieldKey === next)?.config
            .options ?? []
        )
          .filter((option) => option.status === "ACTIVE")
          .map((option) => [option.key, "IGNORE" as const]),
      ),
    );
    setFeedback(undefined);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setFeedback(undefined);
    const configuration: { opportunity: DashboardOpportunityConfiguration } = {
      opportunity: {
        objectCode,
        stageFieldKey,
        ...(amountFieldKey ? { amountFieldKey } : {}),
        ...(dateFieldKey ? { dateFieldKey } : {}),
        activeOptionKeys: optionKeys(stageGroups, "ACTIVE"),
        wonOptionKeys: optionKeys(stageGroups, "WON"),
        lostOptionKeys: optionKeys(stageGroups, "LOST"),
      },
    };
    try {
      const result = await saveDashboardConfiguration(tenantCode, {
        expectedVersion: version,
        configuration,
      });
      setVersion(result.version);
      setFeedback({
        type: "success",
        message: "工作台指标已经保存并立即生效。",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "保存失败，请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  }

  if (initial.candidates.length === 0) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="工作台与指标"
          description="把已发布业务表映射成真实的经营指标。"
        />
        <Alert
          showIcon
          type="info"
          title="还没有可配置的已发布业务表"
          description="请先创建并发布业务表，再回来配置阶段、金额和成交日期。"
          action={
            <Link href={`/workspace/${tenantCode}/settings/objects`}>
              管理业务表
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="工作台与指标"
        description="告诉系统哪些已发布字段代表阶段、金额和成交日期；管理员与员工将共享口径，但数据范围不同。"
        status={
          <StatusTag tone={version ? "success" : "warning"}>
            {version ? `配置版本 ${version}` : "尚未启用"}
          </StatusTag>
        }
        extra={
          <Link href={`/workspace/${tenantCode}`} className={styles.backLink}>
            返回工作台
          </Link>
        }
      />

      {feedback ? (
        <Alert
          className={styles.feedback}
          showIcon
          type={feedback.type}
          title={feedback.message}
        />
      ) : null}
      {initial.issues.length ? (
        <Alert
          className={styles.feedback}
          showIcon
          type="warning"
          title="现有配置需要修复"
          description={initial.issues.map((issue) => issue.message).join("；")}
        />
      ) : null}

      <div className={styles.layout}>
        <DataPanel className={styles.formPanel} ariaLabel="指标字段映射">
          <section className={styles.section}>
            <div className={styles.sectionNumber}>01</div>
            <div className={styles.sectionBody}>
              <h2>选择核心业务表</h2>
              <p>首期工作台以一张商机或跟单表为主轴。</p>
              <label className={styles.fieldLabel}>
                商机/跟单业务表
                <Select
                  aria-label="商机或跟单业务表"
                  value={objectCode || undefined}
                  placeholder="选择一张已发布业务表"
                  onChange={chooseObject}
                  options={initial.candidates.map((item) => ({
                    value: item.object.code,
                    label: item.object.name,
                  }))}
                />
              </label>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionNumber}>02</div>
            <div className={styles.sectionBody}>
              <h2>映射统计字段</h2>
              <p>下拉框只显示类型兼容的已发布字段，不会靠名称猜测。</p>
              <div className={styles.fieldGrid}>
                <label className={styles.fieldLabel}>
                  阶段字段 <strong>必选</strong>
                  <Select
                    aria-label="阶段字段"
                    disabled={!candidate}
                    value={stageFieldKey || undefined}
                    placeholder="选择单选字段"
                    onChange={chooseStage}
                    options={stageFields.map((field) => ({
                      value: field.fieldKey,
                      label: field.label,
                    }))}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  金额字段 <span>可选</span>
                  <Select
                    aria-label="金额字段"
                    allowClear
                    disabled={!candidate}
                    value={amountFieldKey || undefined}
                    placeholder="选择数字或金额字段"
                    onChange={(value?: string) =>
                      setAmountFieldKey(value ?? "")
                    }
                    options={amountFields.map((field) => ({
                      value: field.fieldKey,
                      label: field.label,
                    }))}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  成交/预计日期 <span>可选</span>
                  <Select
                    aria-label="成交或预计日期字段"
                    allowClear
                    disabled={!candidate}
                    value={dateFieldKey || undefined}
                    placeholder="选择日期字段"
                    onChange={(value?: string) => setDateFieldKey(value ?? "")}
                    options={dateFields.map((field) => ({
                      value: field.fieldKey,
                      label: field.label,
                    }))}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionNumber}>03</div>
            <div className={styles.sectionBody}>
              <h2>定义阶段含义</h2>
              <p>每个选项归入一种统计类别，图表保留原始标签和颜色。</p>
              {stageOptions.length ? (
                <div className={styles.optionRows}>
                  {stageOptions.map((option) => (
                    <StageOptionRow
                      key={option.key}
                      option={option}
                      value={stageGroups[option.key] ?? "IGNORE"}
                      onChange={(value) =>
                        setStageGroups((current) => ({
                          ...current,
                          [option.key]: value,
                        }))
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.optionPlaceholder}>
                  选择阶段字段后，在这里给选项分类。
                </div>
              )}
            </div>
          </section>

          <div className={styles.actions}>
            <span>保存后，工作台将用真实记录重新计算。</span>
            <Button type="primary" disabled={!canSave} onClick={save}>
              {saving ? <Spin size="small" /> : null}
              保存并启用工作台
            </Button>
          </div>
        </DataPanel>

        <ReadingPanel className={styles.preview} ariaLabel="可生成的工作台内容">
          <span className={styles.eyebrow}>LIVE READINESS</span>
          <h2>可以生成什么</h2>
          <p>
            系统不会添加假数字。只有映射完整且存在记录时，模块才会出现真实结果。
          </p>
          <ul className={styles.readiness}>
            <ReadinessItem ready={Boolean(objectCode)} label="核心业务表" />
            <ReadinessItem
              ready={Boolean(stageFieldKey)}
              label="阶段分布与销售管道"
            />
            <ReadinessItem
              ready={Boolean(amountFieldKey)}
              label="成交金额与员工金额排行"
              optional
            />
            <ReadinessItem
              ready={Boolean(dateFieldKey)}
              label="趋势、到期和逾期判断"
              optional
            />
            <ReadinessItem
              ready={grouped.includes("WON")}
              label="成交单数与成交率"
            />
          </ul>
          <div className={styles.scopeNote}>
            <strong>权限不会被工作台绕过</strong>
            <span>管理员看公司汇总；员工只统计自己有效数据范围内的记录。</span>
          </div>
        </ReadingPanel>
      </div>
    </div>
  );
}

function StageOptionRow({
  option,
  value,
  onChange,
}: {
  option: DashboardCandidateOption;
  value: StageGroup;
  onChange: (value: StageGroup) => void;
}) {
  return (
    <div className={styles.optionRow}>
      <span className={styles.optionName} data-option-color={option.color}>
        <i aria-hidden />
        {option.label}
      </span>
      <Radio.Group
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value as StageGroup)}
        options={[
          { label: "进行中", value: "ACTIVE" },
          { label: "成交", value: "WON" },
          { label: "失败", value: "LOST" },
          { label: "不统计", value: "IGNORE" },
        ]}
      />
    </div>
  );
}

function ReadinessItem({
  ready,
  label,
  optional,
}: {
  ready: boolean;
  label: string;
  optional?: boolean;
}) {
  return (
    <li data-ready={ready}>
      <i aria-hidden>{ready ? "✓" : optional ? "·" : "!"}</i>
      <span>{label}</span>
      {optional ? <small>可选增强</small> : null}
    </li>
  );
}

function initialStageGroups(
  value: DashboardOpportunityConfiguration | undefined,
): Record<string, StageGroup> {
  if (!value) return {};
  return Object.fromEntries([
    ...value.activeOptionKeys.map((key) => [key, "ACTIVE" as const]),
    ...value.wonOptionKeys.map((key) => [key, "WON" as const]),
    ...value.lostOptionKeys.map((key) => [key, "LOST" as const]),
  ]);
}

function optionKeys(groups: Record<string, StageGroup>, target: StageGroup) {
  return Object.entries(groups)
    .filter(([, value]) => value === target)
    .map(([key]) => key);
}
