import type { operations } from "@crm/contracts";
import { browserApiOrigin } from "@/lib/api/api-origin";
import { toApiError } from "@/lib/api/api-error";

export const purposeNames = {
  text: "文字模型",
  vision: "视觉模型",
  embedding: "向量模型",
} as const;
export type Purpose = keyof typeof purposeNames;
export const purposes = Object.keys(purposeNames) as Purpose[];
export type Overview =
  operations["ModelAdminController_list"]["responses"][200]["content"]["application/json"];
export type Provider = Overview["providers"][number];
export type Revision = Provider["revisions"][number];
export type Model = Revision["models"][number];
export type Check = Revision["tests"][number];
export type Protocol = Revision["protocol"];
export type Connection =
  operations["ModelAdminController_create"]["requestBody"]["content"]["application/json"];
export type Saved =
  operations["ModelAdminController_create"]["responses"][200]["content"]["application/json"];
export function editable(p: Provider) {
  return p.revisions.find(
    (r) => r.id === (p.draftRevisionId ?? p.activeRevisionId),
  );
}
export function lastTest(r?: Revision, purpose?: Purpose, model?: string) {
  return r?.tests
    .filter(
      (t) =>
        t.status !== "running" &&
        (!purpose || t.purpose === purpose) &&
        (!model || t.model === model),
    )
    .sort((a, b) => b.sequence - a.sequence)[0];
}
export function currentSource(data: Overview, purpose: Purpose) {
  const assignment = data.assignments.find((a) => a.purpose === purpose);
  if (assignment)
    return [
      data.providers.find((p) => p.id === assignment.providerId)?.name,
      assignment.model,
    ]
      .filter(Boolean)
      .join(" / ");
  if (purpose === "text" && data.environment.configured)
    return [data.environment.provider, data.environment.model]
      .filter(Boolean)
      .join(" / ");
  return "未配置";
}
export type Requirement = { name: string; tokens: number };
export function ineligible(
  m: Model,
  purpose: Purpose,
  requirements: Requirement[],
  embeddings: boolean,
) {
  if (!m.capabilities.includes(purpose))
    return {
      text: "不支持文字生成",
      vision: "不支持图片输入",
      embedding: "不支持向量接口",
    }[purpose];
  if (purpose === "embedding") return embeddings ? "" : "连接未开启向量接口";
  if (!m.contextTokens || !m.maxOutputTokens)
    return (
      "请补齐" +
      [
        !m.contextTokens ? "上下文长度" : "",
        !m.maxOutputTokens ? "最大输出" : "",
      ]
        .filter(Boolean)
        .join("和")
    );
  if (m.maxOutputTokens > m.contextTokens) return "最大输出超过上下文长度";
  if (purpose === "text") {
    const insufficient = requirements.filter(
      (r) => r.tokens > (m.maxOutputTokens ?? 0),
    );
    if (insufficient.length)
      return (
        "最大输出不足 " +
        Math.max(...insufficient.map((r) => r.tokens)) +
        "（" +
        insufficient.map((r) => r.name + " " + r.tokens).join("、") +
        "）"
      );
  }
  return "";
}
export async function modelRequest<T>(
  path = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const origin = new URL(browserApiOrigin());
  if (
    path.endsWith("/key") &&
    origin.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(origin.hostname)
  ) {
    throw new Error("请通过 HTTPS 连接保存 Key");
  }
  const response = await fetch(
    origin.origin + "/api/v1/platform/ai-models" + path,
    {
      method,
      credentials: "include",
      cache: "no-store",
      signal,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
  const value = await response.json();
  if (!response.ok) {
    const error = toApiError(value, response.status);
    if (response.status === 403) throw new Error("仅平台管理员可管理模型");
    const message = error.message
      .replaceAll("修订", "配置")
      .replaceAll("凭据", "Key");
    if (response.status === 409)
      throw new Error(message + " 请重新读取配置并测试。");
    throw new Error(message);
  }
  return value;
}
export function connectionPath(id: string) {
  return "/providers/" + encodeURIComponent(id);
}
export function checkError(code?: string | null) {
  if (!code) return "";
  if (/AUTH|KEY|CREDENTIAL_REJECTED|401/i.test(code)) return "Key 无效";
  if (/TIMEOUT/i.test(code)) return "连接超时";
  if (/RATE|429/i.test(code)) return "请求过于频繁";
  if (/CANCEL|ABORT/i.test(code)) return "测试已取消";
  return "请检查接口地址、协议和模型能力";
}
export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "请求失败，请重试";
}
