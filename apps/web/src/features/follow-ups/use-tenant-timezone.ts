"use client";

import { useQuery } from "@tanstack/react-query";

import { followUpApi, followUpQueryKeys } from "./follow-up-api";

/**
 * The company's time zone, for dates that must read the same for everyone
 * (今天, 已逾期). It comes with the follow-up workbench response, which most
 * pages that show due dates already hold; until it arrives, the browser's zone
 * is used.
 */
export function useTenantTimezone(
  tenantCode: string,
  api: typeof followUpApi = followUpApi,
): string {
  const query = useQuery({
    queryKey: followUpQueryKeys.workbench(tenantCode),
    queryFn: () => api.workbench(tenantCode),
    staleTime: 5 * 60_000,
  });
  return (
    query.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}
