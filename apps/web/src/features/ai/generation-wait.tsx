"use client";

import { useEffect, useState } from "react";

// Rounded median wall times from the sales-daily development set.
const seconds = { daily_brief: 15, writing: 5, daily_report: 1 };

export function GenerationWait({ feature }: { feature: keyof typeof seconds }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, []);
  return slow ? (
    <span role="status">通常需要 {seconds[feature]} 秒</span>
  ) : null;
}
