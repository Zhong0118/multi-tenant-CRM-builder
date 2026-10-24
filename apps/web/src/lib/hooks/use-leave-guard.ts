"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * While `active`, leaving the page asks first: reload and close through the
 * browser's own prompt, links inside the app through the caller's dialog.
 * `pending` is the address the member tried to open; `leave` goes there.
 */
export function useLeaveGuard(active: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank")
        return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setPending(`${url.pathname}${url.search}`);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, [active]);

  return {
    pending,
    stay: () => setPending(null),
    leave: () => {
      const target = pending;
      setPending(null);
      if (target) router.push(target);
    },
  };
}
