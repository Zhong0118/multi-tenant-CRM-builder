"use client";

import { Button, Input } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import type { RefObject } from "react";

import styles from "./ai-assistant.module.css";
import { AI_MAX_INPUT, type AiTurnPhase } from "./ai-types";

export function AiComposer({
  value,
  phase,
  onChange,
  onSend,
  onStop,
  inputRef,
}: {
  value: string;
  phase: AiTurnPhase;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  inputRef?: RefObject<TextAreaRef | null>;
}) {
  const generating = phase === "SENDING" || phase === "STREAMING";
  return (
    <div className={styles.composer}>
      <Input.TextArea
        ref={inputRef}
        value={value}
        maxLength={AI_MAX_INPUT}
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder="基于当前权限，询问可访问的 CRM 数据"
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={(event) => {
          if (event.shiftKey) return;
          event.preventDefault();
          if (value.trim()) onSend();
        }}
      />
      <div className={styles.composerActions}>
        {generating ? (
          <Button aria-label="停止" onClick={onStop}>
            停止
          </Button>
        ) : null}
        <Button
          type="primary"
          aria-label="发送"
          disabled={!value.trim()}
          onClick={onSend}
        >
          发送
        </Button>
      </div>
    </div>
  );
}
