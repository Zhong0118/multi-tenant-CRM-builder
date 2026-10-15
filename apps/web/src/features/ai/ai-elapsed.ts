"use client";

import { useEffect, useState } from "react";

export function useElapsedNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function elapsedSince(startedAt: string | undefined, now: number): number | undefined {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(start) ? Math.max(0, now - start) : undefined;
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`;
}
