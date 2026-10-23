"use client";

import { useState } from "react";

import { IMPORT_FIX, IMPORT_ROWS } from "./demo-data";
import styles from "./demo.module.css";

type Phase = "file" | "checked" | "done";

const COLUMNS = ["客户名称", "联系人", "来源"];

export function ImportScenario({
  onTouch,
  onImported,
  onOpenPool,
}: {
  onTouch: () => void;
  onImported: (toPool: boolean) => void;
  onOpenPool: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("file");
  const [fixed, setFixed] = useState(false);
  const [toPool, setToPool] = useState(true);
  const blocked = phase === "checked" && !fixed;

  return (
    <div className={styles.scenario}>
      <header className={styles.head}>
        <div>
          <h3>导入到「客户」</h3>
          <p className={styles.meta}>展会客户名单.xlsx · 3 行 · 3 列</p>
        </div>
        <span
          className={styles.chip}
          data-tone={phase === "done" ? "ok" : undefined}
        >
          {phase === "file"
            ? "待检查"
            : phase === "checked"
              ? "已检查"
              : "已导入"}
        </span>
      </header>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.rowNo}>
                行
              </th>
              {COLUMNS.map((column) => (
                <th key={column} scope="col">
                  {column}
                  <small>→ {column}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IMPORT_ROWS.map((row, index) => {
              const missing = !row.name;
              return (
                <tr
                  key={row.contact}
                  data-error={(missing && blocked) || undefined}
                >
                  <td className={styles.rowNo}>{index + 2}</td>
                  <td>
                    {!missing ? (
                      row.name
                    ) : fixed ? (
                      <span className={styles.fixed}>{IMPORT_FIX}</span>
                    ) : phase === "checked" ? (
                      <span className={styles.cellError}>
                        必填，未填写
                        <button
                          type="button"
                          className={styles.inlineButton}
                          onClick={() => {
                            setFixed(true);
                            onTouch();
                          }}
                        >
                          补填
                        </button>
                      </span>
                    ) : (
                      <span className={styles.empty}>（空）</span>
                    )}
                  </td>
                  <td>{row.contact}</td>
                  <td>{row.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className={styles.foot} aria-live="polite">
        {phase === "file" ? (
          <>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={toPool}
                onChange={(event) => {
                  setToPool(event.target.checked);
                  onTouch();
                }}
              />
              导入后放进线索池，等销售领取
            </label>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setPhase("checked");
                onTouch();
              }}
            >
              检查数据
            </button>
          </>
        ) : phase === "checked" ? (
          <>
            <p data-tone={fixed ? "ok" : "warn"}>
              {fixed
                ? "3 行都通过检查，可以导入。"
                : "第 4 行：客户名称为必填。补填后再导入，其他行不受影响。"}
            </p>
            <button
              type="button"
              className={styles.primary}
              disabled={!fixed}
              onClick={() => {
                setPhase("done");
                onImported(toPool);
                onTouch();
              }}
            >
              导入 3 条
            </button>
          </>
        ) : (
          <>
            <p data-tone="ok">
              已新增 3 条客户{toPool ? "，并放进了线索池" : ""}
              。导入只新增，不覆盖已有记录。
            </p>
            {toPool ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={onOpenPool}
              >
                去线索公海看看 →
              </button>
            ) : null}
          </>
        )}
      </footer>
    </div>
  );
}
