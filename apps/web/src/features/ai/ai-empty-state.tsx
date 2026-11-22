"use client";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./ai-assistant.module.css";

export function AiEmptyState({
  objects,
  onPrompt,
  pageKind,
  objectName,
}: {
  objects: RuntimeObjectNavigation[];
  objectName?: string;
  pageKind?: "record" | "list";
  onPrompt: (text: string) => void;
}) {
  const named = objects.slice(0, 2);
  const prompts =
    pageKind === "record"
      ? [`查看${objectName || "当前记录"}概况`, "记录本次沟通"]
      : pageKind === "list"
        ? ["帮我筛选", "这张表有哪些可用字段"]
        : [
            named[0] ? `总结我负责的${named[0].name}` : "总结我负责的记录",
            "最近有哪些需要跟进？",
            named[1] || named[0]
              ? `统计${(named[1] ?? named[0]).name}的记录数`
              : "我能查看哪些业务表",
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
