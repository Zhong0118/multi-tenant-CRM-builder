"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Space } from "antd";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";

import { authApi, type AuthApi } from "./auth-api";
import {
  normalizeFormError,
  useCountdown,
  useDeviceIdentity,
  type DeviceIdentity,
} from "./form-support";
import {
  phoneSchema,
  resetPasswordSchema,
  type ResetPasswordInput,
} from "./schemas";
import styles from "./auth.module.css";

export function PasswordResetForm({
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
  const {
    seconds: countdownSeconds,
    start: startCountdown,
    reset: resetCountdown,
  } = useCountdown();
  const [requestedPhone, setRequestedPhone] = useState<string>();
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
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { phone: "", code: "", newPassword: "" },
  });
  const codeMutation = useMutation({
    mutationFn: (input: { phone: string; deviceKey: string }) =>
      api.requestPasswordResetCode(input),
    onSuccess: (_result, input) => {
      if (getValues("phone") !== input.phone) {
        setRequestedPhone(undefined);
        resetCountdown();
        return;
      }
      setRequestedPhone(input.phone);
      startCountdown();
    },
    onError: (error) => {
      const apiError = normalizeFormError(error);
      setSummary({
        type: "error",
        text: `${apiError.message}（请求编号：${apiError.requestId}）`,
      });
    },
  });
  const resetMutation = useMutation({
    mutationFn: (input: ResetPasswordInput) => api.resetPassword(input),
    onSuccess: () => {
      setSummary({ type: "success", text: "密码已重置" });
      (navigate ?? router.push)("/login");
    },
    onError: (error) => {
      const apiError = normalizeFormError(error);
      setSummary({
        type: "error",
        text: `${apiError.message}（请求编号：${apiError.requestId}）`,
      });
      let shouldFocus = true;
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field in getValues()) {
          setError(
            field as keyof ResetPasswordInput,
            { message: messages.join("；") },
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
        { message: "请为当前手机号重新获取验证码。" },
        { shouldFocus: true },
      );
      return;
    }
    void handleSubmit((values) => {
      setSummary(undefined);
      resetMutation.mutate(values);
    })(event);
  }
  return (
    <form className={styles.authForm} onSubmit={submit} noValidate>
      {summary && <Alert type={summary.type} showIcon title={summary.text} />}
      <Form.Item
        label="手机号"
        htmlFor="reset-phone"
        validateStatus={errors.phone ? "error" : undefined}
        help={errors.phone?.message}
      >
        <Controller
          name="phone"
          control={control}
          render={({ field }) => (
            <Input
              id="reset-phone"
              inputMode="tel"
              autoComplete="tel"
              {...field}
              onChange={(event) => {
                field.onChange(event);
                if (requestedPhone && event.target.value !== requestedPhone) {
                  setRequestedPhone(undefined);
                  resetCountdown();
                  setValue("code", "");
                }
              }}
            />
          )}
        />
      </Form.Item>
      <Form.Item
        label="验证码"
        htmlFor="reset-code"
        validateStatus={errors.code ? "error" : undefined}
        help={errors.code?.message}
      >
        <Space.Compact block>
          <Controller
            name="code"
            control={control}
            render={({ field }) => (
              <Input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                {...field}
              />
            )}
          />
          <Button
            onClick={requestCode}
            disabled={countdownSeconds > 0 || codeMutation.isPending}
          >
            {countdownSeconds > 0
              ? `${countdownSeconds} 秒后重新获取`
              : codeMutation.isPending
                ? "正在发送…"
                : "获取验证码"}
          </Button>
        </Space.Compact>
      </Form.Item>
      <Form.Item
        label="设置新密码"
        htmlFor="reset-password"
        validateStatus={errors.newPassword ? "error" : undefined}
        help={errors.newPassword?.message}
        extra="10–72 位，同时包含字母和数字。"
      >
        <Controller
          name="newPassword"
          control={control}
          render={({ field }) => (
            <Input.Password
              id="reset-password"
              autoComplete="new-password"
              {...field}
            />
          )}
        />
      </Form.Item>
      <Button
        type="primary"
        htmlType="submit"
        block
        disabled={resetMutation.isPending}
      >
        {resetMutation.isPending ? "正在重置…" : "重置密码"}
      </Button>
    </form>
  );
}
