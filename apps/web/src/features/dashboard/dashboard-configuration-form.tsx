"use client";

import { Alert, Button, Radio, Select, Spin } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { StatusTag } from "@/components/workbench/status-tag";
import { DataPanel, ReadingPanel } from "@/components/workbench/surface";
import { toApiError } from "@/lib/api/api-error";

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
  const router = useRouter();
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
  const [savedSignature, setSavedSignature] = useState(() =>
    configurationSignature(saved),
  );
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string; reload?: boolean } | undefined
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
  const missingStageGroups = stageGroupRequirements.filter(
    (requirement) => !grouped.includes(requirement.value),
  );
  const canSave = Boolean(
    objectCode && stageFieldKey && missingStageGroups.length === 0,
  );
  const currentConfiguration = buildConfiguration({
    objectCode,
    stageFieldKey,
    amountFieldKey,
    dateFieldKey,
    stageGroups,
  });
  const dirty =
    Boolean(objectCode || stageFieldKey) &&
    configurationSignature(currentConfiguration?.opportunity) !==
      savedSignature;

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
    if (!objectCode || !stageFieldKey) return;
    if (!canSave) {
      setFeedback({
        type: "error",
        message: `还需指定：${missingStageGroups
          .map((item) => item.label)
          .join("、")}。`,
      });
      return;
    }
    setSaving(true);
    setFeedback(undefined);
    const configuration = currentConfiguration!;
    try {
      const result = await saveDashboardConfiguration(tenantCode, {
        expectedVersion: version,
        configuration,
      });
      setVersion(result.version);
      setSavedSignature(configurationSignature(configuration.opportunity));
      setFeedback({
        type: "success",
        message: "工作台指标已经保存并立即生效。",
      });
      router.refresh();
    } catch (error) {
      const apiError = toApiError(error);
      setFeedback({
        type: "error",
        message: apiError.message,
        reload: apiError.code === "CONFIG_VERSION_CONFLICT",
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
          <StatusTag tone={dirty ? "warning" : version ? "success" : "warning"}>
            {dirty
              ? "有未保存修改"
              : version
                ? `配置版本 ${version}`
                : "尚未启用"}
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
          action={
            feedback.type === "success" ? (
              <Link href={`/workspace/${tenantCode}`}>查看生效结果</Link>
            ) : feedback.reload ? (
              <Button size="small" onClick={() => router.refresh()}>
                载入最新配置
              </Button>
            ) : undefined
          }
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
              <p>
                阶段字段要表示业务从推进到成交或失败的生命周期；不要选择“来源”“类型”或“等级”字段。
              </p>
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
            <span>
              {objectCode && stageFieldKey && missingStageGroups.length
                ? `还需指定：${missingStageGroups
                    .map((item) => item.label)
                    .join("、")}`
                : dirty
                  ? "当前修改尚未保存。"
                  : "保存后，工作台将用真实记录重新计算。"}
            </span>
            <Button
              type="primary"
              disabled={!canSave || saving}
              onClick={() => void save()}
            >
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
              ready={Boolean(stageFieldKey) && missingStageGroups.length === 0}
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

const stageGroupRequirements: Array<{
  value: Exclude<StageGroup, "IGNORE">;
  label: string;
}> = [
  { value: "ACTIVE", label: "进行中" },
  { value: "WON", label: "成交" },
  { value: "LOST", label: "失败" },
];

function buildConfiguration(input: {
  objectCode: string;
  stageFieldKey: string;
  amountFieldKey: string;
  dateFieldKey: string;
  stageGroups: Record<string, StageGroup>;
}): { opportunity: DashboardOpportunityConfiguration } | undefined {
  if (!input.objectCode || !input.stageFieldKey) return undefined;
  return {
    opportunity: {
      objectCode: input.objectCode,
      stageFieldKey: input.stageFieldKey,
      ...(input.amountFieldKey ? { amountFieldKey: input.amountFieldKey } : {}),
      ...(input.dateFieldKey ? { dateFieldKey: input.dateFieldKey } : {}),
      activeOptionKeys: optionKeys(input.stageGroups, "ACTIVE"),
      wonOptionKeys: optionKeys(input.stageGroups, "WON"),
      lostOptionKeys: optionKeys(input.stageGroups, "LOST"),
    },
  };
}

function configurationSignature(
  configuration: DashboardOpportunityConfiguration | undefined,
) {
  return configuration ? JSON.stringify(configuration) : "";
}
