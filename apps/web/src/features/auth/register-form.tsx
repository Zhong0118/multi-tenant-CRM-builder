"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Space } from "antd";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { resolvePostLoginRoute } from "@/lib/auth/post-login-route";

import { authApi, type AuthApi } from "./auth-api";
import {
  errorText,
  normalizeFormError,
  useDeviceIdentity,
  useSentCode,
  waitText,
  type DeviceIdentity,
} from "./form-support";
import {
  PASSWORD_RULE,
  phoneSchema,
  registerSchema,
  type RegisterInput,
} from "./schemas";
import { PasswordField } from "./password-field";
import styles from "./auth.module.css";

export function RegisterForm({
  api = authApi,
  navigate,
  device,
}: {
  api?: AuthApi;
  navigate?: (path: string) => void;
  device?: DeviceIdentity;
}) {
  const router = useRouter();
  const identity = useDeviceIdentity(device);
  const [summary, setSummary] = useState<{
    type: "error" | "success";
    text: string;
  }>();
  const {
    control,
    handleSubmit,
    getValues,
    setError,
    setFocus,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      phone: "",
      code: "",
      displayName: "",
      password: "",
      deviceSummary: identity.summary,
    },
  });
  const password = useWatch({ control, name: "password" });
  const sentCode = useSentCode("register", (phone) => setValue("phone", phone));
  const requestedPhone = sentCode.phone;
  const countdownSeconds = sentCode.seconds;
  const codeMutation = useMutation({
    mutationFn: (input: { phone: string; deviceKey: string }) =>
      api.requestRegisterCode(input),
    onSuccess: (_result, input) => {
      if (getValues("phone") !== input.phone) {
        sentCode.clear();
        return;
      }
      sentCode.sent(input.phone);
      clearErrors("code");
      setSummary({
        type: "success",
        text: `验证码已发送至 ${input.phone}，请在有效期内完成注册。`,
      });
    },
    onError: (error, input) => {
      const apiError = normalizeFormError(error);
      const retry = apiError.retryAfterSeconds;
      if (apiError.code === "RATE_LIMITED" && retry) {
        sentCode.blocked(retry);
        // Say how long to wait, and that a code already received still works.
        setSummary({
          type: "error",
          text: `验证码请求太频繁了，${waitText(retry)}后再试。${requestedPhone === input.phone ? "已经收到的验证码 10 分钟内仍然有效，可以直接填写。" : ""}`,
        });
        clearErrors("code");
        return;
      }
      setSummary({ type: "error", text: errorText(apiError) });
    },
  });
  const registerMutation = useMutation({
    mutationFn: (values: RegisterInput) =>
      api.register({
        ...values,
        deviceSummary: identity.summary,
      }),
    onSuccess: async (result) => {
      sentCode.clear();
      let path = result.user.isPlatformAdmin ? "/platform" : "/workspaces";
      try {
        const workspaces = await api.listWorkspaces();
        path = resolvePostLoginRoute({
          workspaces,
          returnTo: null,
          isPlatformAdmin: result.user.isPlatformAdmin,
        });
      } catch {
        // Registration is already committed; the workspace page can retry discovery.
      }
      (navigate ?? router.push)(path);
    },
    onError: (error) => {
      const apiError = normalizeFormError(error);
      // A reason that belongs to a field is said there, not again on top.
      const onField = Object.keys(apiError.fieldErrors).some(
        (field) => field in getValues(),
      );
      setSummary(
        onField ? undefined : { type: "error", text: errorText(apiError) },
      );
      let shouldFocus = true;
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field in getValues()) {
          setError(
            field as keyof RegisterInput,
            {
              message: messages.join("；"),
            },
            { shouldFocus },
          );
          shouldFocus = false;
        }
      }
    },
  });

  function requestCode() {
    const parsed = phoneSchema.safeParse(getValues("phone"));
    if (!parsed.success) {
      setError("phone", { message: parsed.error.issues[0]?.message });
      setSummary({ type: "error", text: "请先填写有效的手机号。" });
      setFocus("phone");
      return;
    }
    setSummary(undefined);
    codeMutation.mutate({ phone: parsed.data, deviceKey: identity.key });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (requestedPhone !== getValues("phone")) {
      event.preventDefault();
      setError(
        "code",
        {
          message:
            countdownSeconds > 0
              ? `请先获取这个手机号的验证码，${waitText(countdownSeconds)}后可以获取。`
              : "请先获取这个手机号的验证码。",
        },
        { shouldFocus: true },
      );
      return;
    }
    // Invalid fields say why under themselves; no second banner on top.
    void handleSubmit((values) => {
      setSummary(undefined);
      registerMutation.mutate(values);
    })(event);
  }

  return (
    <form className={styles.authForm} onSubmit={submit} noValidate>
      {summary && <Alert type={summary.type} showIcon title={summary.text} />}
      <Form.Item
        label="手机号"
        htmlFor="register-phone"
        validateStatus={errors.phone ? "error" : undefined}
        help={errors.phone?.message}
      >
        <Controller
          name="phone"
          control={control}
          render={({ field }) => (
            <Input
              id="register-phone"
              inputMode="tel"
              autoComplete="tel"
              {...field}
              onChange={(event) => {
                field.onChange(event);
                clearErrors("phone");
                setSummary(undefined);
                if (requestedPhone && event.target.value !== requestedPhone) {
                  sentCode.clear();
                  setValue("code", "");
                }
              }}
            />
          )}
        />
      </Form.Item>
      <Form.Item
        label="验证码"
        htmlFor="register-code"
        validateStatus={errors.code ? "error" : undefined}
        help={errors.code?.message}
      >
        <Space.Compact block>
          <Controller
            name="code"
            control={control}
            render={({ field }) => (
              <Input
                id="register-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                {...field}
              />
            )}
          />
          <Button
            type="default"
            onClick={requestCode}
            disabled={countdownSeconds > 0 || codeMutation.isPending}
          >
            {countdownSeconds > 0
              ? `${waitText(countdownSeconds)}后重新获取`
              : codeMutation.isPending
                ? "正在发送…"
                : "获取验证码"}
          </Button>
        </Space.Compact>
      </Form.Item>
      <Form.Item
        label="姓名"
        htmlFor="register-name"
        validateStatus={errors.displayName ? "error" : undefined}
      >
        <Controller
          name="displayName"
          control={control}
          render={({ field }) => (
            <Input id="register-name" autoComplete="name" {...field} />
          )}
        />
      </Form.Item>
      <Form.Item
        label="设置密码"
        htmlFor="register-password"
        validateStatus={errors.password ? "error" : undefined}
        help={errors.password?.message}
        // The rule shows up once typing starts; an error replaces it.
        extra={password && !errors.password ? PASSWORD_RULE : undefined}
      >
        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <PasswordField
              id="register-password"
              autoComplete="new-password"
              {...field}
              onChange={(event) => {
                field.onChange(event);
                clearErrors("password");
              }}
            />
          )}
        />
      </Form.Item>
      <Button
        type="primary"
        htmlType="submit"
        block
        disabled={registerMutation.isPending}
      >
        {registerMutation.isPending ? "正在创建账号…" : "创建账号"}
      </Button>
    </form>
  );
}
