"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tag,
} from "antd";
import { PlusOutlined, EditOutlined, LinkOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { browserApiClient } from "@/lib/api/browser-client";
import type { DynamicFieldMember } from "@/features/records/dynamic-field";
import { objectApi, type ObjectApi } from "@/features/objects/object-api";
import type { ObjectDraft } from "@/features/objects/object-types";
import { automationApi, type AutomationApi } from "./automation-api";
import type { AutomationRule, AutomationTable } from "./automation-types";
import { AutomationRuleEditor } from "./automation-rule-editor";
import { automationError, DraftAutomationPreview } from "./automation-preview";
import { RelationshipMap } from "./relationship-map";
import styles from "./automations.module.css";

export function AutomationDesigner({
  tenantCode,
  draft,
  onObjectVersion,
  api = automationApi,
  objects = objectApi,
}: {
  tenantCode: string;
  draft: ObjectDraft;
  onObjectVersion: (draft: ObjectDraft) => void;
  api?: AutomationApi;
  objects?: ObjectApi;
}) {
  const queryClient = useQueryClient();
  const queryKey = [
    "automation-config",
    tenantCode,
    draft.object.id,
    draft.object.version,
    draft.object.publicationNumber,
  ];
  const config = useQuery({
    queryKey,
    queryFn: () => api.configuration(tenantCode, draft.object.id),
  });
  const targets = useQuery({
    queryKey: ["automation-targets", tenantCode, draft.object.id],
    queryFn: async () => {
      const rows = await objects.listDrafts(tenantCode);
      return Promise.all(
        rows
          .filter(
            (row) =>
              row.object.id !== draft.object.id &&
              row.object.status === "ACTIVE" &&
              row.object.publicationNumber !== null,
          )
          .map(async (row): Promise<AutomationTable> => {
            const schema = await objects.runtimeSchema(
              tenantCode,
              row.object.code,
            );
            return {
              code: schema.object.code,
              name: schema.object.name,
              fields: schema.fields,
            };
          }),
      );
    },
  });
  const members = useQuery({
    queryKey: ["automation-members", tenantCode],
    enabled:
      targets.data?.some((table) =>
        table.fields.some((field) => field.type === "MEMBER"),
      ) ?? false,
    queryFn: async () => {
      const rows: DynamicFieldMember[] = [];
      let loaded = 0;
      for (let page = 1; ; page++) {
        const result = await browserApiClient.GET(
          "/api/v1/workspaces/{tenantCode}/members",
          { params: { path: { tenantCode }, query: { page, limit: 100 } } },
        );
        if (!result.data) throw result.error;
        rows.push(
          ...result.data.items
            .filter((member) => member.status === "ACTIVE")
            .map((member) => ({
              id: member.id,
              displayName: member.displayName ?? null,
            })),
        );
        loaded += result.data.items.length;
        if (loaded >= result.data.total || !result.data.items.length)
          return rows;
      }
    },
  });
  const [view, setView] = useState("draft");
  const [editing, setEditing] = useState<AutomationRule>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const archived = draft.object.status === "ARCHIVED";
  const source: AutomationTable = {
    code: draft.object.code,
    name: draft.object.name,
    fields: draft.fields
      .filter((field) => field.status === "ACTIVE")
      .map((field) => ({ ...field, config: field.config ?? {} })),
  };
  async function save(rules: AutomationRule[]) {
    if (!config.data) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.save(
        tenantCode,
        draft.object.id,
        config.data.version,
        rules,
      );
      queryClient.setQueryData(queryKey, saved);
      onObjectVersion({
        ...draft,
        object: {
          ...draft.object,
          version: saved.version,
          hasUnpublishedChanges: true,
        },
      });
      setEditing(undefined);
      setNotice("规则草稿已保存，发布业务表后生效");
      void queryClient.invalidateQueries({
        queryKey: ["automation-relationships", tenantCode],
      });
    } catch (error) {
      setError(automationError(error));
    } finally {
      setSaving(false);
    }
  }
  if (config.isPending || targets.isPending)
    return <Spin aria-label="加载跨表规则" />;
  if (config.isError || targets.isError)
    return (
      <Alert
        type="error"
        title="跨表规则加载失败"
        description={automationError(config.error ?? targets.error)}
        action={
          <Button
            onClick={() => {
              void config.refetch();
              void targets.refetch();
            }}
          >
            重新加载
          </Button>
        }
      />
    );
  const rules =
    view === "published" ? config.data.publishedRules : config.data.rules;
  const pending =
    JSON.stringify(config.data.rules) !==
    JSON.stringify(config.data.publishedRules);
  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <h2>跨表关联与自动化</h2>
          <p className={styles.caption}>
            配置一次，员工按流程创建并关联业务记录
          </p>
        </div>
        <Link href={`/workspace/${tenantCode}/settings/relationships`}>
          <LinkOutlined /> 关系总览
        </Link>
      </div>
      <Alert
        type={archived || pending ? "warning" : "info"}
        showIcon
        title={
          archived
            ? "业务表已停用，恢复后才能配置和执行"
            : pending
              ? "有待发布的规则修改"
              : "当前草稿与生效规则一致"
        }
        description={
          pending
            ? (notice ?? "保存规则后，使用页面上方的发布操作使其生效")
            : "当前显示的规则已发布"
        }
      />
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button onClick={() => void config.refetch()}>刷新配置</Button>
          }
        />
      )}
      <div className={styles.heading}>
        <Segmented
          aria-label="规则版本"
          value={view}
          onChange={setView}
          options={[
            { label: "待发布草稿", value: "draft" },
            { label: "当前生效", value: "published" },
          ]}
        />
        <Button
          icon={<PlusOutlined />}
          disabled={
            archived || !targets.data.length || saving || view !== "draft"
          }
          onClick={() =>
            setEditing({
              key: `rule-${crypto.randomUUID()}`,
              label: "",
              enabled: true,
              allowedRoles: ["TENANT_ADMIN", "EMPLOYEE"],
              trigger: { type: "MANUAL" },
              targetObjectCode: "",
              owner: "SOURCE_OWNER",
              mappings: {},
            })
          }
        >
          新建规则
        </Button>
      </div>
      {!targets.data.length && (
        <p className={styles.caption}>
          请先创建并发布另一张业务表，作为新记录的目标
        </p>
      )}
      <RelationshipMap
        nodes={[source, ...targets.data]}
        edges={rules.map((rule) => ({
          id: rule.key,
          source: source.code,
          target: rule.targetObjectCode,
          label: rule.label,
          trigger: rule.trigger.type === "MANUAL" ? "手动确认" : "字段变化",
          enabled: rule.enabled,
        }))}
        onSelect={(key) => {
          setEditing(rules.find((rule) => rule.key === key));
        }}
      />
      <div className={styles.ruleList}>
        {rules.map((rule) => (
          <div key={rule.key} className={styles.ruleRow}>
            <div>
              <strong>
                {rule.label} {!rule.enabled && <Tag>已关闭</Tag>}
              </strong>
              <p className={styles.caption}>
                {rule.trigger.type === "MANUAL"
                  ? "确认后创建"
                  : "字段首次进入条件时创建"}{" "}
                ·{" "}
                {targets.data.find(
                  (table) => table.code === rule.targetObjectCode,
                )?.name ?? rule.targetObjectCode}
              </p>
            </div>
            {view === "draft" && (
              <Space>
                <Button
                  icon={<EditOutlined />}
                  disabled={archived || saving}
                  onClick={() => setEditing(rule)}
                >
                  配置
                </Button>
                <Popconfirm
                  title="从草稿移除此规则？"
                  description="发布后停止执行，已经创建的记录和关联会保留"
                  onConfirm={() =>
                    save(
                      config.data.rules.filter((item) => item.key !== rule.key),
                    )
                  }
                >
                  <Button danger type="text" disabled={archived || saving}>
                    移除
                  </Button>
                </Popconfirm>
              </Space>
            )}
          </div>
        ))}
      </div>
      {members.isError && (
        <Alert
          type="error"
          title="成员选项加载失败"
          action={<Button onClick={() => void members.refetch()}>重试</Button>}
        />
      )}
      <Drawer
        open={!!editing}
        title={
          view === "published" || archived ? "查看生效规则" : "配置跨表规则"
        }
        size={1040}
        onClose={() => {
          if (!saving) setEditing(undefined);
        }}
        destroyOnHidden
        mask={{ closable: !saving }}
        closable={!saving}
        keyboard={!saving}
      >
        {editing && (
          <AutomationRuleEditor
            key={editing.key}
            initial={editing}
            source={source}
            targets={targets.data}
            saving={saving}
            members={members.data}
            readOnly={view === "published" || archived}
            onCancel={() => setEditing(undefined)}
            onSave={(rule) =>
              void save(
                config.data.rules.some((item) => item.key === rule.key)
                  ? config.data.rules.map((item) =>
                      item.key === rule.key ? rule : item,
                    )
                  : [...config.data.rules, rule],
              )
            }
            preview={
              view === "published" || archived
                ? undefined
                : (rule) => (
                    <DraftAutomationPreview
                      tenantCode={tenantCode}
                      members={members.data}
                      objectId={draft.object.id}
                      sourceCode={source.code}
                      published={draft.object.publicationNumber !== null}
                      rule={rule}
                      target={targets.data.find(
                        (table) => table.code === rule.targetObjectCode,
                      )}
                    />
                  )
            }
          />
        )}
      </Drawer>
    </section>
  );
}
