"use client";

import type { components } from "@crm/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Result } from "antd";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

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
});

type CreateTenantInput = z.infer<typeof schema>;

export interface TenantApi {
  create(input: CreateTenantInput): Promise<PlatformTenant>;
  changeStatus(
    tenantId: string,
    input: { status: PlatformTenant["status"]; reason?: string },
  ): Promise<PlatformTenant>;
}

export const tenantApi: TenantApi = {
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
};

export function CreateTenantForm({ api = tenantApi }: { api?: TenantApi }) {
  const [created, setCreated] = useState<PlatformTenant>();
  const [summary, setSummary] = useState<string>();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateTenantInput>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", firstAdminPhone: "" },
  });
  const mutation = useMutation({
    mutationFn: (input: CreateTenantInput) => api.create(input),
    onSuccess: setCreated,
    onError: (error) => {
      const apiError = toApiError(error);
      setSummary(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  if (created) {
    return (
      <Result
        className={styles.creationResult}
        status="success"
        title="公司草稿已创建"
        subTitle={`${created.name} 仍处于草稿状态，首位管理员接受邀请后才可激活。`}
        extra={[
          <Link key="detail" href={`/platform/tenants/${created.id}`}>
            查看开通详情
          </Link>,
          <Link
            key="business-configuration"
            href={`/platform/tenants/${created.id}#business-configuration`}
          >
            前往业务配置
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
        mutation.mutate(values);
      })}
    >
      {summary ? <Alert type="error" showIcon title={summary} /> : null}
      <Form.Item
        label="公司名称"
        htmlFor="tenant-name"
        validateStatus={errors.name ? "error" : undefined}
        help={errors.name?.message}
      >
        <Controller
          name="name"
          control={control}
          render={({ field }) => <Input id="tenant-name" {...field} />}
        />
      </Form.Item>
      <Form.Item
        label="工作空间代码"
        htmlFor="tenant-code"
        validateStatus={errors.code ? "error" : undefined}
        help={errors.code?.message}
        extra="将出现在工作空间地址中，创建后不可随意变更。"
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
      <Button type="primary" htmlType="submit" loading={mutation.isPending}>
        {mutation.isPending ? "正在创建…" : "创建公司"}
      </Button>
    </form>
  );
}
