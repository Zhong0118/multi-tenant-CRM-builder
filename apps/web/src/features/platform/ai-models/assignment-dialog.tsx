"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Modal, Space, Spin } from "antd";
import { CheckResults } from "./check-results";
import {
  connectionPath,
  currentSource,
  errorMessage,
  ineligible,
  modelRequest,
  purposeNames,
  type Check,
  type Overview,
  type Purpose,
  type Requirement,
} from "./model-data";
import styles from "./models.module.css";

export function AssignmentDialog({
  data,
  purpose,
  requirements,
  initialProvider,
  initialModel,
  testOnly,
  onClose,
  refresh,
}: {
  data: Overview;
  purpose: Purpose;
  requirements: Requirement[];
  initialProvider?: string;
  initialModel?: string;
  testOnly?: boolean;
  onClose: () => void;
  refresh: () => void;
}) {
  const [providerId, setProvider] = useState(initialProvider ?? "");
  const [model, setModel] = useState(initialModel ?? "");
  const [attempt, retry] = useState(0);
  const [outcome, setOutcome] = useState<{
    key: string;
    check?: Check;
    error?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReindex, setReindex] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const assignment = data.assignments.find((a) => a.purpose === purpose);
  const p = data.providers.find((p) => p.id === providerId && p.enabled);
  const revision = p?.revisions.find((r) => r.id === p.activeRevisionId);
  const selected = revision?.models.find((m) => m.name === model);
  const revisionId = revision?.id,
    version = p?.version;
  const available = !!selected && !ineligible(selected, purpose, requirements);
  const requestKey = JSON.stringify([
    providerId,
    version,
    revisionId,
    model,
    purpose,
    assignment?.version,
    attempt,
  ]);
  const current = outcome?.key === requestKey ? outcome : null;
  const check = current?.check,
    error = current?.error,
    busy = available && !current;
  useEffect(() => {
    if (!revisionId || !available) return;
    const action = new AbortController();
    controller.current = action;
    modelRequest<Check>(
      connectionPath(providerId) + "/test",
      "POST",
      { version, revisionId, model, purpose },
      action.signal,
    )
      .then((check) => {
        if (!action.signal.aborted) setOutcome({ key: requestKey, check });
      })
      .catch((e) => {
        if (!action.signal.aborted)
          setOutcome({ key: requestKey, error: errorMessage(e) });
      });
    return () => action.abort();
  }, [revisionId, version, model, providerId, purpose, requestKey, available]);
  function cancelTest() {
    controller.current?.abort();
    setOutcome({ key: requestKey, error: "测试已取消，可重新测试" });
  }
  function reset() {
    controller.current?.abort();
    setOutcome(null);
    setReindex(false);
  }
  const dimensionChange =
    purpose === "embedding" &&
    assignment?.dimensions != null &&
    check?.dimensions != null &&
    assignment.dimensions !== check.dimensions;
  async function confirm() {
    if (!p || !revision || check?.status !== "success" || saving) return;
    setSaving(true);
    try {
      await modelRequest("/assignments/" + purpose, "POST", {
        providerId,
        version: p.version,
        revisionId: revision.id,
        model,
        testId: check.id,
        assignmentVersion: assignment?.version ?? 0,
        confirmReindex,
      });
      refresh();
      onClose();
    } catch (e) {
      setOutcome({ key: requestKey, error: errorMessage(e) });
      refresh();
    } finally {
      setSaving(false);
    }
  }
  const usable = data.providers.filter((p) => p.enabled && p.activeRevisionId);
  return (
    <Modal
      open
      title={(testOnly ? "测试" : "更换") + purposeNames[purpose]}
      onCancel={() => {
        if (!saving) onClose();
      }}
      footer={
        <Space wrap>
          <Button disabled={saving} onClick={onClose}>
            {testOnly ? "关闭" : "取消"}
          </Button>
          {busy && <Button onClick={cancelTest}>取消测试</Button>}
          {!busy && model && (
            <Button disabled={saving} onClick={() => retry((n) => n + 1)}>
              重新测试
            </Button>
          )}
          {!testOnly && (
            <Button
              type="primary"
              loading={saving}
              disabled={
                busy ||
                check?.status !== "success" ||
                (dimensionChange && !confirmReindex)
              }
              onClick={confirm}
            >
              确认更换
            </Button>
          )}
        </Space>
      }
    >
      <div className={styles.form}>
        {!testOnly && (
          <>
            <label>
              供应商
              <select
                value={providerId}
                disabled={saving}
                onChange={(e) => {
                  reset();
                  setProvider(e.target.value);
                  setModel("");
                }}
              >
                <option value="">请选择供应商</option>
                {usable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {!usable.length && <p>先添加供应商并完成连接测试</p>}
            <label>
              模型
              <select
                value={model}
                disabled={!revision || saving}
                onChange={(e) => {
                  reset();
                  setModel(e.target.value);
                }}
              >
                <option value="">请选择模型</option>
                {revision?.models.map((m) => {
                  const why = ineligible(m, purpose, requirements);
                  return (
                    <option key={m.name} value={m.name} disabled={!!why}>
                      {m.name}
                      {why ? " · " + why : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          </>
        )}
        {testOnly && (
          <strong>
            {p?.name} / {model}
          </strong>
        )}
        {busy && (
          <span role="status">
            <Spin size="small" /> 正在测试{purposeNames[purpose]}
          </span>
        )}
        {check && <CheckResults check={check} />}
        {error && <Alert type="error" showIcon title={error} />}
        {!testOnly && check?.status === "success" && (
          <div className={styles.confirm}>
            <strong>{purposeNames[purpose]} · 所有公司立即生效</strong>
            <div>当前使用　{currentSource(data, purpose)}</div>
            <div>
              更换为　{p?.name} / {model}
            </div>
            {dimensionChange && (
              <Checkbox
                checked={confirmReindex}
                onChange={(e) => setReindex(e.target.checked)}
              >
                向量维度从 {assignment?.dimensions} 变为 {check.dimensions}
                ，已有资料需要重新建立索引
              </Checkbox>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
