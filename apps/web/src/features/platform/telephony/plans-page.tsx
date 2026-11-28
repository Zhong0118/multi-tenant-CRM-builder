"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Space,
  Switch,
  Table,
  Tabs,
} from "antd";
import { useState } from "react";

import { useToast } from "@/components/feedback/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import { StatusTag } from "@/components/workbench/status-tag";
import { DataPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { toApiError } from "@/lib/api/api-error";

import {
  MONEY,
  PLATFORM_TELEPHONY_KEY,
  platformTelephonyApi,
  useTelephonyPlans,
  yuan,
  type TelephonyPlan,
  type TelephonyPlanInput,
} from "./platform-telephony-api";
import { TelephonyReportPanel } from "./report";
import styles from "./platform-telephony.module.css";

const NEW_PLAN: TelephonyPlanInput = {
  name: "",
  seats: 5,
  monthlyMinutes: 1000,
  monthlyPrice: "",
  assignable: true,
};
const editable = (plan: TelephonyPlan): TelephonyPlanInput => ({
  name: plan.name,
  seats: plan.seats,
  monthlyMinutes: plan.monthlyMinutes,
  monthlyPrice: plan.monthlyPrice,
  assignable: plan.assignable,
});

/** 通话套餐: the plans the platform sells, and the books on a second tab. */
export function PlatformTelephonyPlans() {
  const plans = useTelephonyPlans();
  const client = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("plans");
  const [editor, setEditor] = useState<TelephonyPlan | "new" | null>(null);
  const [target, setTarget] = useState<TelephonyPlan | null>(null);
  const [error, setError] = useState<string>();
  const [form] = Form.useForm<TelephonyPlanInput>();
  const current = editor && editor !== "new" ? editor : null;
  const done = async (text: string) => {
    toast.success(text);
    await client.invalidateQueries({ queryKey: PLATFORM_TELEPHONY_KEY });
  };
  const fail = (cause: unknown) => setError(toApiError(cause).message);
  const save = useMutation({
    mutationFn: (values: TelephonyPlanInput) => {
      const body = { ...values, name: values.name.trim() };
      return current
        ? platformTelephonyApi.updatePlan(current.id, {
            ...body,
            version: current.version,
          })
        : platformTelephonyApi.createPlan(body);
    },
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      const text = current ? "套餐已更新" : "已新建套餐";
      setEditor(null);
      await done(text);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (plan: TelephonyPlan) =>
      platformTelephonyApi.deletePlan(plan.id, plan.version),
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      setTarget(null);
      await done("套餐已删除");
    },
    onError: fail,
  });
  function open(plan: TelephonyPlan | "new") {
    setError(undefined);
    setEditor(plan);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="通话套餐"
        count={tab === "plans" ? plans.data?.length : undefined}
        extra={
          tab === "plans" ? (
            <Button
              type="primary"
              disabled={!plans.data}
              onClick={() => open("new")}
            >
              新建套餐
            </Button>
          ) : null
        }
      />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "plans",
            label: "套餐",
            children: plans.data ? (
              <DataPanel ariaLabel="通话套餐列表">
                <Table<TelephonyPlan>
                  rowKey="id"
                  className={styles.table}
                  dataSource={plans.data}
                  pagination={false}
                  locale={{
                    emptyText: <Empty description="还没有通话套餐" />,
                  }}
                  columns={[
                    {
                      title: "套餐名称",
                      dataIndex: "name",
                      render: (_, plan) => <strong>{plan.name}</strong>,
                    },
                    { title: "坐席", render: (_, plan) => `${plan.seats} 个` },
                    {
                      title: "每月分钟",
                      render: (_, plan) =>
                        plan.monthlyMinutes.toLocaleString("zh-CN"),
                    },
                    {
                      title: "月售价",
                      align: "right",
                      render: (_, plan) => yuan(plan.monthlyPrice),
                    },
                    {
                      title: "使用公司",
                      render: (_, plan) => `${plan.companies} 家`,
                    },
                    {
                      title: "分配状态",
                      render: (_, plan) => (
                        <StatusTag
                          tone={plan.assignable ? "success" : "neutral"}
                        >
                          {plan.assignable ? "可分配" : "已停止分配"}
                        </StatusTag>
                      ),
                    },
                    {
                      title: "操作",
                      render: (_, plan) => (
                        <Space size="small">
                          <Button
                            size="small"
                            type="link"
                            onClick={() => open(plan)}
                          >
                            编辑
                          </Button>
                          {plan.companies === 0 ? (
                            <Button
                              size="small"
                              type="link"
                              danger
                              onClick={() => {
                                setError(undefined);
                                setTarget(plan);
                              }}
                            >
                              删除
                            </Button>
                          ) : null}
                        </Space>
                      ),
                    },
                  ]}
                />
              </DataPanel>
            ) : plans.isError ? (
              <LoadError
                error={plans.error}
                retry={() => void plans.refetch()}
              />
            ) : (
              <Skeleton active />
            ),
          },
          { key: "report", label: "收支", children: <TelephonyReportPanel /> },
        ]}
      />
      <Drawer
        open={Boolean(editor)}
        title={current ? "编辑套餐" : "新建套餐"}
        destroyOnHidden
        onClose={() => {
          if (!save.isPending) setEditor(null);
        }}
        footer={
          <Space>
            <Button disabled={save.isPending} onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button
              type="primary"
              loading={save.isPending}
              onClick={() => form.submit()}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form<TelephonyPlanInput>
          key={current?.id ?? "new"}
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={current ? editable(current) : NEW_PLAN}
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item
            label="套餐名称"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "请填写套餐名称" },
            ]}
          >
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item
            label="坐席数"
            name="seats"
            extra={
              current?.companies
                ? "不能少于使用这个套餐的公司已开的坐席。"
                : undefined
            }
            rules={[{ required: true, message: "请填写坐席数" }]}
          >
            <InputNumber
              min={1}
              max={10000}
              precision={0}
              className={styles.wide}
            />
          </Form.Item>
          <Form.Item
            label="每月分钟"
            name="monthlyMinutes"
            rules={[{ required: true, message: "请填写每月分钟" }]}
          >
            <InputNumber
              min={0}
              max={10_000_000}
              precision={0}
              className={styles.wide}
            />
          </Form.Item>
          <Form.Item
            label="月售价（元）"
            name="monthlyPrice"
            rules={[
              { required: true, message: "请填写月售价" },
              { pattern: MONEY, message: "请输入金额，最多两位小数" },
            ]}
          >
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item
            label="允许分配给公司"
            name="assignable"
            valuePropName="checked"
          >
            <Switch checkedChildren="可分配" unCheckedChildren="停止分配" />
          </Form.Item>
        </Form>
        {current?.companies ? (
          <p className={styles.detail}>
            {current.companies} 家公司正在用这个套餐，保存后立即生效。
          </p>
        ) : null}
        {editor && error ? <Alert type="error" showIcon title={error} /> : null}
      </Drawer>
      <Modal
        open={Boolean(target)}
        title="删除套餐"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={remove.isPending}
        onOk={() => target && remove.mutate(target)}
        onCancel={() => setTarget(null)}
      >
        <p>删除「{target?.name}」？没有公司在用这个套餐。</p>
        {target && error ? <Alert type="error" showIcon title={error} /> : null}
      </Modal>
    </div>
  );
}
