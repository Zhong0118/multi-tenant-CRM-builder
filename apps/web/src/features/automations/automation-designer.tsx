"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Modal,
  Empty,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tag,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  LinkOutlined,
  ArrowRightOutlined,
  TableOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserApiClient } from "@/lib/api/browser-client";
import type { DynamicFieldMember } from "@/features/records/dynamic-field";
import { objectApi, type ObjectApi } from "@/features/objects/object-api";
import type { ObjectDraft } from "@/features/objects/object-types";
import { automationApi, type AutomationApi } from "./automation-api";
import {
  automationTriggerLabel,
  type AutomationRule,
  type AutomationTable,
} from "./automation-types";
import { AutomationRuleEditor } from "./automation-rule-editor";
import { AutomationStatistics } from "./automation-statistics";
import { automationError, DraftAutomationPreview } from "./automation-preview";
import { ruleResult } from "./relationship-overview";
import styles from "./automations.module.css";

export function AutomationDesigner({
  tenantCode,
  draft,
  onObjectVersion,
  onDirtyChange,
  api = automationApi,
  objects = objectApi,
}: {
  tenantCode: string;
  draft: ObjectDraft;
  onObjectVersion: (draft: ObjectDraft) => void;
  onDirtyChange?: (dirty: boolean) => void;
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
  const [editorDirty, setEditorDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  function closeEditor() {
    if (saving) return;
    if (editorDirty && view === "draft" && !archived) setConfirmDiscard(true);
    else setEditing(undefined);
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const archived = draft.object.status === "ARCHIVED";
  const dirty =
    Boolean(editing) && editorDirty && view === "draft" && !archived;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
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
      setEditorDirty(false);
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
  const viewSelector = (
    <Segmented
      aria-label="规则版本与统计"
      value={view}
      onChange={setView}
      options={[
        { label: "待发布草稿", value: "draft" },
        { label: "当前生效", value: "published" },
        { label: "执行统计", value: "stats" },
      ]}
    />
  );
  if (view === "stats")
    return (
      <section className={styles.panel}>
        <div className={styles.heading}>
          <h2>跨表关联与自动化</h2>
        </div>
        {viewSelector}
        <AutomationStatistics
          tenantCode={tenantCode}
          objectId={draft.object.id}
          sourceCode={draft.object.code}
          api={api}
        />
      </section>
    );
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
            从当前表新增记录到另一张表，自动带入选定内容，并保留双向关联
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
            : config.data.publishedRules.length
              ? "已发布的规则按以下条件执行"
              : "尚无已发布的跨表规则"
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
        {viewSelector}
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
      <div className={styles.ruleList}>
        {!rules.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              view === "published"
                ? "还没有生效规则，保存草稿并发布后将在这里显示"
                : "先选择执行条件，再设置目标表和带入内容"
            }
          />
        )}
        {rules.map((rule) => (
          <article key={rule.key} className={styles.ruleCard}>
            <div className={styles.heading}>
              <div>
                <strong>
                  {rule.label} {!rule.enabled && <Tag>已关闭</Tag>}
                </strong>
                <p className={styles.caption}>
                  {automationTriggerLabel(rule, source.fields)}
                </p>
              </div>
              <Space>
                <Button
                  icon={<EditOutlined />}
                  disabled={saving}
                  aria-label={`查看规则 ${rule.label}`}
                  onClick={() => {
                    setEditorDirty(false);
                    setEditing(rule);
                  }}
                >
                  {view === "published" || archived ? "查看" : "配置"}
                </Button>
                {view === "draft" && (
                  <Popconfirm
                    title="从草稿移除此规则？"
                    description="发布后停止执行，已经创建的记录和关联会保留"
                    onConfirm={() =>
                      save(
                        config.data.rules.filter(
                          (item) => item.key !== rule.key,
                        ),
                      )
                    }
                  >
                    <Button danger type="text" disabled={archived || saving}>
                      移除
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </div>
            <div className={styles.ruleFlow}>
              <div className={styles.node}>
                <TableOutlined />
                <div>
                  <span>保留来源记录</span>
                  <strong>{source.name}</strong>
                </div>
              </div>
              <ArrowRightOutlined aria-hidden />
              <div className={styles.node}>
                <TableOutlined />
                <div>
                  <span>新增记录并关联</span>
                  <strong>
                    {targets.data.find(
                      (table) => table.code === rule.targetObjectCode,
                    )?.name ?? rule.targetObjectCode}
                  </strong>
                </div>
              </div>
            </div>
            <dl className={styles.ruleFacts}>
              <dt>触发条件</dt>
              <dd>{automationTriggerLabel(rule, source.fields)}</dd>
              <dt>字段对应</dt>
              <dd>{Object.keys(rule.mappings).length} 个字段已配置取值</dd>
              <dt>执行结果</dt>
              <dd>
                {ruleResult(
                  rule,
                  targets.data.find(
                    (table) => table.code === rule.targetObjectCode,
                  )?.name ?? rule.targetObjectCode,
                )}
              </dd>
            </dl>
          </article>
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
        onClose={closeEditor}
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
            onCancel={closeEditor}
            onDirtyChange={setEditorDirty}
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
      <Modal
        title="放弃未保存的规则修改？"
        open={confirmDiscard}
        okText="放弃修改"
        cancelText="继续编辑"
        onCancel={() => setConfirmDiscard(false)}
        onOk={() => {
          setConfirmDiscard(false);
          setEditorDirty(false);
          setEditing(undefined);
        }}
      >
        <p>已发布规则和之前保存的草稿不受影响</p>
      </Modal>
    </section>
  );
}
