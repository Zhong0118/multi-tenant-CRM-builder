"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Segmented, Spin } from "antd";
import Link from "next/link";
import { useState } from "react";

import { objectApi } from "@/features/objects/object-api";
import type { ObjectDraft } from "@/features/objects/object-types";

import { automationApi } from "./automation-api";
import { automationError } from "./automation-preview";
import {
  automationTriggerLabel,
  automationValueLabel,
  type AutomationInputField,
  type AutomationMapping,
  type AutomationRule,
} from "./automation-types";
import { RelationshipMap, ruleNumber } from "./relationship-map";
import styles from "./relationship-map.module.css";
import overview from "./relationship-overview.module.css";

const ROLE_LABELS = { TENANT_ADMIN: "公司管理员", EMPLOYEE: "员工" } as const;

/** What one execution of a rule leaves behind, in words. */
export function ruleResult(rule: AutomationRule, targetName: string): string {
  return [
    `在「${targetName}」新增 1 条记录，与来源记录互相关联`,
    rule.owner === "SOURCE_OWNER"
      ? "负责人沿用来源记录的负责人"
      : "负责人为执行的人",
    rule.trigger.type === "MANUAL"
      ? "每次确认执行都会再新增一条"
      : "每条来源记录只会自动创建一次",
  ].join("；");
}

function mappingSource(
  mapping: AutomationMapping,
  source: ObjectDraft,
  targetField?: AutomationInputField,
): string {
  switch (mapping.source) {
    case "SOURCE_FIELD":
      return `来源「${
        source.fields.find((field) => field.fieldKey === mapping.fieldKey)
          ?.label ?? mapping.fieldKey
      }」`;
    case "NOW":
      return "执行时的时间";
    case "INPUT":
      return "执行时填写";
    case "LITERAL":
      return `固定值「${automationValueLabel(mapping.value, targetField)}」`;
  }
}

