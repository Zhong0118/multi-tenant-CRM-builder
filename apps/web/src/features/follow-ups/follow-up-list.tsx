"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { FollowUpPanel } from "./follow-up-panel";
import type { FollowUpStatus } from "./follow-up-api";

export function FollowUpList({ tenantCode }: { tenantCode: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const rawStatus = params.get("status");
  const status: FollowUpStatus = ["OPEN", "OVERDUE", "DONE", "CANCELLED"].includes(rawStatus ?? "")
    ? rawStatus as FollowUpStatus : "OPEN";
  const rawPage = params.get("page") ?? "1";
  const page = /^[1-9]\d*$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) ? Number(rawPage) : 1;
  const path = `/workspace/${encodeURIComponent(tenantCode)}/follow-ups`;
  const search = params.toString();
  return <FollowUpPanel tenantCode={tenantCode} listState={{ status, page }}
    returnTo={`${path}${search ? `?${search}` : ""}`}
    onListStateChange={(next) => router.replace(`${path}?${new URLSearchParams({ status: next.status, page: String(next.page) })}`, { scroll: false })} />;
}
