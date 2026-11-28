"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Skeleton,
  Space,
} from "antd";
import { useState } from "react";

import { useToast } from "@/components/feedback/use-toast";
import { PageSection, SettingRow } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { StatusTag, type StatusTone } from "@/components/workbench/status-tag";
import { ReadingPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { toApiError } from "@/lib/api/api-error";

import {
  LINE_KEY,
  MONEY,
  platformTelephonyApi,
  RATE,
  usePlatformLine,
  type PlatformLine,
} from "./platform-telephony-api";
import styles from "./platform-telephony.module.css";

/** Where the platform line stands, in two or three words. */
export function lineState(line: Pick<PlatformLine, "mode" | "ready">): {
  label: string;
  tone: StatusTone;
} {
  if (!line.ready) return { label: "未就绪", tone: "warning" };
  return line.mode === "MOCK"
    ? { label: "模拟线路", tone: "info" }
    : { label: "快马回拨", tone: "success" };
}

/** The line's row on 系统设置, linking to its own page. */
export function PlatformTelephonySummary() {
  const line = usePlatformLine();
  const data = line.data;
  return (
    <PageSection title="电话线路">
      <ReadingPanel className={styles.panel}>
        {data ? (
          <SettingRow
            label="线路状态"
            help={data.problems[0] ?? `已建坐席 ${data.seats} 个`}
          >
            <Space wrap>
              <StatusTag tone={lineState(data).tone}>
                {lineState(data).label}
              </StatusTag>
              <Button href="/platform/settings/telephony">管理电话线路</Button>
            </Space>
          </SettingRow>
        ) : line.isError ? (
          <LoadError error={line.error} retry={() => void line.refetch()} />
        ) : (
          <Skeleton active paragraph={{ rows: 1 }} title={false} />
        )}
      </ReadingPanel>
    </PageSection>
  );
}

type LineForm = {
  mode: "MOCK" | "KUAIMA";
  companyId: string;
  appSecret: string;
  costPerMinute: string;
  seatMonthlyCost: string;
};

/**
 * The platform's one supplier line: account, buying prices and the callback
 * address every company's calls report back to.
 */
export function PlatformTelephonyLine() {
  const line = usePlatformLine();
  const client = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string>();
  const fail = (cause: unknown) => {
    const apiError = toApiError(cause);
    setError(
      apiError.status === 409
        ? "线路设置刚被修改，已刷新为最新内容，请再试一次。"
        : apiError.message,
    );
    if (apiError.status === 409) void line.refetch();
  };
  const save = useMutation({
    mutationFn: (values: LineForm) =>
      platformTelephonyApi.updateLine({
        version: line.data?.version ?? 0,
        mode: values.mode,
        companyId: values.companyId.trim(),
        // A blank secret keeps the saved one.
        ...(values.appSecret.trim()
          ? { appSecret: values.appSecret.trim() }
          : {}),
        costPerMinute: values.costPerMinute,
        seatMonthlyCost: values.seatMonthlyCost,
      }),
    onMutate: () => setError(undefined),
    onSuccess: (saved) => {
      client.setQueryData(LINE_KEY, saved);
      toast.success("线路已保存");
    },
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: () => platformTelephonyApi.rotateCallbackToken(),
    onMutate: () => setError(undefined),
    onSuccess: (issued) => {
      client.setQueryData(LINE_KEY, issued.settings);
      setConfirming(false);
      setCallbackUrl(issued.callbackUrl);
    },
    onError: (cause) => {
      setConfirming(false);
      fail(cause);
    },
  });

  const data = line.data;
  if (!data)
    return (
      <div className={styles.page}>
        <PageHeader title="电话线路" />
        {line.isError ? (
          <LoadError error={line.error} retry={() => void line.refetch()} />
        ) : (
          <Skeleton active />
        )}
      </div>
    );
  const state = lineState(data);
  return (
    <div className={styles.page}>
      <PageHeader
        title="电话线路"
        description="所有公司共用这一条线路拨号。"
        status={<StatusTag tone={state.tone}>{state.label}</StatusTag>}
      />
      {data.problems.length ? (
        <Alert
          type="warning"
          showIcon
          title="线路暂不可用，各公司员工都不能拨号"
          description={
            <ul className={styles.problems}>
              {data.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          closable
          title={error}
          onClose={() => setError(undefined)}
        />
      ) : null}
      <PageSection title="账号和进价">
        <ReadingPanel className={styles.panel}>
          <Form<LineForm>
            key={data.version}
            layout="vertical"
            requiredMark={false}
            initialValues={{
              mode: data.mode,
              companyId: data.companyId,
              appSecret: "",
              costPerMinute: data.costPerMinute,
              seatMonthlyCost: data.seatMonthlyCost,
            }}
            onFinish={(values) => save.mutate(values)}
          >
            <Form.Item label="线路" name="mode">
              <Segmented
                options={[
                  { value: "MOCK", label: "模拟", disabled: !data.mockAllowed },
                  { value: "KUAIMA", label: "快马回拨" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="快马企业 ID"
              name="companyId"
              rules={[{ max: 100, message: "最多 100 个字符" }]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="快马企业密钥"
              name="appSecret"
              extra={
                data.hasAppSecret
                  ? "已保存。不修改请留空。"
                  : "加密保存，保存后谁都看不到原文。"
              }
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <div className={styles.pair}>
              <Form.Item
                label="每分钟进价（元）"
                name="costPerMinute"
                rules={[{ pattern: RATE, message: "请输入金额，最多四位小数" }]}
              >
                <Input inputMode="decimal" />
              </Form.Item>
              <Form.Item
                label="每坐席每月进价（元）"
                name="seatMonthlyCost"
                rules={[
                  { pattern: MONEY, message: "请输入金额，最多两位小数" },
                ]}
              >
                <Input inputMode="decimal" />
              </Form.Item>
            </div>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存
            </Button>
          </Form>
        </ReadingPanel>
      </PageSection>
      <PageSection title="回调和状态">
        <ReadingPanel className={styles.panel}>
          <SettingRow label="回调地址" help={data.callbackEndpoint}>
            <Space wrap>
              <StatusTag tone={data.hasCallbackToken ? "success" : "neutral"}>
                {data.hasCallbackToken ? "已生成" : "未生成"}
              </StatusTag>
              <Button
                loading={rotate.isPending && !confirming}
                onClick={() =>
                  data.hasCallbackToken ? setConfirming(true) : rotate.mutate()
                }
              >
                {data.hasCallbackToken ? "重新生成" : "生成"}
              </Button>
            </Space>
          </SettingRow>
          <SettingRow
            label="真实外呼"
            help="由部署配置 TELEPHONY_LIVE_ENABLED 控制。关闭时不拨真实电话，也不建真实坐席。"
          >
            <StatusTag tone={data.liveEnabled ? "success" : "warning"}>
              {data.liveEnabled ? "服务器已开启" : "服务器未开启"}
            </StatusTag>
          </SettingRow>
          <SettingRow label="已建坐席">{`${data.seats} 个`}</SettingRow>
        </ReadingPanel>
      </PageSection>
      <Modal
        open={confirming}
        title="重新生成回调地址？"
        okText="重新生成"
        cancelText="取消"
        confirmLoading={rotate.isPending}
        onOk={() => rotate.mutate()}
        onCancel={() => setConfirming(false)}
      >
        旧地址立即失效，需要把新地址发给快马客服重新配置。
      </Modal>
      <Modal
        open={Boolean(callbackUrl)}
        title="回调地址"
        maskClosable={false}
        onCancel={() => setCallbackUrl(undefined)}
        footer={
          <Button type="primary" onClick={() => setCallbackUrl(undefined)}>
            我已复制
          </Button>
        }
      >
        <p className={styles.detail}>
          只显示这一次。复制后发给快马客服，配置为话单推送地址。
        </p>
        <Input.TextArea
          aria-label="回调地址"
          readOnly
          autoSize
          value={callbackUrl}
          className={styles.url}
          onFocus={(event) => event.target.select()}
        />
        <Button
          className={styles.copy}
          size="small"
          onClick={() =>
            callbackUrl &&
            void navigator.clipboard
              .writeText(callbackUrl)
              .then(() => toast.success("已复制"))
          }
        >
          复制
        </Button>
      </Modal>
    </div>
  );
}
