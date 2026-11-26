"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Modal, Skeleton, Space } from "antd";
import {
  ApiOutlined,
  CameraOutlined,
  DatabaseOutlined,
  EditOutlined,
  EllipsisOutlined,
  FontSizeOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { PageSection } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { ReadingPanel } from "@/components/workbench/surface";
import { StatePanel } from "@/components/workbench/state-panel";
import { useSettings } from "../ai-governance/common";
import { AssignmentDialog } from "./assignment-dialog";
import { ProviderEditor } from "./provider-editor";
import { CheckResults } from "./check-results";
import {
  checkError,
  connectionPath,
  currentSource,
  editable,
  errorMessage,
  lastTest,
  modelRequest,
  purposeNames,
  purposes,
  type Check,
  type Overview,
  type Provider,
  type Purpose,
  type Saved,
} from "./model-data";
import styles from "./models.module.css";

const icons = {
  text: FontSizeOutlined,
  vision: CameraOutlined,
  embedding: DatabaseOutlined,
};
type Editor =
  | { kind: "provider"; id?: string; importing?: boolean; step?: number }
  | {
      kind: "assignment";
      purpose: Purpose;
      testOnly?: boolean;
      provider?: string;
      model?: string;
    }
  | { kind: "details"; check: Check }
  | { kind: "delete"; provider: Provider };
export function PlatformModelSettings() {
  const client = useQueryClient(),
    settings = useSettings();
  const q = useQuery({
    queryKey: ["platform-ai", "models"],
    queryFn: ({ signal }) =>
      modelRequest<Overview>("", "GET", undefined, signal),
  });
  const data = q.data;
  const [editor, setEditor] = useState<Editor | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const catalog = settings.data?.catalog;
  const requirements = (catalog ?? []).flatMap((f) =>
    f.purpose === "text" && f.outputLimit != null
      ? [{ name: f.label, tokens: f.outputLimit }]
      : [],
  );
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["platform-ai"] });
  };
  const close = () => {
    setEditor(null);
    setError("");
    refresh();
  };
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function importEnvironment() {
    await action(async () => {
      const result = await modelRequest<Saved>(
        "/import-environment",
        "POST",
        {},
      );
      const latest = await q.refetch({ throwOnError: true });
      if (!latest.data?.providers.some((p) => p.id === result.id))
        throw new Error("未读取到转换后的连接，请重试");
      setEditor({ kind: "provider", id: result.id, importing: true, step: 2 });
    });
  }
  const selectedProvider =
    editor?.kind === "provider" && editor.id
      ? data?.providers.find((p) => p.id === editor.id)
      : undefined;
  return (
    <div className={styles.page}>
      <PageHeader
        title="AI 模型"
        description="管理所有公司的模型连接与用途分配"
      />
      {!data || !catalog || q.error || settings.error ? (
        q.error || settings.error ? (
          <StatePanel
            title="无法读取模型设置"
            tone="error"
            description={errorMessage(q.error || settings.error)}
            action={
              <Button
                onClick={() => {
                  void q.refetch();
                  void settings.refetch();
                }}
              >
                重试
              </Button>
            }
          />
        ) : (
          <Skeleton active paragraph={{ rows: 5 }} />
        )
      ) : (
        <>
          <PageSection title="用途分配">
            <ReadingPanel className={styles.panel}>
              {purposes.map((purpose) => {
                const a = data.assignments.find((a) => a.purpose === purpose),
                  p = a && data.providers.find((p) => p.id === a.providerId);
                const check = lastTest(
                  p?.revisions.find((r) => r.id === a?.revisionId),
                  purpose,
                  a?.model,
                );
                const fromEnv =
                  !a && purpose === "text" && data.environment.configured;
                const Icon = icons[purpose];
                const state = a
                  ? [
                      check?.status === "failed" ? "测试失败" : "正常",
                      a.dimensions != null ? a.dimensions + " 维" : null,
                      check?.durationMs != null
                        ? check.durationMs + " ms"
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : fromEnv
                    ? "来自环境变量"
                    : null;
                return (
                  <div className={styles.row} key={purpose}>
                    <span className={styles.icon}>
                      <Icon />
                    </span>
                    <div className={styles.copy}>
                      <strong>{purposeNames[purpose]}</strong>
                      {/* Vision and embeddings are optional: unset reads as
                          a choice, not a fault. */}
                      {!a && !fromEnv && purpose !== "text" ? (
                        <span data-optional>可选，尚未配置</span>
                      ) : (
                        <span>{currentSource(data, purpose)}</span>
                      )}
                      {purpose === "text" &&
                        !a &&
                        !!data.environment.missing.length && (
                          <small>
                            缺少 {data.environment.missing.join("、")}
                          </small>
                        )}
                    </div>
                    {state && (
                      <span
                        className={styles.status}
                        data-tone={
                          check?.status === "failed"
                            ? "error"
                            : fromEnv
                              ? "info"
                              : "success"
                        }
                      >
                        {state}
                      </span>
                    )}
                    <Space wrap className={styles.actions}>
                      {fromEnv && (
                        <Button loading={busy} onClick={importEnvironment}>
                          转为平台配置
                        </Button>
                      )}
                      {a && (
                        <Button
                          aria-label={"测试" + purposeNames[purpose]}
                          onClick={() =>
                            setEditor({
                              kind: "assignment",
                              purpose,
                              testOnly: true,
                              provider: a.providerId,
                              model: a.model,
                            })
                          }
                        >
                          测试
                        </Button>
                      )}
                      <Button
                        aria-label={"更换" + purposeNames[purpose]}
                        onClick={() =>
                          setEditor({ kind: "assignment", purpose })
                        }
                      >
                        {a || fromEnv ? "更换" : "选择模型"}
                      </Button>
                    </Space>
                  </div>
                );
              })}
            </ReadingPanel>
          </PageSection>
          <PageSection
            title="供应商"
            extra={
              <Button
                type="primary"
                icon={<PlusOutlined />}
                aria-label="添加供应商"
                onClick={() => setEditor({ kind: "provider" })}
              >
                添加供应商
              </Button>
            }
          >
            <ReadingPanel className={styles.panel}>
              {data.providers.length === 0 && (
                <StatePanel
                  title="尚未添加供应商"
                  description="添加供应商并完成测试后，可为所有公司分配模型。"
                />
              )}
              {data.providers.map((p) => {
                const revision = editable(p),
                  check = lastTest(revision);
                const state = !p.enabled
                  ? "已停用"
                  : p.activeRevisionId && p.draftRevisionId
                    ? "修改未生效"
                    : check?.status === "failed"
                      ? "测试失败"
                      : p.draftRevisionId || !p.activeRevisionId
                        ? "修改未生效"
                        : "正常";
                const used = data.assignments.filter(
                  (a) => a.providerId === p.id,
                );
                return (
                  <div className={styles.provider} key={p.id}>
                    <div className={styles.row}>
                      <span className={styles.icon}>
                        <ApiOutlined />
                      </span>
                      <div className={styles.copy}>
                        <strong>{p.name}</strong>
                        <span>
                          {revision?.protocol === "responses"
                            ? "Responses"
                            : "Chat"}
                          {revision?.embeddings ? " · Embeddings" : ""} ·{" "}
                          {revision?.models.length ?? 0} 个模型
                        </span>
                        <small>
                          {revision?.keyLast4
                            ? "Key 末四位 · " + revision.keyLast4
                            : "未设置 Key"}
                          {used.length > 0
                            ? " · 用于" +
                              used
                                .map((a) => purposeNames[a.purpose].slice(0, 2))
                                .join("、")
                            : ""}
                          {check?.finishedAt && (
                            <>
                              {" "}
                              · 最近测试{" "}
                              <time dateTime={check.finishedAt}>
                                {new Date(check.finishedAt).toLocaleString(
                                  "zh-CN",
                                  {
                                    month: "numeric",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: false,
                                    timeZone: "Asia/Shanghai",
                                  },
                                )}
                              </time>
                            </>
                          )}
                        </small>
                      </div>
                      {/* Same dot-and-text status as the purpose rows above. */}
                      <span
                        className={styles.status}
                        data-tone={
                          state === "正常"
                            ? "success"
                            : state === "测试失败"
                              ? "error"
                              : state === "修改未生效"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {state}
                      </span>
                      <Space wrap className={styles.actions}>
                        {check && (
                          <Button
                            size="small"
                            type="link"
                            onClick={() =>
                              setEditor({ kind: "details", check })
                            }
                          >
                            查看步骤
                          </Button>
                        )}
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() =>
                            setEditor({ kind: "provider", id: p.id })
                          }
                        >
                          编辑
                        </Button>
                        <Dropdown
                          trigger={["click"]}
                          menu={{
                            items: [
                              {
                                key: "test",
                                label: "测试连接",
                                disabled: !p.enabled,
                              },
                              { key: "key", label: "更换 Key" },
                              {
                                key: "toggle",
                                label: p.enabled ? "停用" : "启用",
                                disabled: !!used.length || busy,
                              },
                              {
                                key: "delete",
                                label: "删除供应商",
                                danger: true,
                                disabled: !!used.length || busy,
                              },
                            ],
                            onClick: ({ key }) => {
                              if (key === "test" || key === "key")
                                setEditor({
                                  kind: "provider",
                                  id: p.id,
                                  step: key === "test" ? 2 : 1,
                                });
                              if (key === "delete")
                                setEditor({ kind: "delete", provider: p });
                              if (key === "toggle")
                                void action(async () => {
                                  await modelRequest(
                                    connectionPath(p.id) + "/status",
                                    "POST",
                                    { version: p.version, enabled: !p.enabled },
                                  );
                                });
                            },
                          }}
                        >
                          <Button
                            size="small"
                            aria-label={p.name + "更多操作"}
                            icon={<EllipsisOutlined />}
                          />
                        </Dropdown>
                      </Space>
                    </div>
                    {p.enabled && check?.status === "failed" && (
                      <p className={styles.note}>
                        {p.activeRevisionId && p.draftRevisionId
                          ? "修改未生效 · "
                          : ""}
                        测试失败
                        {check?.errorCode
                          ? " · " + checkError(check.errorCode)
                          : ""}
                      </p>
                    )}
                    {p.activeRevisionId &&
                      p.draftRevisionId &&
                      used.length > 0 && (
                        <p className={styles.note}>
                          当前仍在使用上一次测试通过的配置
                        </p>
                      )}
                  </div>
                );
              })}
            </ReadingPanel>
          </PageSection>
          {editor?.kind === "assignment" && (
            <AssignmentDialog
              data={data}
              requirements={requirements}
              purpose={editor.purpose}
              initialProvider={editor.provider}
              initialModel={editor.model}
              testOnly={editor.testOnly}
              onClose={close}
              refresh={refresh}
            />
          )}
          {editor?.kind === "provider" && (
            <ProviderEditor
              data={data}
              requirements={requirements}
              provider={selectedProvider}
              startStep={editor.step}
              importing={editor.importing}
              onClose={close}
            />
          )}
          {editor?.kind === "details" && (
            <Modal
              open
              title="连接测试结果"
              footer={<Button onClick={close}>关闭</Button>}
              onCancel={close}
            >
              <CheckResults check={editor.check} />
            </Modal>
          )}
          {editor?.kind === "delete" && (
            <Modal
              open
              title="删除供应商"
              cancelText="取消"
              okText="确认删除"
              confirmLoading={busy}
              okButtonProps={{ danger: true }}
              onCancel={() => {
                if (!busy) close();
              }}
              onOk={() =>
                action(async () => {
                  await modelRequest(
                    connectionPath(editor.provider.id),
                    "DELETE",
                    { version: editor.provider.version },
                  );
                  close();
                })
              }
            >
              <p>确认删除「{editor.provider.name}」的连接？</p>
              {error && <Alert type="error" title={error} />}
            </Modal>
          )}
        </>
      )}
      {error && editor?.kind !== "delete" && (
        <Alert type="error" showIcon title={error} />
      )}
    </div>
  );
}
