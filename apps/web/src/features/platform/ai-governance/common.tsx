"use client";
import type { paths } from "@crm/contracts";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Alert, Button, Spin } from "antd";
import { useState } from "react";
import { browserApiClient as api } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";
import { useToast } from "@/components/feedback/use-toast";
import { StatePanel } from "@/components/workbench/state-panel";
export type Plan =
  paths["/api/v1/platform/ai-plans"]["get"]["responses"][200]["content"]["application/json"][number];
export type Feature = Plan["features"][number];
export type Summary =
  paths["/api/v1/platform/tenants/{id}/ai"]["get"]["responses"][200]["content"]["application/json"];
export type Settings =
  paths["/api/v1/platform/ai-settings"]["get"]["responses"][200]["content"]["application/json"];
export const names: Record<Feature, string> = {
  assistant: "对话助手",
  write_proposal: "AI 写入提议",
  communication: "整理沟通",
  filter: "一句话筛选",
  table_builder: "AI 建表",
};
export const list = (features: Feature[]) =>
  features.map((f) => names[f]).join("、") || "无";
export const wan = (s: string) => {
  const n = BigInt(s);
  const fraction = (n % BigInt(10000))
    .toString()
    .padStart(4, "0")
    .replace(/0+$/, "");
  return (n / BigInt(10000)).toString() + (fraction ? "." + fraction : "");
};
export function tokenAmount(input: string) {
  if (!/^\d{1,15}(\.\d{1,4})?$/.test(input)) return null;
  const [a, b = ""] = input.split(".");
  const n = BigInt(a) * BigInt(10000) + BigInt(b.padEnd(4, "0"));
  return n <= BigInt(9223372036854775807) ? n.toString() : null;
}
export async function result<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const r = await request;
  if (r.data !== undefined) return r.data;
  throw toApiError(r.error, r.response.status);
}
export function usePlans() {
  return useQuery({
    queryKey: ["platform-ai", "plans"],
    queryFn: () => result(api.GET("/api/v1/platform/ai-plans")),
  });
}
export function useSettings() {
  return useQuery({
    queryKey: ["platform-ai", "settings"],
    queryFn: () => result(api.GET("/api/v1/platform/ai-settings")),
  });
}
export function errorText(e: unknown) {
  if (typeof e === "object" && e && "message" in e)
    return (
      String(e.message) + ("requestId" in e ? " · 请求编号 " + e.requestId : "")
    );
  return "网络请求失败，请重试。";
}
export function ReadState({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  if (!error) return <Spin aria-label="正在读取 AI 配置" />;
  return (
    <StatePanel
      tone="error"
      title="无法读取 AI 配置"
      description={errorText(error)}
      action={<Button onClick={retry}>重试</Button>}
    />
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const client = useQueryClient();
  const toast = useToast();
  async function run(work: () => Promise<void>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      if (success) {
        toast.success(success);
        await client.invalidateQueries({ queryKey: ["platform-ai"] });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    run,
    clear: () => setError(""),
    error: error ? <Alert type="error" showIcon title={error} /> : null,
  };
}
