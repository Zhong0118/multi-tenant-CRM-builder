"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Modal, Space } from "antd";
import type { DailyReportSections } from "@crm/contracts";
import { draftError, reportDraft } from "@/features/ai/sales-draft-api";
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
        <Button onClick={generate} loading={busy} disabled={disabled}>
          AI 起草
        </Button>
        {busy && (
          <Button onClick={() => request.current?.abort()}>取消生成</Button>
        )}
      </Space>
      {!preview && message && <p role="status">{message}</p>}
      <Modal
        title="日报草稿预览"
        width={800}
        open={Boolean(preview)}
        onCancel={() => setPreview(undefined)}
        onOk={apply}
        okText="采用所选内容"
        cancelText="取消"
        okButtonProps={{ disabled: disabled || !keys.some((k) => modes[k]) }}
      >
        {preview && (
          <>
            <p>
              AI 生成 · {new Date(preview.generatedAt).toLocaleString("zh-CN")}
            </p>
            <table className={styles.compare}>
              <thead>
                <tr>
                  <th>采用 / 字段</th>
                  <th>已有内容</th>
                  <th>AI 草稿</th>
                  <th>处理</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k}>
                    <th scope="row">
                      <label>
                        <input
                          type="checkbox"
                          aria-label={"采用" + names[k]}
                          disabled={!preview.sections[k]}
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
                    </th>
                    <td>{current[k] || "空"}</td>
                    <td>{preview.sections[k] || "无依据，留空"}</td>
                    <td>
                      {current[k] && modes[k] ? (
                        <select
                          aria-label={names[k] + "处理方式"}
                          value={modes[k]}
                          onChange={(e) =>
                            setModes({
                              ...modes,
                              [k]:
                                e.target.value === "replace"
                                  ? "replace"
                                  : "append",
                            })
                          }
                        >
                          <option value="append">追加</option>
                          <option value="replace">替换</option>
                        </select>
                      ) : modes[k] ? (
                        "填入"
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {message && <p role="status">{message}</p>}
          </>
        )}
      </Modal>
    </div>
  );
}
