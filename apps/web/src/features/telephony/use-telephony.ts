"use client";

import { useQuery } from "@tanstack/react-query";

import { telephonyApi } from "./telephony-api";

/**
 * What the current member may dial on one table (or one record): the allowed
 * phone fields, their own callback phone and why calling is off, if it is.
 * Shared by the list, the record page and the call dialog through one cache key.
 */
export function useTelephonyRuntime(
  tenantCode: string,
  objectCode: string,
  recordId?: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["telephony-runtime", tenantCode, objectCode, recordId ?? null],
    queryFn: () => telephonyApi.runtime(tenantCode, { objectCode, recordId }),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}
