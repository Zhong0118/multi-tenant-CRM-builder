"use client";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./ai-assistant.module.css";

export function AiEmptyState({
  objects,
  onPrompt,
  pageKind,
}: {
  objects: RuntimeObjectNavigation[];
  pageKind?: "record" | "list";
  onPrompt: (text: string) => void;
}) {
  const named = objects.slice(0, 2);
  const prompts =
    pageKind === "record"
      ? ["这个客户什么情况", "记录本次沟通"]
      : pageKind === "list"
        ? ["帮我筛选", "这张表有哪些可用字段"]
        : [
            named[0] ? `总结我负责的${named[0].name}` : "总结我负责的客户",
            "最近有哪些需要跟进？",
            named[1] ? `按阶段统计当前${named[1].name}` : "按阶段统计当前商机",
            "总结某条记录的最近活动",
          ];
  return (
    <div className={styles.empty}>
      <div className={styles.emptyMark} aria-hidden>
        AI
      </div>
      <h2>有什么可以帮你查的？</h2>
      <p>可查询你有权限访问的数据，修改前会请你确认</p>
      <div className={styles.promptGrid}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className={styles.promptChip}
            onClick={() => onPrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
