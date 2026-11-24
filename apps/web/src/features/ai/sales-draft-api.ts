"use client";
import type {
  DailyReportSections,
  WritingDraft,
  WritingOptions,
} from "@crm/contracts";
import { z } from "zod";
import { browserApiOrigin } from "@/lib/api/api-origin";
import { toApiError } from "@/lib/api/api-error";
export const writingOptionsSchema = z.object({
  kind: z.enum(["message", "email", "call", "visit"]),
  purpose: z.enum([
    "followup",
    "invite",
    "quote",
    "payment",
    "thanks",
    "other",
  ]),
  tone: z.enum(["formal", "friendly"]),
  length: z.enum(["short", "medium"]),
  supplement: z.string().optional(),
});
const meta = z.object({
  kind: writingOptionsSchema.shape.kind,
  title: z.string(),
  subject: z.string().optional(),
  generatedAt: z.string(),
  canLog: z.boolean(),
  basis: z.string().optional(),
});
const block = z.object({ text: z.string(), factRefs: z.array(z.string()) });
export const liveWritingSchema = meta.extend({ blocks: z.array(block) });
export type LiveWriting = WritingDraft & z.infer<typeof meta>;
const base = (tenant: string) =>
  browserApiOrigin() +
  "/api/v1/workspaces/" +
  encodeURIComponent(tenant) +
  "/ai/";
const path = (tenant: string, code: string, id: string) =>
  base(tenant) +
  "writing/" +
  encodeURIComponent(code) +
  "/" +
  encodeURIComponent(id);
async function post(url: string, body: unknown, signal: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw toApiError(await res.json(), res.status);
  return res;
}
export async function writingDraft(
  tenant: string,
  code: string,
  id: string,
  opts: WritingOptions & {
    rewrite?: {
      mode: "regenerate" | "shorter" | "formal";
      basis: string;
      refs: string[];
      previousLength: number;
    };
  },
  signal: AbortSignal,
  publish: (draft: LiveWriting) => void,
) {
  const res = await post(path(tenant, code, id), opts, signal);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("缺少生成内容");
  let result: LiveWriting | undefined;
  let done = false;
  let pending = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.type === "meta")
          result = { ...meta.parse(event), blocks: [] };
        else if (event.type === "block" && result) {
          result = {
            ...result,
            blocks: [...result.blocks, block.parse(event.block)],
          };
          publish(result);
        } else if (event.type === "done") done = true;
      }
      if (next.done) break;
    }
    if (!result?.blocks.length || !done) throw new Error("生成中断，请重试");
    return result;
  } finally {
    reader.releaseLock();
  }
}
export async function checkWritingActivity(
  tenant: string,
  code: string,
  id: string,
  signal: AbortSignal,
) {
  const response = await fetch(path(tenant, code, id) + "/activity-access", {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw toApiError(await response.json(), response.status);
}
export async function reportDraft(
  tenant: string,
  workDate: string,
  signal: AbortSignal,
): Promise<
  | { empty: true }
  | { empty: false; sections: DailyReportSections; generatedAt: string }
> {
  return (
    await post(base(tenant) + "daily-report", { workDate }, signal)
  ).json();
}
export function draftError(e: unknown) {
  return e &&
    typeof e === "object" &&
    "message" in e &&
    typeof e.message === "string"
    ? e.message
    : "生成失败，请重试。";
}
