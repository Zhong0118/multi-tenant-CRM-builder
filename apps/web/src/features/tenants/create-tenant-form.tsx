"use client";

import type { components } from "@crm/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Radio, Result, Select } from "antd";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import {
  browserTemplateApi,
  type TemplateApi,
} from "@/features/templates/template-api";

import styles from "./tenants.module.css";

export type PlatformTenant = components["schemas"]["PlatformTenantResponseDto"];

const schema = z.object({
  name: z.string().trim().min(1, "请输入公司名称。").max(200),
  code: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "仅支持小写字母、数字和单个连字符。"),
  firstAdminPhone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, "请输入 11 位中国大陆手机号。"),
  initialization: z.enum(["BLANK", "TEMPLATE"], {
    error: "请选择从模板开始还是空白开始。",
  }),
  templateId: z.string().optional(),
});

type CreateTenantFields = z.infer<typeof schema>;
type CreateTenantInput = Omit<CreateTenantFields, "templateId"> & {
  templateId?: string;
  templateVersionId?: string;
};

export interface TenantApi {
  create(input: CreateTenantInput): Promise<PlatformTenant>;
  changeStatus(
    tenantId: string,
    input: { status: PlatformTenant["status"]; reason?: string },
  ): Promise<PlatformTenant>;
  countNameConflicts(name: string): Promise<{ name: string; count: number }>;
  renewFirstAdminInvitation(tenantId: string): Promise<PlatformTenant>;
}

