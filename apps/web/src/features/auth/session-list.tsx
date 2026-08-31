"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import type { components } from "@crm/contracts";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Pagination,
  Popconfirm,
  Tabs,
  Tag,
} from "antd";
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
export type SecuritySessionPage = Schemas["SessionPageResponseDto"];

export interface SecurityApi {
  listSessions?(
    kind: "ACTIVE" | "HISTORY",
    page: number,
    limit: number,
  ): Promise<SecuritySessionPage>;
  revokeSession(sessionId: string): Promise<Schemas["AcceptedResponseDto"]>;
  changePassword(
    input: Schemas["ChangePasswordDto"],
  ): Promise<Schemas["AcceptedResponseDto"]>;
}

const securityApi: SecurityApi = {
  async listSessions(kind, page, limit) {
    const result = await browserApiClient.GET("/api/v1/me/sessions", {
      params: { query: { kind, page, limit } },
    });
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
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
  initialActive,
  initialHistory,
  api = securityApi,
}: {
  initialSessions?: SecuritySession[];
  initialActive?: SecuritySessionPage;
  initialHistory?: SecuritySessionPage;
  api?: SecurityApi;
}) {
  const legacySessions = initialSessions ?? [];
  const [sessions, setSessions] = useState(
    initialActive?.items ??
      legacySessions.filter((session) => !session.revokedAt),
  );
  const [history, setHistory] = useState<SecuritySessionPage>(
    initialHistory ?? {
      items: legacySessions.filter((session) => Boolean(session.revokedAt)),
      page: 1,
      limit: 10,
      total: legacySessions.filter((session) => Boolean(session.revokedAt))
        .length,
    },
  );
  const [historyLoading, setHistoryLoading] = useState(false);
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
      setSessions((current) => {
        const revoked = current.find((session) => session.id === sessionId);
        if (revoked) {
          setHistory((page) => ({
            ...page,
            total: page.total + 1,
            items:
              page.page === 1
                ? [
                    { ...revoked, revokedAt: new Date().toISOString() },
                    ...page.items,
                  ].slice(0, page.limit)
                : page.items,
          }));
        }
        return current.filter((session) => session.id !== sessionId);
      });
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

  async function loadHistory(page: number) {
    if (!api.listSessions) return;
    setHistoryLoading(true);
    try {
      setHistory(await api.listSessions("HISTORY", page, history.limit));
    } catch (error) {
      const apiError = normalizeFormError(error);
      setSummary({
        type: "error",
        text: `${apiError.message}（请求编号：${apiError.requestId}）`,
      });
    } finally {
      setHistoryLoading(false);
    }
  }

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

      <Card className={styles.securityCard} title="登录设备与记录">
        <Tabs
          items={[
            {
              key: "active",
              label: `活跃设备 ${sessions.length}`,
              children: (
                <SessionRows
                  sessions={sessions}
                  empty="当前没有活跃设备"
                  revokeMutation={revokeMutation}
                />
              ),
            },
            {
              key: "history",
              label: `登录历史 ${history.total}`,
              children: (
                <>
                  <SessionRows
                    sessions={history.items}
                    empty="近 90 天没有历史记录"
                  />
                  {history.total > history.limit ? (
                    <Pagination
                      className={styles.sessionPagination}
                      current={history.page}
                      pageSize={history.limit}
                      total={history.total}
                      showSizeChanger={false}
                      disabled={historyLoading}
                      onChange={(page) => void loadHistory(page)}
                    />
                  ) : null}
                </>
              ),
            },
          ]}
        />
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

function SessionRows({
  sessions,
  empty,
  revokeMutation,
}: {
  sessions: SecuritySession[];
  empty: string;
  revokeMutation?: {
    mutate(sessionId: string): void;
    isPending: boolean;
    variables?: string;
  };
}) {
  if (!sessions.length)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />;
  return (
    <div className={styles.sessionList}>
      {sessions.map((session) => (
        <article className={styles.sessionRow} key={session.id}>
          <div>
            <div className={styles.sessionTitle}>
              <strong>{session.deviceSummary || "未知设备"}</strong>
              {session.isCurrent && <Tag color="cyan">当前会话</Tag>}
              {session.revokedAt && <Tag>已撤销</Tag>}
              {!session.revokedAt &&
              new Date(session.expiresAt) <= new Date() ? (
                <Tag>已过期</Tag>
              ) : null}
            </div>
            <dl className={styles.sessionMeta}>
              <div>
                <dt>IP</dt>
                <dd>{session.ipSummary || "未记录"}</dd>
              </div>
              <div>
                <dt>最近使用</dt>
                <dd>{formatDate(session.lastUsedAt ?? session.createdAt)}</dd>
              </div>
              <div>
                <dt>{session.revokedAt ? "撤销时间" : "到期时间"}</dt>
                <dd>{formatDate(session.revokedAt ?? session.expiresAt)}</dd>
              </div>
            </dl>
          </div>
          {revokeMutation && !session.isCurrent && !session.revokedAt ? (
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
          ) : null}
        </article>
      ))}
    </div>
  );
}
