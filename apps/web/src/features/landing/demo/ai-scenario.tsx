"use client";

import { useState } from "react";

import styles from "./demo.module.css";

/* The assistant answers from records the asker may read and cites them; to
   change data it only proposes, and the user confirms. The answers here are
   written in advance: no model is called. */

type Question = "idle" | "today" | "proposal";
type Proposal = "pending" | "confirmed" | "rejected";

const QUESTIONS: { key: Exclude<Question, "idle">; text: string }[] = [
  { key: "today", text: "我今天要跟进什么？" },
  { key: "proposal", text: "南湖实验学校报价确认后，帮我约下周一上门送样" },
];

function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

export function AiScenario({ onTouch }: { onTouch: () => void }) {
  const [asked, setAsked] = useState<Question>("idle");
  const [proposal, setProposal] = useState<Proposal>("pending");

  return (
    <div className={styles.scenario}>
      <header className={styles.head}>
        <div>
          <h3>AI 助手</h3>
          <p className={styles.meta}>只读取你有权限的表、记录和字段</p>
        </div>
      </header>

      <div className={styles.chat} aria-live="polite">
        {asked === "idle" ? (
          <p className={styles.chatHint}>从下面选一个问题。</p>
        ) : null}

        {asked === "today" ? (
          <div key="today" className={styles.fadeIn}>
            <p className={styles.ask}>我今天要跟进什么？</p>
            <div className={styles.answer}>
              <p>
                今天有 2 条跟进到期：16:00 前和南湖实验学校确认报价单，17:30
                回访城东社区医院。另有 1 条已逾期 2
                天：给滨江职业学校补发合同盖章页。
              </p>
              <p className={styles.sources}>
                <small>来源</small>
                <span>客户 · 南湖实验学校</span>
                <span>客户 · 城东社区医院</span>
                <span>客户 · 滨江职业学校</span>
              </p>
            </div>
          </div>
        ) : null}

        {asked === "proposal" ? (
          <div key="proposal" className={styles.fadeIn}>
            <p className={styles.ask}>
              南湖实验学校报价确认后，帮我约下周一上门送样
            </p>
            <div className={styles.answer}>
              <p>我可以在这条客户记录上创建一条跟进，你确认后才会写入：</p>
              <div className={styles.proposal} data-state={proposal}>
                <div className={styles.proposalHead}>
                  <b>创建跟进</b>
                  <span>
                    {proposal === "pending"
                      ? "待确认"
                      : proposal === "confirmed"
                        ? "已确认"
                        : "已拒绝"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>记录</dt>
                    <dd>南湖实验学校</dd>
                  </div>
                  <div>
                    <dt>事项</dt>
                    <dd>上门送样</dd>
                  </div>
                  <div>
                    <dt>时间</dt>
                    <dd>下周一 10:00</dd>
                  </div>
                </dl>
                {proposal === "pending" ? (
                  <div className={styles.proposalActions}>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => {
                        setProposal("confirmed");
                        onTouch();
                      }}
                    >
                      确认执行
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        setProposal("rejected");
                        onTouch();
                      }}
                    >
                      拒绝
                    </button>
                  </div>
                ) : (
                  <p
                    className={styles.proposalResult}
                    role="status"
                    tabIndex={-1}
                    ref={focusOnMount}
                  >
                    {proposal === "confirmed"
                      ? "已重新检查你的权限和记录版本，跟进已写入并记入审计。"
                      : "已拒绝，没有写入任何数据。"}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.prompts} role="group" aria-label="试着问">
        {QUESTIONS.map((question) => (
          <button
            key={question.key}
            type="button"
            aria-pressed={asked === question.key}
            onClick={() => {
              setAsked(question.key);
              setProposal("pending");
              onTouch();
            }}
          >
            {question.text}
          </button>
        ))}
      </div>
    </div>
  );
}
