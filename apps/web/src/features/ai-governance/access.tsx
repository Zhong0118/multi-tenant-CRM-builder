"use client";
import { formatPercent, formatTokens } from "@/features/ai-governance/format";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Alert } from "antd";
import {
  workspaceAi,
  type AiFeature,
  type Capabilities,
} from "./workspace-api";

// Standalone feature components rely on their host workspace to provide entitlements.
// A mounted workspace fails closed while its capabilities are unavailable.
export const AiAccessContext = createContext<Capabilities | null | undefined>(
  undefined,
);
export function WorkspaceAiAccess({
  tenantCode,
  memberId,
  children,
}: {
  tenantCode: string;
  memberId: string;
  children: ReactNode;
}) {
  const path = usePathname();
  const { data, refetch } = useQuery({
    queryKey: ["ai-capabilities", tenantCode, memberId],
    queryFn: () => workspaceAi.capabilities(tenantCode),
    refetchOnWindowFocus: "always",
    refetchInterval: 30000,
    retry: 1,
  });
  useEffect(() => {
    void refetch();
  }, [path, refetch]);
  return (
    <AiAccessContext.Provider value={data ?? null}>
      {children}
    </AiAccessContext.Provider>
  );
}
export function useAiFeature(feature: AiFeature) {
  const caps = useContext(AiAccessContext);
  return (
    caps === undefined ||
    Boolean(caps && !caps.disabled && caps.features.includes(feature))
  );
}
export function FeatureGate({
  feature,
  children,
  fallback = null,
}: {
  feature: AiFeature;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useAiFeature(feature) ? children : fallback;
}
export function AccessReason() {
  const caps = useContext(AiAccessContext);
  return (
    <p role="status">
      {caps === null
        ? "正在检查 AI 功能"
        : caps?.disabled
          ? "AI 功能暂不可用"
          : "当前套餐不包含此功能"}
    </p>
  );
}
export function CurrentQuotaNotice() {
  const caps = useContext(AiAccessContext);
  return caps?.disabled ? null : <QuotaNotice capabilities={caps} />;
}
function quotaExhausted(c: Capabilities | null | undefined) {
  return c?.notice === "company_exhausted" ||
    (c?.notice === "personal" && c.percent !== null && c.percent >= 100);
}
export function useQuotaExhausted() {
  return quotaExhausted(useContext(AiAccessContext));
}
export function QuotaNotice({
  capabilities: c,
}: {
  capabilities: Capabilities | null | undefined;
}) {
  if (!c) return null;
  // restoresAt is the instant of the first local day of the next billing month.
  const d = new Date(c.restoresAt);
  if (d.getUTCDate() > 1) d.setUTCDate(d.getUTCDate() + 1);
  const date = d.getUTCMonth() + 1 + "月1日";
  const exhausted = quotaExhausted(c);
  const message = c.disabled
    ? "AI 功能暂不可用"
    : exhausted
      ? (c.notice === "personal"
          ? "你本月的 AI 份额已用完"
          : "本月 AI 额度已用完") +
        "，" +
        date +
        (c.notice === "company_exhausted" ? "恢复。如需增加，请联系管理员" : "恢复")
      : c.notice === "personal"
        ? "本人本月已用 " +
          formatPercent(c.percent ?? 0) +
          " · 剩余 " +
          formatTokens(c.remainingTokens ?? 0)
        : c.notice === "company_warning"
          ? "公司本月 AI 额度已用 " + formatPercent(c.percent ?? 0)
          : null;
  return message ? (
    <div role="status">
      <Alert
        title={message}
        type={
          exhausted || c.disabled
            ? "error"
            : c.notice === "company_warning"
              ? "warning"
              : "info"
        }
        showIcon
      />
    </div>
  ) : null;
}
