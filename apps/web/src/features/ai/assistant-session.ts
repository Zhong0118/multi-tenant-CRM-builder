"use client";

import { useSyncExternalStore } from "react";

export function sessionKey(tenant: string, member: string, part: string) {
  return `crm.assistant:${encodeURIComponent(tenant)}:${encodeURIComponent(member)}:${part}`;
}
export function writeAssistantSession(key: string, value?: string) {
  if (value === undefined) sessionStorage.removeItem(key);
  else sessionStorage.setItem(key, value);
  window.dispatchEvent(new Event("crm-assistant-session"));
}
function subscribe(change: () => void) {
  window.addEventListener("crm-assistant-session", change);
  return () => window.removeEventListener("crm-assistant-session", change);
}
export function useAssistantSession(key: string) {
  return useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(key),
    () => null,
  );
}
