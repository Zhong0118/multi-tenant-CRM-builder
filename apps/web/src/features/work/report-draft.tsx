"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Modal, Segmented, Space } from "antd";
import type { DailyReportSections } from "@crm/contracts";
import { draftError, reportDraft } from "@/features/ai/sales-draft-api";
import { AiSparkIcon } from "@/components/icons/ai-spark-icon";
import { GenerationWait } from "@/features/ai/generation-wait";
import styles from "./report-draft.module.css";
type Section = keyof DailyReportSections;
const names: Record<Section, string> = {
  plans: "今日计划",
  completed: "完成情况",
  problems: "遇到的问题",
  nextSteps: "明日安排",
};
const keys = Object.keys(names) as Section[];
export function ReportDraft({
  tenantCode,
  workDate,
  current,
  onApply,
  load = reportDraft,
  disabled = false,
}: {
  tenantCode: string;
  workDate: string;
  current: DailyReportSections;
  onApply: (sections: DailyReportSections) => void;
  load?: typeof reportDraft;
  disabled?: boolean;
}) {
  const [preview, setPreview] =
    useState<
      Extract<Awaited<ReturnType<typeof reportDraft>>, { empty: false }>
    >();
  const [modes, setModes] = useState<
    Partial<Record<Section, "append" | "replace">>
  >({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function generate() {
    if (request.current) return;
    const stop = new AbortController();
    request.current = stop;
    setBusy(true);
    setMessage("");
    try {
      const draft = await load(tenantCode, workDate, stop.signal);
      if (stop.signal.aborted) return;
      if (draft.empty || !keys.some((key) => draft.sections[key])) {
        setMessage("所选日期暂无可用于起草日报的事实。");
        return;
      }
      setPreview(draft);
      setModes(
        Object.fromEntries(
          keys.filter((k) => draft.sections[k]).map((k) => [k, "append"]),
        ),
      );
    } catch (e) {
      if (!stop.signal.aborted) setMessage(draftError(e));
    } finally {
      request.current = null;
      setBusy(false);
    }
  }
  function apply() {
    if (!preview) return;
    const next = { ...current };
    for (const key of keys) {
      if (!modes[key]) continue;
      const text = preview.sections[key];
      next[key] =
        current[key] && modes[key] === "append"
          ? current[key] + "\n" + text
          : text;
      if (next[key].length > 4000) {
        setMessage(names[key] + "超过 4000 字，请选择替换或取消该项。");
        return;
      }
    }
    onApply(next);
    setPreview(undefined);
    setMessage("");
  }
  return (
    <div>
      <Space wrap>
        <Button
          onClick={generate}
          aria-label={busy ? "生成中" : undefined}
          loading={busy}
          disabled={disabled}
        >
          {busy ? "生成中" : "AI 起草"}
        </Button>
        {busy && <GenerationWait feature="daily_report" />}
        {busy && (
          <Button onClick={() => request.current?.abort()}>取消生成</Button>
        )}
      </Space>
      {!preview && message && (
        <p role="status" className={styles.note}>
          {message}
        </p>
      )}
      <Modal
        title="日报草稿预览"
        width={640}
        open={Boolean(preview)}
        onCancel={() => setPreview(undefined)}
        onOk={apply}
        okText="采用所选内容"
        cancelText="取消"
        okButtonProps={{ disabled: disabled || !keys.some((k) => modes[k]) }}
      >
        {preview && (
          <div className={styles.preview}>
            <p className={styles.meta}>
              <AiSparkIcon aria-hidden className={styles.aiMark} />
              AI 生成 ·{" "}
              {new Date(preview.generatedAt).toLocaleString("zh-CN", {
                timeZone: preview.timeZone,
              })}
            </p>
            {/* Each drafted section: adopt it, see the draft, and see what the
                report already says there; append or replace when both exist. */}
            <ul className={styles.sections}>
              {keys
                .filter((k) => preview.sections[k])
                .map((k) => (
                  <li key={k} className={styles.section}>
                    <div className={styles.sectionHead}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={"采用" + names[k]}
                          checked={Boolean(modes[k])}
                          onChange={(e) =>
                            setModes({
                              ...modes,
                              [k]: e.target.checked ? "append" : undefined,
                            })
                          }
                        />
                        {names[k]}
                      </label>
                      {current[k] && modes[k] ? (
                        <Segmented
                          size="small"
                          aria-label={names[k] + "处理方式"}
                          value={modes[k]}
                          onChange={(value) =>
                            setModes({
                              ...modes,
                              [k]: value === "replace" ? "replace" : "append",
                            })
                          }
                          options={[
                            { value: "append", label: "追加" },
                            { value: "replace", label: "替换" },
                          ]}
                        />
                      ) : modes[k] ? (
                        <span className={styles.mode}>填入</span>
                      ) : null}
                    </div>
                    <p className={styles.draft}>{preview.sections[k]}</p>
                    {current[k] ? (
                      <p className={styles.current}>
                        <span>已有内容</span>
                        {current[k]}
                      </p>
                    ) : null}
                  </li>
                ))}
            </ul>
            {keys.some((k) => !preview.sections[k]) ? (
              <p className={styles.skipped}>
                没有依据，留空：
                {keys
                  .filter((k) => !preview.sections[k])
                  .map((k) => names[k])
                  .join("、")}
              </p>
            ) : null}
            {message && <p role="status">{message}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