export const tenantApi: TenantApi = {
  async renewFirstAdminInvitation(tenantId) {
    const result = await browserApiClient.POST(
      "/api/v1/platform/tenants/{tenantId}/first-admin-invitation/renew",
      {
        params: { path: { tenantId } },
      },
    );
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
  async create(input) {
    const result = await browserApiClient.POST("/api/v1/platform/tenants", {
      body: input,
    });
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
  async changeStatus(tenantId, input) {
    const result = await browserApiClient.PATCH(
      "/api/v1/platform/tenants/{tenantId}/status",
      { params: { path: { tenantId } }, body: input },
    );
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
  async countNameConflicts(name) {
    const result = await browserApiClient.GET(
      "/api/v1/platform/tenants/name-conflicts",
      { params: { query: { name } } },
    );
    if (result.data) return result.data;
    throw toApiError(result.error, result.response.status);
  },
};

export function CreateTenantForm({
  api = tenantApi,
  templates = browserTemplateApi,
}: {
  api?: TenantApi;
  templates?: Pick<TemplateApi, "list">;
}) {
  const [created, setCreated] = useState<PlatformTenant>();
  const [summary, setSummary] = useState<string>();
  const [nameConflictCount, setNameConflictCount] = useState<number>();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateTenantFields>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", firstAdminPhone: "" },
  });
  const initialization = useWatch({ control, name: "initialization" });
  const published = useQuery({
    queryKey: ["platform", "business-templates", "published"],
    queryFn: () =>
      templates.list({ page: 1, limit: 100, hasActiveVersion: true }),
    enabled: initialization === "TEMPLATE",
  });
  const mutation = useMutation({
    mutationFn: (input: CreateTenantInput) => api.create(input),
    onSuccess: setCreated,
    onError: (error) => {
      const apiError = toApiError(error);
      setSummary(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });
  const nameCheck = useMutation({
    mutationFn: (name: string) => api.countNameConflicts(name),
    onSuccess: (result) => setNameConflictCount(result.count),
    onError: () => setNameConflictCount(undefined),
  });

  if (created) {
    return (
      <Result
        className={styles.creationResult}
        status="success"
        title="公司草稿已创建"
        subTitle={
          created.initialization
            ? `${created.name} 已从模板「${created.initialization.templateName}」v${created.initialization.templateVersionNo} 复制 ${created.initialization.objectCount} 张业务表，全部是未发布的草稿，员工暂时看不到。下一步：首位管理员接受邀请后，在「业务表」中检查并发布；平台再启用公司。`
            : `${created.name} 是空白公司，仍处于草稿状态。下一步：首位管理员接受邀请后自行搭建业务表（也可以之后再应用模板，只要公司里还没有业务表）；平台再启用公司。`
        }
        extra={[
          <Link key="detail" href={`/platform/tenants/${created.id}`}>
            查看开通详情
          </Link>,
        ]}
      >
        <dl className={styles.resultLedger}>
          <div>
            <dt>工作空间</dt>
            <dd>{created.code}</dd>
          </div>
          <div>
            <dt>管理员邀请</dt>
            <dd>
              {created.firstAdminInvitation?.status === "PENDING"
                ? "等待管理员接受邀请"
                : "邀请状态待确认"}
            </dd>
          </div>
        </dl>
      </Result>
    );
  }

  return (
    <form
      className={styles.createForm}
      noValidate
      onSubmit={handleSubmit((values) => {
        setSummary(undefined);
        if (values.initialization === "TEMPLATE") {
          const template = published.data?.items.find(
            (item) => item.id === values.templateId,
          );
          if (!template?.activeVersion) {
            setError("templateId", { message: "请选择一个已发布的模板。" });
            return;
          }
          mutation.mutate({
            ...values,
            templateId: template.id,
            templateVersionId: template.activeVersion.id,
          });
          return;
        }
        mutation.mutate({ ...values, templateId: undefined });
      })}
    >
      {summary ? <Alert type="error" showIcon title={summary} /> : null}
      <Form.Item
        label="公司名称"
        htmlFor="tenant-name"
        validateStatus={errors.name ? "error" : undefined}
        help={
          errors.name?.message ??
          (nameConflictCount
            ? `已有 ${nameConflictCount} 家公司使用相同名称，仍可继续创建。`
            : undefined)
        }
        extra="公司名称允许重复，便于同名主体或分支机构入驻。"
      >
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <Input
              id="tenant-name"
              {...field}
              onBlur={(event) => {
                field.onBlur();
                const name = event.target.value.trim();
                if (name) nameCheck.mutate(name);
                else setNameConflictCount(undefined);
              }}
            />
          )}
        />
      </Form.Item>
      <Form.Item
        label="工作空间代码"
        htmlFor="tenant-code"
        validateStatus={errors.code ? "error" : undefined}
        help={errors.code?.message}
        extra="工作空间代码全局唯一，将出现在工作空间地址中，创建后不可随意变更。"
      >
        <Controller
          name="code"
          control={control}
          render={({ field }) => (
            <Input id="tenant-code" autoCapitalize="none" {...field} />
          )}
        />
      </Form.Item>
      <Form.Item
        label="首位管理员手机号"
        htmlFor="tenant-admin-phone"
        validateStatus={errors.firstAdminPhone ? "error" : undefined}
        help={errors.firstAdminPhone?.message}
        extra="系统发送邀请；管理员使用自己的账号接受，不在此设置密码。"
      >
        <Controller
          name="firstAdminPhone"
          control={control}
          render={({ field }) => (
            <Input id="tenant-admin-phone" inputMode="tel" {...field} />
          )}
        />
      </Form.Item>
      <Form.Item
        label="初始化方式"
        validateStatus={errors.initialization ? "error" : undefined}
        help={errors.initialization?.message}
        extra="模板只在创建时复制一次，成为这家公司自己的草稿配置；之后修改模板不会改动这家公司。"
      >
        <Controller
          name="initialization"
          control={control}
          render={({ field }) => (
            <Radio.Group
              aria-label="初始化方式"
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              options={[
                { value: "TEMPLATE", label: "从模板开始" },
                { value: "BLANK", label: "空白开始" },
              ]}
            />
          )}
        />
      </Form.Item>
      {initialization === "TEMPLATE" ? (
        <Form.Item
          label="模板"
          htmlFor="tenant-template"
          validateStatus={errors.templateId ? "error" : undefined}
          help={
            errors.templateId?.message ??
            (published.isSuccess && published.data.items.length === 0
              ? "还没有已发布的模板，可以先选择空白开始。"
              : undefined)
          }
          extra="复制为未发布的草稿：首位管理员检查并发布后，员工才能使用。"
        >
          <Controller
            name="templateId"
            control={control}
            render={({ field }) => (
              <Select
                id="tenant-template"
                aria-label="模板"
                loading={published.isLoading}
                placeholder="选择已发布的模板"
                value={field.value}
                onChange={field.onChange}
                options={(published.data?.items ?? []).map((template) => ({
                  value: template.id,
                  label: `${template.name} · v${template.activeVersion?.versionNo ?? "—"}`,
                }))}
              />
            )}
          />
        </Form.Item>
      ) : null}
      <Button type="primary" htmlType="submit" loading={mutation.isPending}>
        {mutation.isPending ? "正在创建…" : "创建公司"}
      </Button>
    </form>
  );
}