export function RelationshipOverview({ tenantCode }: { tenantCode: string }) {
  const [view, setView] = useState("published");
  const [selected, setSelected] = useState<string>();
  const graph = useQuery({
    queryKey: ["automation-relationships", tenantCode],
    queryFn: async () => {
      const objects = await objectApi.listDrafts(tenantCode);
      return Promise.all(
        objects.map(async (draft) => ({
          draft,
          configuration: await automationApi.configuration(
            tenantCode,
            draft.object.id,
          ),
        })),
      );
    },
  });
  if (graph.isPending) return <Spin aria-label="加载业务表关系" />;
  if (graph.isError)
    return (
      <Alert
        type="error"
        title="关系图加载失败"
        description={automationError(graph.error)}
        action={<Button onClick={() => void graph.refetch()}>重试</Button>}
      />
    );
  const rows = graph.data.flatMap(({ draft, configuration }) =>
    (view === "published"
      ? configuration.publishedRules
      : configuration.rules
    ).map((rule) => ({ id: `${draft.object.id}:${rule.key}`, draft, rule })),
  );
  const tables = new Map(
    graph.data.map(({ draft }) => [draft.object.code, draft]),
  );
  const nameOf = (code: string) => tables.get(code)?.object.name ?? code;
  const pendingTables = graph.data.filter(
    ({ configuration }) =>
      JSON.stringify(configuration.rules) !==
      JSON.stringify(configuration.publishedRules),
  ).length;

  return (
    <div className={overview.layout}>
      <div className={overview.head}>
        <p className={overview.lead}>
          每条规则从<strong>来源业务表</strong>的一条记录出发，在
          <strong>目标业务表</strong>
          新建一条记录并互相关联。图和「规则说明」用相同的编号；手动关联的已有记录请到记录详情查看。
        </p>
        <Segmented
          aria-label="总览规则版本"
          value={view}
          onChange={(value) => {
            setView(value);
            setSelected(undefined);
          }}
          options={[
            { label: "当前生效", value: "published" },
            {
              label: pendingTables
                ? `待发布草稿 · ${pendingTables} 张表有修改`
                : "待发布草稿",
              value: "draft",
            },
          ]}
        />
      </div>
      {view === "draft" ? (
        <Alert
          type="info"
          showIcon
          title="正在查看草稿规则：发布对应的业务表后才会执行。"
        />
      ) : null}

      <div className={overview.split}>
        <RelationshipMap
          nodes={graph.data.map(({ draft }) => ({
            code: draft.object.code,
            name: draft.object.name,
          }))}
          edges={rows.map(({ id, draft, rule }) => ({
            id,
            source: draft.object.code,
            target: rule.targetObjectCode,
            label: rule.label,
            trigger: automationTriggerLabel(rule, draft.fields),
            enabled: rule.enabled && draft.object.status !== "ARCHIVED",
          }))}
          selectedId={selected}
          onSelect={setSelected}
        />

        <section className={overview.explain} aria-label="规则说明">
          <h3>规则说明</h3>
          {rows.length === 0 ? (
            <p className={overview.muted}>
              {view === "published"
                ? "还没有生效的跨表规则。在业务表的「跨表自动化」中新建规则并发布后，会出现在这里。"
                : "草稿中没有跨表规则。"}
            </p>
          ) : (
            <ol className={overview.list}>
              {rows.map(({ id, draft, rule }, index) => {
                const target = tables.get(rule.targetObjectCode);
                const active = selected === id;
                const off = !rule.enabled || draft.object.status === "ARCHIVED";
                return (
                  <li
                    key={id}
                    className={overview.item}
                    data-selected={active || undefined}
                    data-off={off || undefined}
                  >
                    <button
                      type="button"
                      className={overview.itemHead}
                      aria-expanded={active}
                      onClick={() => setSelected(active ? undefined : id)}
                    >
                      <span className={styles.number} aria-hidden>
                        {ruleNumber(index)}
                      </span>
                      <span>
                        <strong>{rule.label}</strong>
                        <span className={overview.route}>
                          {draft.object.name} → {nameOf(rule.targetObjectCode)}
                          {off ? " · 已关闭" : ""}
                        </span>
                      </span>
                    </button>
                    <dl className={overview.facts}>
                      <dt>触发条件</dt>
                      <dd>{automationTriggerLabel(rule, draft.fields)}</dd>
                      <dt>执行结果</dt>
                      <dd>{ruleResult(rule, nameOf(rule.targetObjectCode))}</dd>
                      {active ? (
                        <>
                          <dt>谁可以执行</dt>
                          <dd>
                            {rule.trigger.type === "MANUAL"
                              ? rule.allowedRoles
                                  .map((role) => ROLE_LABELS[role])
                                  .join("、")
                              : "条件满足时自动执行"}
                          </dd>
                          <dt>字段对应</dt>
                          <dd>
                            {Object.keys(rule.mappings).length ? (
                              <table
                                className={overview.mapping}
                                aria-label={`${rule.label}的字段对应`}
                              >
                                <thead>
                                  <tr>
                                    <th scope="col">
                                      {nameOf(rule.targetObjectCode)}的字段
                                    </th>
                                    <th scope="col">取值</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(rule.mappings).map(
                                    ([key, mapping]) => (
                                      <tr key={key}>
                                        <th scope="row">
                                          {target?.fields.find(
                                            (field) => field.fieldKey === key,
                                          )?.label ?? key}
                                        </th>
                                        <td>
                                          {mappingSource(
                                            mapping,
                                            draft,
                                            target?.fields.find(
                                              (field) => field.fieldKey === key,
                                            ) as
                                              AutomationInputField | undefined,
                                          )}
                                        </td>
                                      </tr>
                                    ),
                                  )}
                                </tbody>
                              </table>
                            ) : (
                              "没有带入字段"
                            )}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                    {active ? (
                      <p className={overview.itemFoot}>
                        字段值在创建时复制，之后修改来源记录不会覆盖目标记录。
                        <Link
                          href={`/workspace/${encodeURIComponent(tenantCode)}/settings/objects/${draft.object.id}?section=automations`}
                        >
                          配置这条规则
                        </Link>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
