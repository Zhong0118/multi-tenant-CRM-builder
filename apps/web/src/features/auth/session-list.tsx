"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import type { components } from "@crm/contracts";
import { Alert, Button, Card, Form, Input, Popconfirm, Tag } from "antd";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import styles from "./auth.module.css";
import { normalizeFormError } from "./form-support";
import { passwordSchema } from "./schemas";

type Schemas = components["schemas"];

export type SecuritySession = Schemas["SessionResponseDto"];

export interface SecurityApi {
  revokeSession(sessionId: string): Promise<Schemas["AcceptedResponseDto"]>;
  changePassword(
    input: Schemas["ChangePasswordDto"],
  ): Promise<Schemas["AcceptedResponseDto"]>;
}

const securityApi: SecurityApi = {
  async revokeSession(sessionId) {
    const result = await browserApiClient.DELETE(
      "/api/v1/me/sessions/{sessionId}",
      { params: { path: { sessionId } } },
    );
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
  async changePassword(body) {
    const result = await browserApiClient.PATCH("/api/v1/me/password", {
      body,
    });
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
};

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码。"),
  newPassword: passwordSchema,
});

type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

function formatDate(value?: string) {
  if (!value) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SessionList({
  initialSessions,
  api = securityApi,
}: {
  initialSessions: SecuritySession[];
  api?: SecurityApi;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [summary, setSummary] = useState<{
    type: "error" | "success";
    text: string;
  }>();
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => api.revokeSession(sessionId),
    onSuccess: (_result, sessionId) => {
      setSessions((current) =>
        current.filter((session) => session.id !== sessionId),
      );
      setSummary({ type: "success", text: "会话已撤销。" });
    },
    onError: (error) => {
      const apiError = normalizeFormError(error);
      setSummary({
        type: "error",
        text: `${apiError.message}（请求编号：${apiError.requestId}）`,
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (input: ChangePasswordInput) => api.changePassword(input),
    onSuccess: () => {
      setSessions((current) => current.filter((session) => session.isCurrent));
      reset();
      setSummary({
        type: "success",
        text: "密码已更新，其他设备的会话已撤销。",
      });
    },
    onError: (error) => {
      const apiError = normalizeFormError(error);
      setSummary({
        type: "error",
        text: `${apiError.message}（请求编号：${apiError.requestId}）`,
      });
    },
  });

  return (
    <div className={styles.securityGrid}>
      {summary && (
        <Alert
          className={styles.securityAlert}
          type={summary.type}
          showIcon
          title={summary.text}
        />
      )}

      <Card className={styles.securityCard} title="登录设备与会话">
        <div className={styles.sessionList}>
          {sessions.map((session) => (
            <article className={styles.sessionRow} key={session.id}>
              <div>
                <div className={styles.sessionTitle}>
                  <strong>{session.deviceSummary || "未知设备"}</strong>
                  {session.isCurrent && <Tag color="cyan">当前会话</Tag>}
                  {session.revokedAt && <Tag>已撤销</Tag>}
                </div>
                <dl className={styles.sessionMeta}>
                  <div>
                    <dt>IP</dt>
                    <dd>{session.ipSummary || "未记录"}</dd>
                  </div>
                  <div>
                    <dt>最近使用</dt>
                    <dd>
                      {formatDate(session.lastUsedAt ?? session.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>到期时间</dt>
                    <dd>{formatDate(session.expiresAt)}</dd>
                  </div>
                </dl>
              </div>
              {!session.isCurrent && !session.revokedAt && (
                <Popconfirm
                  title="撤销这个会话？"
                  description="该设备需要重新登录。"
                  okText="确认撤销"
                  cancelText="取消"
                  onConfirm={() => revokeMutation.mutate(session.id)}
                >
                  <Button
                    danger
                    loading={
                      revokeMutation.isPending &&
                      revokeMutation.variables === session.id
                    }
                  >
                    撤销
                  </Button>
                </Popconfirm>
              )}
            </article>
          ))}
        </div>
      </Card>

      <Card className={styles.securityCard} title="修改密码">
        <p className={styles.securityHint}>
          更新后保留当前会话，其他设备将自动退出。
        </p>
        <form
          className={styles.authForm}
          onSubmit={handleSubmit((values) => {
            setSummary(undefined);
            passwordMutation.mutate(values);
          })}
          noValidate
        >
          <Form.Item
            label="当前密码"
            htmlFor="security-current-password"
            validateStatus={errors.currentPassword ? "error" : undefined}
            help={errors.currentPassword?.message}
          >
            <Controller
              name="currentPassword"
              control={control}
              render={({ field }) => (
                <Input.Password
                  id="security-current-password"
                  autoComplete="current-password"
                  {...field}
                />
              )}
            />
          </Form.Item>
          <Form.Item
            label="新密码"
            htmlFor="security-new-password"
            validateStatus={errors.newPassword ? "error" : undefined}
            help={errors.newPassword?.message}
            extra="10–72 位，同时包含字母和数字。"
          >
            <Controller
              name="newPassword"
              control={control}
              render={({ field }) => (
                <Input.Password
                  id="security-new-password"
                  autoComplete="new-password"
                  {...field}
                />
              )}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={passwordMutation.isPending}
          >
            更新密码
          </Button>
        </form>
      </Card>
    </div>
  );
}
