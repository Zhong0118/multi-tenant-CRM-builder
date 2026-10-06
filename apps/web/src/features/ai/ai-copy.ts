import type { AiSourceSummary, AiToolSummary } from "./ai-types";

export function sourceHref(
  tenantCode: string,
  source: AiSourceSummary,
): string {
  const objectPath = `/workspace/${tenantCode}/objects/${encodeURIComponent(source.objectCode)}`;
  if (source.kind === "TIMELINE" && source.recordId) {
    return `${objectPath}/${encodeURIComponent(source.recordId)}`;
  }
  return objectPath;
}

export function conversationGroup(lastMessageAt: string, now = new Date()): "今天" | "最近 7 天" | "更早" {
  const date = new Date(lastMessageAt);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (date >= start) return "今天";
  const week = new Date(start);
  week.setDate(week.getDate() - 6);
  if (date >= week) return "最近 7 天";
  return "更早";
}

export function toolPrimaryLine(tool: AiToolSummary): string {
  const prefix =
    tool.status === "FAILED" ? "!" : tool.status === "COMPLETED" ? "✓" : "…";
  return `${prefix} ${tool.displayName}${tool.detail ? `  ${tool.detail}` : ""}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function messageTime(createdAt: string, now = new Date()): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === now.toDateString()) return time;
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() === now.getFullYear()) return `${day} ${time}`;
  return `${date.getFullYear()}年${day} ${time}`;
}
