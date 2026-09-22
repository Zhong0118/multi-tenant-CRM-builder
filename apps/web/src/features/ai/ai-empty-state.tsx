"use client";

import { Button } from "antd";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./ai-assistant.module.css";

export function AiEmptyState({
  objects,
  onPrompt,
}: {
  objects: RuntimeObjectNavigation[];
  onPrompt: (text: string) => void;
}) {
  const named = objects.slice(0, 3);
  const prompts =
    named.length > 0
      ? named.map((object) => `帮我看看最近的${object.name}`)
      : ["帮我看看我能访问的业务数据"];
  return (
    <div className={styles.empty}>
      <h2>从一条问题开始</h2>
      <p>只读取你当前可访问的数据，不会修改业务数据。</p>
      <div>
        {prompts.map((prompt) => (
          <Button key={prompt} type="link" onClick={() => onPrompt(prompt)}>
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
}
