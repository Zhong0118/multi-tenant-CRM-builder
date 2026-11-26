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

/** "45 秒" / "约 12 分钟" — how long until something can be tried again. */
export function waitText(seconds: number) {
  return seconds < 90 ? `${seconds} 秒` : `约 ${Math.ceil(seconds / 60)} 分钟`;
}

/** Message for a failed request: request ids only where support needs one. */
export function errorText(error: ApiError) {
  return error.status >= 500
    ? `${error.message}（请求编号：${error.requestId}）`
    : error.message;
}

const CODE_TTL_MS = 10 * 60_000;
const RESEND_MS = 60_000;

/**
 * Which phone a code was sent to, kept for the code's 10 minutes in this tab
 * so a reload (say, after switching to the messages app) does not throw away
 * a code that is still valid, or restart the resend wait.
 */
export function useSentCode(
  purpose: "register" | "reset",
  onRestore: (phone: string) => void,
) {
  const key = `crm.auth.code.${purpose}`;
  const { seconds, start, reset } = useCountdown();
  const [phone, setPhone] = useState<string>();
  const [restore] = useState(() => onRestore);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
        phone?: unknown;
        sentAt?: unknown;
        waitUntil?: unknown;
      } | null;
      if (!saved) return;
      const now = Date.now();
      const age = now - Number(saved.sentAt);
      const waitUntil = Number(saved.waitUntil) || 0;
      if (typeof saved.phone === "string" && age >= 0 && age < CODE_TTL_MS) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhone(saved.phone);
        restore(saved.phone);
      }
      const left = Math.max(RESEND_MS - age, waitUntil - now);
      if (left > 0) start(left / 1000);
      if (!(age < CODE_TTL_MS) && waitUntil <= now)
        sessionStorage.removeItem(key);
    } catch {
      // Storage refused: the code works for this page view only.
    }
  }, [key, restore, start]);
  function save(next: { phone?: string; sentAt?: number; waitUntil?: number }) {
    try {
      const current = JSON.parse(sessionStorage.getItem(key) ?? "{}");
      sessionStorage.setItem(key, JSON.stringify({ ...current, ...next }));
    } catch {
      // Storage refused: nothing to keep across reloads.
    }
  }
  return {
    /** The phone the latest still-valid code was sent to. */
    phone,
    seconds,
    sent(to: string) {
      setPhone(to);
      start(RESEND_MS / 1000);
      save({ phone: to, sentAt: Date.now(), waitUntil: 0 });
    },
    /** The server refused to send: wait as long as it says. */
    blocked(retryAfterSeconds: number) {
      start(retryAfterSeconds);
      save({ waitUntil: Date.now() + retryAfterSeconds * 1000 });
    },
    clear() {
      setPhone(undefined);
      reset();
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Nothing stored.
      }
    },
  };
}

const PHONE_KEY = "crm.auth.phone";
/** Carry the phone between login and password reset in this tab. */
export function rememberPhone(phone: string) {
  try {
    sessionStorage.setItem(PHONE_KEY, phone);
  } catch {
    // Storage refused: the next page starts empty.
  }
}
export function rememberedPhone() {
  try {
    return sessionStorage.getItem(PHONE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
