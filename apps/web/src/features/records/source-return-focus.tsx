"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { consumeSourceReturnFocus } from "./source-navigation";

/** Local to the two supported source surfaces, never a global navigation effect. */
export function SourceReturnFocus({ tenantCode, heading, children }: {
  tenantCode: string;
  heading: "h1" | "h2";
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const source = `${pathname}${search ? `?${search}` : ""}`;

  useEffect(() => {
    const target = root.current?.querySelector<HTMLHeadingElement>(heading);
    if (!target || !consumeSourceReturnFocus(tenantCode, source)) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [tenantCode, source, heading]);

  return <div ref={root}>{children}</div>;
}
