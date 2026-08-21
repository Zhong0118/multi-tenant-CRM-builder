"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { resolvePostLoginRoute } from "@/lib/auth/post-login-route";

import { authApi, type AuthApi } from "./auth-api";
import {
  normalizeFormError,
  useDeviceIdentity,
  type DeviceIdentity,
} from "./form-support";
import { loginSchema, type LoginInput } from "./schemas";
import { PasswordField } from "./password-field";
import styles from "./auth.module.css";

export function LoginForm({
  api = authApi,
  navigate,
  returnTo,
  device,
}: {
  api?: AuthApi;
  navigate?: (path: string) => void;
  returnTo?: string | null;
  device?: DeviceIdentity;
}) {
  const router = useRouter();
  const identity = useDeviceIdentity(device);
  const submissionLocked = useRef(false);
  const [summary, setSummary] = useState<string>();
  const {
    control,
    handleSubmit,
    getValues,
    clearErrors,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      phone: "",
      password: "",
      deviceKey: identity.key,
      deviceSummary: identity.summary,
    },
  });
  const mutation = useMutation({
    mutationFn: (values: LoginInput) =>
      api.login({
        ...values,
        deviceKey: identity.key,
        deviceSummary: identity.summary,
      }),
    onSuccess: async (result) => {
      let path = result.user.isPlatformAdmin ? "/platform" : "/workspaces";
      try {
        const workspaces = await api.listWorkspaces();
        path = resolvePostLoginRoute({
          workspaces,
          returnTo,
          isPlatformAdmin: result.user.isPlatformAdmin,
        });
      } catch {
        // Authentication is already committed; the workspace page can retry discovery.
      }
      (navigate ?? router.push)(path);
    },
    onError: (error) => {
      const apiError = normalizeFormError(error);
      setSummary(`${apiError.message}（请求编号：${apiError.requestId}）`);
      let shouldFocus = true;
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field in getValues()) {
          setError(
            field as keyof LoginInput,
            { message: messages.join("；") },
            { shouldFocus },
          );
          shouldFocus = false;
        }
      }
    },
    onSettled: () => {
      submissionLocked.current = false;
    },
  });
  function submitLogin(values: LoginInput) {
    if (submissionLocked.current) return;
    submissionLocked.current = true;
    setSummary(undefined);
    mutation.mutate(values);
  }
  function showValidationSummary() {
    setSummary("请检查手机号和密码，并补全标记为错误的内容。");
  }
  /* eslint-disable react-hooks/refs -- RHF invokes submitLogin only from the DOM submit event. */
  return (
    <form
      className={styles.authForm}
      onSubmit={handleSubmit(submitLogin, showValidationSummary)}
      noValidate
    >
      {summary && <Alert type="error" showIcon title={summary} />}
      <Form.Item
        label="手机号"
        htmlFor="login-phone"
        validateStatus={errors.phone ? "error" : undefined}
        help={errors.phone?.message}
      >
        <Controller
          name="phone"
          control={control}
          render={({ field }) => (
            <Input
              id="login-phone"
              inputMode="tel"
              autoComplete="tel"
              {...field}
              onChange={(event) => {
                field.onChange(event);
                clearErrors("phone");
                setSummary(undefined);
              }}
            />
          )}
        />
      </Form.Item>
      <Form.Item
        label="密码"
        htmlFor="login-password"
        validateStatus={errors.password ? "error" : undefined}
        help={errors.password?.message}
      >
        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <PasswordField
              id="login-password"
              autoComplete="current-password"
              {...field}
              onChange={(event) => {
                field.onChange(event);
                clearErrors("password");
                setSummary(undefined);
              }}
            />
          )}
        />
      </Form.Item>
      <div className={styles.formAside}>
        <Link href="/forgot-password">忘记密码？</Link>
      </div>
      <Button
        type="primary"
        htmlType="submit"
        block
        disabled={mutation.isPending}
      >
        {mutation.isPending ? "正在登录…" : "登录"}
      </Button>
    </form>
  );
  /* eslint-enable react-hooks/refs */
}
