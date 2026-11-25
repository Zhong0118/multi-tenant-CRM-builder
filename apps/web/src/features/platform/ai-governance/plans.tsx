"use client";
import { formatTokens } from "@/features/ai-governance/format";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { PageHeader } from "@/components/layout/page-header";
import { DataPanel } from "@/components/workbench/surface";
import { StatusTag } from "@/components/workbench/status-tag";
import { browserApiClient as api } from "@/lib/api/browser-client";
import {
  type Feature,
  type Plan,
  list,
  ReadState,
  result,
  tokenAmount,
  useAction,
  usePlans,
  useSettings,
  quotaInputValue,
} from "./common";
import {
  catalogGroups,
  catalogLabels,
} from "../../ai-governance/workspace-api";
import styles from "./platform-ai.module.css";
type Edit = {
  name: string;
  description: string;
  features: Feature[];
  quota: string;
  assignable: boolean;
  replacement: string;
};
export function PlatformPlans() {
  const plans = usePlans(),
    settings = useSettings(),
    action = useAction();
  const catalog = settings.data?.catalog ?? [];
  const names = catalogLabels(catalog);
  const [editor, setEditor] = useState<Plan | "new" | null>(null),
    [target, setTarget] = useState<Plan | null>(null);
  const [impact, setImpact] = useState<{
    confirmation: string;
    companies: number;
    removedFeatures: Feature[];
  } | null>(null);
  const [form] = Form.useForm<Edit>();
  const assignable = Form.useWatch("assignable", form);
  const current = editor && editor !== "new" ? editor : null;
  const replace =
    !!current && settings.data?.defaultPlanId === current.id && !assignable;
  function open(p: Plan | "new", stop = false) {
    action.clear();
    setImpact(null);
    setEditor(p);
    form.setFieldsValue(
      p === "new"
        ? {
            name: "",
            description: "",
            features: [],
            quota: "1000",
            assignable: true,
            replacement: "",
          }
        : {
            name: p.name,
            description: p.description,
            features: p.features,
            quota: quotaInputValue(p.monthlyTokens),
            assignable: stop ? false : p.assignable,
            replacement: "",
          },
    );
  }
  const payload = (v: Edit) => ({
    name: v.name.trim(),
    description: v.description.trim(),
    features: v.features,
    monthlyTokens: tokenAmount(v.quota)!,
    assignable: v.assignable,
    ...(replace ? { replacementDefaultPlanId: v.replacement || null } : {}),
  });
  function save(v: Edit) {
    if (current) {
      void action.run(async () =>
        setImpact(
          await result(
            api.POST("/api/v1/platform/ai-plans/{id}/preview", {
              params: { path: { id: current.id } },
              body: payload(v),
            }),
          ),
        ),
      );
    } else
      void action.run(async () => {
        await result(
          api.POST("/api/v1/platform/ai-plans", { body: payload(v) }),
        );
        setEditor(null);
      }, "已新建套餐");
  }
  return (
    <div className={styles.page}>
      <PageHeader
        title="AI 套餐"
        count={plans.data?.length}
        description="管理可分配给公司的功能与每月额度"
        extra={
          <Button
            type="primary"
            onClick={() => open("new")}
            disabled={!plans.data || !settings.data}
          >
            新建套餐
          </Button>
        }
      />
      {!plans.data || !settings.data ? (
        <ReadState
          error={plans.error || settings.error}
          retry={() => {
            void plans.refetch();
            void settings.refetch();
          }}
        />
      ) : (
        <DataPanel ariaLabel="AI 套餐列表">
          <Table<Plan>
            rowKey="id"
            className={styles.planTable}
            dataSource={plans.data}
            pagination={false}
            locale={{ emptyText: <Empty description="尚未创建 AI 套餐" /> }}
            columns={[
              {
                title: "套餐名称",
                dataIndex: "name",
                render: (_, p) => (
                  <>
                    <strong>{p.name}</strong>
                    {p.description && (
                      <small className={styles.detail}>{p.description}</small>
                    )}
                  </>
                ),
              },
              {
                title: "包含功能",
                width: "36%",
                render: (_, p) => (
                  <Space wrap size={4}>
                    {p.features.length
                      ? p.features.map((f) => <Tag key={f}>{names[f]}</Tag>)
                      : "无"}
                  </Space>
                ),
              },
              {
                title: "月额度",
                render: (_, p) => formatTokens(p.monthlyTokens),
              },
              {
                title: "额度用满估算",
                render: (_, p) =>
                  p.costEstimate ? (
                    <span
                      title={
                        p.costEstimate.weighted
                          ? "按当前套餐公司历史输入和输出占比估算"
                          : "暂无历史用量，显示输入与输出单价区间"
                      }
                    >
                      {p.costEstimate.currency}{" "}
                      {Number(p.costEstimate.low).toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}
                      {p.costEstimate.low !== p.costEstimate.high &&
                        " – " +
                          Number(p.costEstimate.high).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 4 },
                          )}
                    </span>
                  ) : (
                    <span className={styles.muted}>未设置单价</span>
                  ),
              },
              { title: "使用公司", render: (_, p) => p.companies + " 家" },
              {
                title: "分配状态",
                render: (_, p) => (
                  <StatusTag tone={p.assignable ? "success" : "neutral"}>
                    {p.assignable ? "可分配" : "已停止分配"}
                  </StatusTag>
                ),
              },
              {
                title: "操作",
                render: (_, p) => (
                  <Space wrap size="small">
                    <Button size="small" type="link" onClick={() => open(p)}>
                      编辑
                    </Button>
                    {p.assignable && (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => open(p, true)}
                      >
                        停止分配
                      </Button>
                    )}
                    {p.companies === 0 &&
                      p.id !== settings.data?.defaultPlanId && (
                        <Button
                          size="small"
                          type="link"
                          danger
                          onClick={() => {
                            action.clear();
                            setTarget(p);
                          }}
                        >
                          删除
                        </Button>
                      )}
                  </Space>
                ),
              },
            ]}
          />
        </DataPanel>
      )}
      <Drawer
        open={!!editor}
        onClose={() => {
          if (!action.busy) setEditor(null);
        }}
        title={current ? "编辑套餐" : "新建套餐"}
        footer={
          <Space>
            <Button disabled={action.busy} onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button
              type="primary"
              loading={action.busy}
              onClick={() => form.submit()}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            label="套餐名称"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "请填写套餐名称" },
            ]}
          >
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
          <Form.Item
            label="包含的功能"
            name="features"
            rules={[
              {
                validator: (_, v: Feature[]) => {
                  const missing = catalog.find(
                    (f) =>
                      v?.includes(f.key) &&
                      f.requires &&
                      !v.includes(f.requires),
                  );
                  return missing?.requires
                    ? Promise.reject(
                        new Error(
                          missing.label +
                            "需要同时开通" +
                            names[missing.requires],
                        ),
                      )
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Checkbox.Group style={{ display: "grid", gap: 12 }}>
              {catalogGroups(catalog).map((group) => (
                <section key={group} aria-label={group}>
                  <strong>{group}</strong>
                  <div>
                    {catalog
                      .filter((f) => f.group === group)
                      .map((f) => (
                        <Checkbox
                          key={f.key}
                          value={f.key}
                          disabled={!f.released}
                        >
                          {f.label}
                          {!f.released
                            ? " · 即将上线"
                            : !settings.data?.configured
                              ? " · 平台未配置文字模型，开通后公司暂时用不了"
                              : ""}
                        </Checkbox>
                      ))}
                  </div>
                </section>
              ))}
            </Checkbox.Group>
          </Form.Item>
          <Form.Item
            label="每月额度（万 token）"
            name="quota"
            rules={[
              {
                validator: (_, v) =>
                  tokenAmount(v) !== null
                    ? Promise.resolve()
                    : Promise.reject(new Error("请输入有效额度，最多四位小数")),
              },
            ]}
          >
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item
            label="允许分配给新公司"
            name="assignable"
            valuePropName="checked"
          >
            <Switch checkedChildren="可分配" unCheckedChildren="停止分配" />
          </Form.Item>
          {replace && (
            <Form.Item name="replacement" label="新的默认套餐">
              <Select
                options={[
                  { value: "", label: "未开通" },
                  ...(plans.data ?? [])
                    .filter((p) => p.assignable && p.id !== current?.id)
                    .map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Form.Item>
          )}
        </Form>
        {!impact && action.error}
      </Drawer>
      <Modal
        open={!!impact}
        title="确认修改套餐"
        okText="确认修改"
        cancelText="返回编辑"
        confirmLoading={action.busy}
        onCancel={() => setImpact(null)}
        onOk={() => {
          if (!current || !impact) return;
          void action.run(async () => {
            await result(
              api.PATCH("/api/v1/platform/ai-plans/{id}", {
                params: { path: { id: current.id } },
                body: {
                  ...payload(form.getFieldsValue()),
                  confirmation: impact.confirmation,
                },
              }),
            );
            setImpact(null);
            setEditor(null);
          }, "套餐已更新");
        }}
      >
        <p>将影响 {impact?.companies} 家公司，保存后立即生效。</p>
        {!!impact?.removedFeatures.length && (
          <p>
            移除{list(impact.removedFeatures, names)}
            。依赖这些功能的待确认操作将无法确认。
          </p>
        )}
        {!assignable && <p>停止分配后，已使用本套餐的公司可继续使用。</p>}
        {action.error}
      </Modal>
      <Modal
        open={!!target}
        title="删除未使用的套餐"
        okText="删除"
        okButtonProps={{ danger: true }}
        confirmLoading={action.busy}
        onCancel={() => setTarget(null)}
        onOk={() => {
          if (target)
            void action.run(async () => {
              await result(
                api.DELETE("/api/v1/platform/ai-plans/{id}", {
                  params: { path: { id: target.id } },
                  body: { version: target.version },
                }),
              );
              setTarget(null);
            }, "套餐已删除");
        }}
      >
        删除「{target?.name}」？当前使用公司为 0 家。{action.error}
      </Modal>
    </div>
  );
}
