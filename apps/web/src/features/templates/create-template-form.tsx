"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { toApiError } from "@/lib/api/api-error";

import { browserTemplateApi, type TemplateApi } from "./template-api";
import styles from "./templates.module.css";

const schema = z.object({
  name: z.string().trim().min(1, "请输入模板名称。").max(100),
  code: z
    .string()
    .max(64, "模板代码不能超过 64 个字符。")
    .regex(
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
      "仅支持小写字母、数字和单个连字符，且必须以字母开头。",
    ),
  description: z.string().trim().max(1000, "模板说明不能超过 1000 个字符。"),
});

type CreateTemplateFormInput = z.infer<typeof schema>;

export function CreateTemplateForm({
  api = browserTemplateApi,
  navigate,
}: {
  api?: TemplateApi;
  navigate?: (path: string) => void;
}) {
  const router = useRouter();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateTemplateFormInput>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", description: "" },
  });
  const mutation = useMutation({
    mutationFn: (input: CreateTemplateFormInput) =>
      api.create({ ...input, description: input.description || null }),
    onSuccess: (template) =>
      (navigate ?? router.push)(`/platform/templates/${template.id}`),
  });
  const error = mutation.error ? toApiError(mutation.error) : null;

  return (
    <form
      className={styles.createForm}
      noValidate
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          title={`${error.message}（请求编号：${error.requestId}）`}
        />
      ) : null}
      <Form.Item
        label="模板名称"
        htmlFor="template-name"
        validateStatus={errors.name ? "error" : undefined}
        help={errors.name?.message}
      >
        <Controller
          name="name"
          control={control}
          render={({ field }) => <Input id="template-name" {...field} />}
        />
      </Form.Item>
      <Form.Item
        label="模板代码"
        htmlFor="template-code"
        validateStatus={errors.code ? "error" : undefined}
        help={errors.code?.message}
        extra="用于稳定识别模板；首次发布后不可修改。"
      >
        <Controller
          name="code"
          control={control}
          render={({ field }) => (
            <Input
              id="template-code"
              autoCapitalize="none"
              maxLength={64}
              {...field}
            />
          )}
        />
      </Form.Item>
      <Form.Item
        label="模板说明"
        htmlFor="template-description"
        validateStatus={errors.description ? "error" : undefined}
        help={errors.description?.message}
      >
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <Input.TextArea id="template-description" rows={4} {...field} />
          )}
        />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={mutation.isPending}>
        {mutation.isPending ? "正在创建…" : "创建模板"}
      </Button>
    </form>
  );
}
