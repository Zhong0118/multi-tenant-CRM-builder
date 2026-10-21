"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { toApiError } from "@/lib/api/api-error";

import { objectApi as defaultObjectApi, type ObjectApi } from "./object-api";
import { ObjectIconPicker } from "./object-icon-picker";
import { OBJECT_CODE_PATTERN, objectStableIdHelp } from "./object-types";

import {
  ObjectFileFieldsForm,
  type FileObjectState,
} from "./object-file-fields-form";

import styles from "./objects.module.css";

const createObjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写业务表名称。")
    .max(100, "业务表名称最多 100 个字符。"),
  code: z
    .string()
    .trim()
    .min(1, "请填写业务表代码。")
    .max(64, "业务表代码最多 64 个字符。")
    .regex(
      OBJECT_CODE_PATTERN,
      "业务表代码只能使用小写字母、数字和单个连字符，且以字母开头。",
    ),
});

export type CreateObjectValues = z.infer<typeof createObjectSchema>;

export function CreateObjectForm({
  tenantCode,
  api = defaultObjectApi,
  navigate,
}: {
  tenantCode: string;
  api?: ObjectApi;
  navigate?: (path: string) => void;
}) {
  const router = useRouter();
  const [fileState, setFileState] = useState<FileObjectState>({
    active: false,
  });
  const [summary, setSummary] = useState<string>();
  const [icon, setIcon] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateObjectValues>({
    resolver: zodResolver(createObjectSchema),
    defaultValues: { name: "", code: "" },
  });
  const mutation = useMutation({
    mutationFn: (values: CreateObjectValues) =>
      api.createDraft(tenantCode, {
        ...values,
        ...fileState.payload,
        ...(icon ? { icon } : {}),
      }),
    onSuccess: (draft) =>
      (navigate ?? router.push)(
        `/workspace/${tenantCode}/settings/objects/${draft.object.id}`,
      ),
    onError: (caught) => {
      const apiError = toApiError(caught);
      setSummary(
        `${apiError.message}${Object.entries(apiError.fieldErrors)
          .filter(([field]) => field !== "name" && field !== "code")
          .flatMap(([, messages]) => messages)
          .join("；")}（请求编号：${apiError.requestId}）`,
      );
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field === "name" || field === "code") {
          setError(field, { message: messages.join("；") });
        }
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    void handleSubmit((values) => {
      if (mutation.isPending || (fileState.active && !fileState.payload))
        return;
      setSummary(undefined);
      mutation.mutate(values);
    })(event);
  }

  return (
    <form className={styles.panel} onSubmit={submit} noValidate>
      {summary ? <Alert type="error" showIcon title={summary} /> : null}
      <Form.Item
        label="业务表名称"
        htmlFor="new-object-name"
        validateStatus={errors.name ? "error" : undefined}
        help={errors.name?.message}
        extra="使用员工认识的业务名称，例如“获客”“客户”。"
      >
        <Controller
          name="name"
          control={control}
          render={({ field }) => <Input id="new-object-name" {...field} />}
        />
      </Form.Item>
      <Form.Item
        label="业务表代码"
        htmlFor="new-object-code"
        validateStatus={errors.code ? "error" : undefined}
        help={errors.code?.message}
        extra={objectStableIdHelp(tenantCode)}
      >
        <Controller
          name="code"
          control={control}
          render={({ field }) => (
            <Input
              id="new-object-code"
              {...field}
              onChange={(event) =>
                field.onChange(event.target.value.toLowerCase())
              }
            />
          )}
        />
      </Form.Item>
      <Form.Item
        label="图标"
        extra="显示在侧边栏该业务表名称的前面，之后可以在基本设置里修改。"
      >
        <ObjectIconPicker
          value={icon}
          onChange={setIcon}
          disabled={mutation.isPending}
        />
      </Form.Item>
      <ObjectFileFieldsForm
        disabled={mutation.isPending}
        onChange={setFileState}
      />
      <Button
        type="primary"
        htmlType="submit"
        loading={mutation.isPending}
        disabled={fileState.active && !fileState.payload}
      >
        创建业务表草稿
      </Button>
    </form>
  );
}
