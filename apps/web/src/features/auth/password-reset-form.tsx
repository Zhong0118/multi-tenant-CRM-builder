"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Space } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";

import { authApi, type AuthApi } from "./auth-api";
import {
  errorText,
  normalizeFormError,
  rememberPhone,
  rememberedPhone,
  useDeviceIdentity,
  useSentCode,
  waitText,
  type DeviceIdentity,
} from "./form-support";
import {
  phoneSchema,
  resetPasswordSchema,
  type ResetPasswordInput,
} from "./schemas";
import styles from "./auth.module.css";
import { PasswordField } from "./password-field";

export function PasswordResetForm({
  api = authApi,
  navigate,
  device,
  returnTo,
}: {
  api?: AuthApi;
  navigate?: (path: string) => void;
  device?: DeviceIdentity;
  /** Where the login after a reset should land, carried from the login page. */
  returnTo?: string | null;
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
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { phone: "", code: "", newPassword: "" },
  });
  const sentCode = useSentCode("reset", (phone) => setValue("phone", phone));
  useEffect(() => {
    const phone = rememberedPhone();
    if (phone && !getValues("phone")) setValue("phone", phone);
  }, [getValues, setValue]);
  const requestedPhone = sentCode.phone;
  const countdownSeconds = sentCode.seconds;
  const codeMutation = useMutation({
    mutationFn: (input: { phone: string; deviceKey: string }) =>
      api.requestPasswordResetCode(input),
    onSuccess: (_result, input) => {
      if (getValues("phone") !== input.phone) {
        sentCode.clear();
        return;
      }
      sentCode.sent(input.phone);
      clearErrors("code");
      setSummary({
        type: "success",
        text: `验证码已发送至 ${input.phone}，请在有效期内完成重置。`,
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
  const resetMutation = useMutation({
    mutationFn: (input: ResetPasswordInput) => api.resetPassword(input),
    onSuccess: (_result, input) => {
      sentCode.clear();
      // The login page fills the same phone in and goes back where the
      // person was headed before they had to reset.
      rememberPhone(input.phone);
      setSummary({ type: "success", text: "密码已重置" });
      const params = new URLSearchParams({ reset: "done" });
      if (returnTo) params.set("returnTo", returnTo);
      (navigate ?? router.push)(`/login?${params}`);
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
              ? `${waitText(countdownSeconds)}后重新获取`
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
            <PasswordField
              id="reset-password"
              autoComplete="new-password"
              {...field}
              onChange={(event) => {
                field.onChange(event);
                clearErrors("newPassword");
              }}
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
