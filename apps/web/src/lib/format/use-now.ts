"use client";

import { useEffect, useState } from "react";

const currentTime = () => Date.now();

/**
 * The current time, refreshed every minute, so due labels (今天 / 已逾期)
 * move on by themselves. Read once per render, not inside render code.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(currentTime);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(currentTime()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
