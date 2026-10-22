"use client";

import { useState } from "react";

import styles from "./landing.module.css";

/* The assistant answers from records the asker may read, cites them, and
   only proposes writes. Fictional data; confirming writes nothing. */

type Question = "idle" | "today" | "proposal";
type Proposal = "pending" | "confirmed" | "rejected";

function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

export function AiDemo() {
  const [asked, setAsked] = useState<Question>("idle");
  const [proposal, setProposal] = useState<Proposal>("pending");

  return (
    <div className={styles.ai}>
      <div className={styles.aiHead}>
        <b>AI 助手</b>
        <span>只读取你有权限的数据</span>
      </div>
      <div className={styles.aiBody} aria-live="polite">
        {asked === "idle" ? (
          <p className={styles.aiHint}>选一个问题试试。</p>
        ) : null}

        {asked === "today" ? (
          <>
            <p className={styles.bubbleUser}>我今天要跟进什么？</p>
            <div className={styles.bubbleAi}>
              <p>
                今天有 1 条跟进到期：16:00 前和南湖实验学校确认报价单。另有 1
                条已逾期 2 天：给滨江职业学校补发合同盖章页，建议今天一起处理。
              </p>
              <p className={styles.sources}>
                <small>来源</small>
                <span>商机 · 南湖实验学校 新校区教室家具</span>
                <span>商机 · 滨江职业学校 宿舍床</span>
              </p>
            </div>
          </>
        ) : null}

        {asked === "proposal" ? (
          <>
            <p className={styles.bubbleUser}>
              南湖实验学校报价确认后，帮我约下周一上门送样。
            </p>
            <div className={styles.bubbleAi}>
              <p>我可以在这条商机上创建一条跟进，确认后才会写入：</p>
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
                    <dd>南湖实验学校 新校区教室家具</dd>
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
                      className={styles.solidButton}
                      onClick={() => setProposal("confirmed")}
                    >
                      确认执行
                    </button>
                    <button
                      type="button"
                      className={styles.darkGhost}
                      onClick={() => setProposal("rejected")}
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
                      ? "执行前重新检查了你的权限和记录版本，跟进已写入并记入审计。"
                      : "已拒绝，没有写入任何数据。"}
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div className={styles.prompts}>
        <span id="ai-prompts">试着问</span>
        <div role="group" aria-labelledby="ai-prompts">
          <button
            type="button"
            aria-pressed={asked === "today"}
            onClick={() => setAsked("today")}
          >
            我今天要跟进什么？
          </button>
          <button
            type="button"
            aria-pressed={asked === "proposal"}
            onClick={() => {
              setAsked("proposal");
              setProposal("pending");
            }}
          >
            报价确认后，帮我约下周一上门送样
          </button>
        </div>
      </div>
    </div>
  );
}
