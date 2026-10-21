"use client";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Segmented, Spin } from "antd";
import Link from "next/link";
import { useState } from "react";
import { objectApi } from "@/features/objects/object-api";
import { automationApi } from "./automation-api";
import { automationError } from "./automation-preview";
import { RelationshipMap } from "./relationship-map";
import styles from "./automations.module.css";

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
  const selection = rows.find((row) => row.id === selected);
  const names = new Map(
    graph.data.map(({ draft }) => [draft.object.code, draft.object.name]),
  );
  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <p className={styles.caption}>
          查看公司业务表之间的创建规则和记录关联，点击连线查看字段对应关系
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
            { label: "待发布草稿", value: "draft" },
          ]}
        />
      </div>
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
          trigger: rule.trigger.type === "MANUAL" ? "手动确认" : "字段变化",
          enabled: rule.enabled && draft.object.status !== "ARCHIVED",
        }))}
        selectedId={selected}
        onSelect={setSelected}
      />
      {selection && (
        <section className={styles.preview} aria-label="关联规则详情">
          <div className={styles.heading}>
            <h3>{selection.rule.label}</h3>
            <Link
              href={`/workspace/${encodeURIComponent(tenantCode)}/settings/objects/${selection.draft.object.id}?section=automations`}
            >
              配置这条规则
            </Link>
          </div>
          <p>
            {selection.draft.object.name} →{" "}
            {names.get(selection.rule.targetObjectCode) ??
              selection.rule.targetObjectCode}
          </p>
          <dl className={styles.previewValues}>
            {Object.entries(selection.rule.mappings).map(([key, value]) => {
              const target = graph.data.find(
                (row) =>
                  row.draft.object.code === selection.rule.targetObjectCode,
              )?.draft;
              const sourceLabel =
                value.source === "SOURCE_FIELD"
                  ? (selection.draft.fields.find(
                      (field) => field.fieldKey === value.fieldKey,
                    )?.label ?? value.fieldKey)
                  : value.source === "NOW"
                    ? "当前时间"
                    : value.source === "INPUT"
                      ? "执行时填写"
                      : String(value.value ?? "空值");
              return (
                <div key={key} style={{ display: "contents" }}>
                  <dt>
                    {target?.fields.find((field) => field.fieldKey === key)
                      ?.label ?? key}
                  </dt>
                  <dd>{sourceLabel}</dd>
                </div>
              );
            })}
          </dl>
          <p className={styles.caption}>
            字段值在创建时复制，之后修改来源记录不会覆盖目标记录
          </p>
        </section>
      )}
    </div>
  );
}
