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

/** "Chrome · macOS" — what a person recognises in their device list. */
export function describeDevice(userAgent: string, platform = "") {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /MicroMessenger/i.test(userAgent)
      ? "微信"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : /Mobile/.test(userAgent)
              ? "移动设备"
              : "浏览器";
  const system = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(userAgent) || /^Mac/.test(platform)
          ? "macOS"
          : /Windows/.test(userAgent) || /^Win/.test(platform)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : platform || "未知系统";
  return `${browser} · ${system}`;
}

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
    summary: describeDevice(navigator.userAgent ?? "", navigator.platform),
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
  const start = useCallback(
    (from = 60) => setSeconds(Math.max(0, Math.ceil(from))),
    [],
  );
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
