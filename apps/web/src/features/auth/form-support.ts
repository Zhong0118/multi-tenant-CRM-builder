"use client";

import { useCallback, useEffect, useState } from "react";

import { toApiError, type ApiError } from "@/lib/api/api-error";

export interface DeviceIdentity {
  key: string;
  summary: string;
}

const fallbackDevice: DeviceIdentity = {
  key: "crm-browser-device",
  summary: "浏览器 · 未知系统",
};

export function getDeviceIdentity(): DeviceIdentity {
  if (typeof navigator === "undefined") return fallbackDevice;

  let key = fallbackDevice.key;
  try {
    if (typeof localStorage !== "undefined") {
      key =
        localStorage.getItem("crm_device_key") ??
        (typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : fallbackDevice.key);
      localStorage.setItem("crm_device_key", key);
    }
  } catch {
    // Storage can be unavailable in hardened browsers; the session still works.
  }
  return {
    key,
    summary: `${navigator.userAgent.includes("Mobile") ? "移动设备" : "浏览器"} · ${navigator.platform || "未知系统"}`,
  };
}

export function useDeviceIdentity(override?: DeviceIdentity): DeviceIdentity {
  const [identity, setIdentity] = useState(override ?? fallbackDevice);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setIdentity(override ?? getDeviceIdentity()),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [override]);

  return identity;
}

export function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  const start = useCallback(() => setSeconds(60), []);
  const reset = useCallback(() => setSeconds(0), []);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(
      () => setSeconds((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [seconds]);

  return { seconds, start, reset };
}

export function normalizeFormError(error: unknown): ApiError {
  return toApiError(error);
}
