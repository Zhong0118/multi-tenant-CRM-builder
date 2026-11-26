"use client";

import { ArrowRightOutlined } from "@ant-design/icons";
import { useAiFeature } from "@/features/ai-governance/access";
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
  const communication = useAiFeature("communication");
  const filter = useAiFeature("filter");
  const named = objects.slice(0, 2);
  const prompts =
    pageKind === "record"
      ? [`查看${objectName || "当前记录"}概况`, ...(communication ? ["整理本次沟通"] : [])]
      : pageKind === "list"
        ? [...(filter ? ["帮我筛选"] : []), "这张表有哪些可用字段"]
        : [
            named[0] ? `总结我负责的${named[0].name}` : "总结我负责的记录",
            "最近有哪些需要跟进？",
            named[1] || named[0]
              ? `统计${(named[1] ?? named[0]).name}的记录数`
              : "我能查看哪些业务表",
            "总结某条记录的最近活动",
          ];
  return (
    // Suggested questions as a plain list under the question, aligned with
    // the conversation column — not a centred icon over a grid of chips.
    <div className={styles.empty}>
      <h2>有什么可以帮你查的？</h2>
      <div className={styles.promptGrid}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className={styles.promptChip}
            onClick={() => onPrompt(prompt)}
          >
            <span>{prompt}</span>
            <ArrowRightOutlined aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
