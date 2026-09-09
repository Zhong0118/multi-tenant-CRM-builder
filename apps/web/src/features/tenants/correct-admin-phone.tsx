"use client";
import { useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";

export function CorrectAdminPhone({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  return (
    <Form
      layout="vertical"
      onFinish={async ({ phone }: { phone: string }) => {
        setPending(true);
        setError(undefined);
        setDone(false);
        try {
          const result = await browserApiClient.PATCH(
            "/api/v1/platform/tenants/{tenantId}/first-admin-phone",
            {
              params: { path: { tenantId } },
              body: { firstAdminPhone: phone },
            },
          );
          if (!result.data)
            throw toApiError(result.error, result.response.status);
          setDone(true);
          router.refresh();
        } catch (caught) {
          setError(toApiError(caught).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <p>
        更正后，原邀请立即失效。新手机号登录后可接受 7 天内有效的管理员邀请。
      </p>
      <Form.Item
        label="正确的管理员手机号"
        name="phone"
        rules={[
          {
            required: true,
            pattern: /^1[3-9]\d{9}$/,
            message: "请输入 11 位中国大陆手机号",
          },
        ]}
      >
        <Input autoComplete="tel" maxLength={11} />
      </Form.Item>
      <Button htmlType="submit" loading={pending}>
        更正手机号并重新邀请
      </Button>
      {error ? <Alert type="error" title={error} /> : null}
      {done ? (
        <Alert type="success" title="手机号已更正，原邀请已失效。" />
      ) : null}
    </Form>
  );
}
