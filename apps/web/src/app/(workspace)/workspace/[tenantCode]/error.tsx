"use client";

import { useParams, useRouter } from "next/navigation";
import { startTransition } from "react";

import { RouteError } from "@/components/feedback/route-states";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const { tenantCode } = useParams<{ tenantCode: string }>();
  return (
    <RouteError
      error={error}
      // Server data is re-read by refresh; reset then re-renders the segment.
      reset={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
      homeHref={`/workspace/${encodeURIComponent(tenantCode)}`}
      homeLabel="返回工作台"
    />
  );
}
