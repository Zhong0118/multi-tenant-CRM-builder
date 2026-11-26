"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Tooltip } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { resolvePostLoginRoute } from "@/lib/auth/post-login-route";

import { authApi, type AuthApi } from "./auth-api";
import {
  errorText,
  normalizeFormError,
  rememberPhone,
  rememberedPhone,
  useDeviceIdentity,
  type DeviceIdentity,
} from "./form-support";
import { loginSchema, type LoginInput } from "./schemas";
import { PasswordField } from "./password-field";
import styles from "./auth.module.css";

const SIGNED_OUT_WHY =
  "密码在其他设备上修改或重置过，或这台设备被移出了登录设备。如果不是你本人操作，请用「忘记密码」重置。";

export function LoginForm({
  api = authApi,
  navigate,
  returnTo,
  device,
  notice,
  signedOut,
}: {
  api?: AuthApi;
  navigate?: (path: string) => void;
  returnTo?: string | null;
  device?: DeviceIdentity;
  /** A success line carried over from the previous step, such as a reset. */
  notice?: string;
  /** This browser's session was ended elsewhere; say why it is back here. */
  signedOut?: boolean;
}) {
  const router = useRouter();
  const identity = useDeviceIdentity(device);
  const submissionLocked = useRef(false);
  const [summary, setSummary] = useState<string>();
  const {
    control,
    handleSubmit,
    getValues,
    setValue,
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
  // The phone typed before going to reset the password, or used there.
  useEffect(() => {
    const phone = rememberedPhone();
    if (phone && !getValues("phone")) setValue("phone", phone);
  }, [getValues, setValue]);
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
      // A reason that belongs to a field is said there, not again on top.
      const onField = Object.keys(apiError.fieldErrors).some(
        (field) => field in getValues(),
      );
      setSummary(onField ? undefined : errorText(apiError));
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
  /* eslint-disable react-hooks/refs -- RHF invokes submitLogin only from the DOM submit event. */
  return (
    <form
      className={styles.authForm}
      // Two fields: their own messages are enough; a banner above them
      // would only repeat them and push the form down.
      onSubmit={handleSubmit(submitLogin)}
      noValidate
    >
      {summary ? (
        <Alert type="error" showIcon title={summary} />
      ) : notice ? (
        <Alert type="success" showIcon title={notice} />
      ) : signedOut ? (
        <Alert
          type="info"
          showIcon
          title={
            <span className={styles.signedOut}>
              这台设备已退出登录
              <Tooltip title={SIGNED_OUT_WHY}>
                <button
                  type="button"
                  className={styles.why}
                  aria-label={SIGNED_OUT_WHY}
                >
                  <QuestionCircleOutlined aria-hidden />
                </button>
              </Tooltip>
            </span>
          }
        />
      ) : null}
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
        <Link
          href={
            returnTo
              ? `/forgot-password?${new URLSearchParams({ returnTo })}`
              : "/forgot-password"
          }
          onClick={() => {
            const phone = getValues("phone").trim();
            if (phone) rememberPhone(phone);
          }}
        >
          忘记密码？
        </Link>
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
