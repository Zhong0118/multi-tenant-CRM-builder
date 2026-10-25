"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";

import { RouteError } from "@/components/feedback/route-states";

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <RouteError
      error={error}
      reset={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
      homeHref="/platform"
      homeLabel="返回总览"
    />
  );
}
