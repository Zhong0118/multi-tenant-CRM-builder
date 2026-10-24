"use client";

import { App } from "antd";
import { useMemo } from "react";

/**
 * Short confirmations after a change succeeds, through the themed antd `App`
 * in the workspace shell. Outside an `App` (isolated tests) they are skipped
 * rather than throwing. Errors don't go here: they stay on the page until read.
 */
export function useToast() {
  const { message } = App.useApp();
  return useMemo(
    () => ({
      success(text: string) {
        if (typeof message.success === "function") void message.success(text);
      },
    }),
    [message],
  );
}
