"use client";

import { useParams } from "next/navigation";

import { RouteNotFound } from "@/components/feedback/route-states";

export default function WorkspaceNotFound() {
  const { tenantCode } = useParams<{ tenantCode: string }>();
  return (
    <RouteNotFound
      homeHref={`/workspace/${encodeURIComponent(tenantCode)}`}
      homeLabel="返回工作台"
    />
  );
}
