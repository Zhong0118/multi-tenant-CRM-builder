"use client";
import { useState } from "react";
import { Alert, Button, Space, Table, Typography } from "antd";
import { PageSection } from "@/components/layout/page";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";
import { normalizeFormError } from "@/features/auth/form-support";
import { useRouter } from "next/navigation";
type Count = { kind: string; status: string; count: number };
const titles: Record<string, string> = {
  code_bind: "绑定验证",
  code_change: "换绑验证",
  code_reverify: "重新验证",
  code_reset: "邮箱找回",
  password_changed: "密码已修改",
  password_reset: "密码已重置",
  email_changed: "邮箱已更换",
  email_removed: "邮箱已解绑",
  new_device: "新设备登录",
  test: "平台测试",
};
export function PlatformMail({
  ready,
  verified,
  items,
}: {
  ready: boolean;
  verified: boolean;
  items: Count[] | null;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<{
      type: "success" | "warning" | "error";
      text: string;
    }>();
  async function test() {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await dataOrThrow(
        await browserApiClient.POST("/api/v1/platform/mail/test"),
      );
      setNotice(
        result.status === "sent"
          ? {
              type: "success",
              text: "邮件服务已接收测试邮件，请查看你的收件箱",
            }
          : result.status === "unknown"
            ? { type: "warning", text: "投递结果未知，请检查收件箱" }
            : { type: "error", text: "测试邮件发送失败，请检查发信配置" },
      );
      router.refresh();
    } catch (e) {
      setNotice({ type: "error", text: normalizeFormError(e).message });
    } finally {
      setBusy(false);
    }
  }
  const counts = new Map<
    string,
    { kind: string; sent: number; failed: number; unknown: number }
  >();
  for (const item of items ?? []) {
    if (!["sent", "failed", "unknown"].includes(item.status)) continue;
    const row = counts.get(item.kind) ?? {
      kind: item.kind,
      sent: 0,
      failed: 0,
      unknown: 0,
    };
    row[item.status as "sent" | "failed" | "unknown"] += item.count;
    counts.set(item.kind, row);
  }
  return (
    <PageSection
      title="邮件发送"
      description="最近 7 天的投递结果"
      extra={
        ready && (
          <Button
            onClick={() => void test()}
            loading={busy}
            disabled={!verified}
          >
            发送测试邮件
          </Button>
        )
      }
    >
      <Space orientation="vertical" style={{ width: "100%" }}>
        {ready && !verified && (
          <Typography.Text type="secondary">
            请先在账号安全中验证自己的邮箱，再发送测试邮件
          </Typography.Text>
        )}
        {notice && <Alert showIcon type={notice.type} title={notice.text} />}
        {items === null ? (
          <Alert type="warning" title="发送统计暂时无法读取" />
        ) : counts.size === 0 ? (
          <Typography.Text type="secondary">
            最近 7 天还没有邮件发送记录
          </Typography.Text>
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="kind"
            dataSource={[...counts.values()]}
            columns={[
              {
                title: "类别",
                dataIndex: "kind",
                render: (kind: string) => titles[kind] ?? "其他邮件",
              },
              { title: "成功", dataIndex: "sent" },
              { title: "失败", dataIndex: "failed" },
              { title: "结果未知", dataIndex: "unknown" },
            ]}
          />
        )}
      </Space>
    </PageSection>
  );
}
