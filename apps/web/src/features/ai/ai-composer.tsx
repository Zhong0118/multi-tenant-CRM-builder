"use client";

import { Button, Input } from "antd";

import styles from "./ai-assistant.module.css";
import { AI_MAX_INPUT, type AiTurnPhase } from "./ai-types";

export function AiComposer({
  value,
  phase,
  onChange,
  onSend,
  onStop,
}: {
  value: string;
  phase: AiTurnPhase;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const generating = phase === "SENDING" || phase === "STREAMING";
  return (
    <div className={styles.composer}>
      <Input.TextArea
        value={value}
        maxLength={AI_MAX_INPUT}
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder="基于当前权限，询问可访问的 CRM 数据"
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={(event) => {
          if (event.shiftKey) return;
          event.preventDefault();
          if (!generating && value.trim()) onSend();
        }}
      />
      <div className={styles.composerActions}>
        {generating ? (
          <Button aria-label="停止" onClick={onStop}>
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            aria-label="发送"
            disabled={!value.trim()}
            onClick={onSend}
          >
            发送
          </Button>
        )}
      </div>
    </div>
  );
}
