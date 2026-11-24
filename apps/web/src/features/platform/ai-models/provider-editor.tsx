"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Drawer, Input, Space, Steps } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { CheckResults } from "./check-results";
import {
  connectionPath,
  currentSource,
  editable,
  errorMessage,
  ineligible,
  modelRequest,
  purposeNames,
  type Check,
  type Connection,
  type Model,
  type Overview,
  type Protocol,
  type Provider,
  type Purpose,
  type Requirement,
  type Saved,
} from "./model-data";
import { ModelFields } from "./model-fields";
import { modelEntry, presets } from "./presets";
import styles from "./models.module.css";

export function ProviderEditor({
  provider,
  data,
  requirements,
  importing,
  startStep,
  onClose,
}: {
  provider?: Provider;
  data: Overview;
  requirements: Requirement[];
  importing?: boolean;
  startStep?: number;
  onClose: () => void;
}) {
  const revision = provider && editable(provider);
  const initial: Connection =
    provider && revision
      ? {
          name: provider.name,
          preset: provider.preset,
          protocol: revision.protocol,
          baseURL: revision.baseURL,
          embeddings: revision.embeddings,
          models: revision.models,
        }
      : presets[0];
  const [draft, setDraft] = useState(initial),
    [step, setStep] = useState(startStep ?? (provider ? 1 : 0));
  const [key, setKey] = useState(""),
    [keyStored, setKeyStored] = useState(!!revision?.keyLast4);
  const saved = useRef<Saved | null>(
    provider && revision
      ? { id: provider.id, version: provider.version, revisionId: revision.id }
      : null,
  );
  const storedDraft = useRef<Connection | null>(provider ? initial : null);
  const [selected, select] = useState(0),
    [target, setTarget] = useState<Purpose>(
      initial.models[0]?.capabilities[0] ?? "text",
    );
  const [checks, setChecks] = useState<Check[]>([]),
    [discovered, setDiscovered] = useState<string[]>([]);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [reindex, setReindex] = useState(false);
  const control = useRef<AbortController | null>(null);
  useEffect(() => () => control.current?.abort(), []);
  const m = draft.models[selected];
  const purpose = importing
    ? "text"
    : m?.capabilities.includes(target)
      ? target
      : m?.capabilities[0];
  const blocked =
    m && purpose ? ineligible(m, purpose, requirements) : "请选择模型和用途";
  const passed =
    checks.length > 0 && checks.every((c) => c.status === "success");
  const assigned = data.assignments.filter(
    (a) => a.providerId === provider?.id,
  );
  const embedding = assigned.find((a) => a.purpose === "embedding");
  const measured = checks.find(
    (c) => c.purpose === "embedding" && c.model === embedding?.model,
  );
  const dimensionChange =
    embedding?.dimensions != null &&
    measured?.dimensions != null &&
    measured.dimensions !== embedding.dimensions;
  function change(next: Connection) {
    setDraft(next);
    setChecks([]);
    setError("");
    setReindex(false);
  }
  function patch(patch: Partial<Connection>) {
    change({ ...draft, ...patch });
  }
  async function persist() {
    if (!saved.current || storedDraft.current !== draft) {
      const prev = saved.current;
      saved.current = await modelRequest<Saved>(
        prev ? connectionPath(prev.id) : "/providers",
        prev ? "PATCH" : "POST",
        prev ? { ...draft, version: prev.version } : draft,
      );
      storedDraft.current = draft;
    }
    if (key.trim()) {
      const prev = saved.current!;
      saved.current = await modelRequest<Saved>(
        connectionPath(prev.id) + "/key",
        "POST",
        { version: prev.version, apiKey: key.trim() },
      );
      setKey("");
      setKeyStored(true);
    }
    return saved.current!;
  }
  async function run(action: "discover" | "test" | "save") {
    if (busy) return;
    setBusy(action);
    setError("");
    const controller = new AbortController();
    control.current = controller;
    try {
      const handle = await persist();
      if (controller.signal.aborted) return;
      const path = connectionPath(handle.id);
      const identity = {
        revisionId: handle.revisionId,
        version: handle.version,
      };
      if (action === "discover") {
        const response = await modelRequest<{ models: string[] }>(
          path + "/discover",
          "POST",
          identity,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setDiscovered(response.models);
          if (!response.models.length) setError("没有返回模型 ID，可手动添加");
        }
      } else if (action === "test" && m && purpose) {
        setChecks([]);
        const targets = [
          { model: m.name, purpose },
          ...assigned.map((a) => ({ model: a.model, purpose: a.purpose })),
        ];
        const unique = targets.filter(
          (t, i) =>
            targets.findIndex(
              (a) => a.model === t.model && a.purpose === t.purpose,
            ) === i,
        );
        const completed: Check[] = [];
        for (const t of unique) {
          const check = await modelRequest<Check>(
            path + "/test",
            "POST",
            { ...identity, ...t },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          completed.push(check);
          setChecks([...completed]);
          if (check.status !== "success") break;
        }
      } else if (action === "save") {
        if (passed && importing && m) {
          await modelRequest("/assignments/text", "POST", {
            ...identity,
            providerId: handle.id,
            model: m.name,
            testId: checks[0].id,
            assignmentVersion:
              data.assignments.find((a) => a.purpose === "text")?.version ?? 0,
            confirmReindex: reindex,
          });
        } else if (passed)
          await modelRequest(path + "/activate", "POST", {
            ...identity,
            confirmReindex: reindex,
          });
        onClose();
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(errorMessage(e));
        if (action !== "discover") setChecks([]);
      }
    } finally {
      if (control.current === controller) setBusy("");
    }
  }
  function cancel() {
    control.current?.abort();
    setChecks([]);
    setError("已取消，可重新测试");
  }
  function append(next: Model) {
    select(draft.models.length);
    patch({ models: [...draft.models, next] });
  }
  function update(next: Model) {
    patch({
      models: draft.models.map((item, i) => (i === selected ? next : item)),
    });
  }
  const close = () => {
    if (!busy) onClose();
  };
  const changedHost =
    !!revision &&
    (() => {
      try {
        return (
          new URL(revision.baseURL).href.replace(/\/$/, "") !==
          new URL(draft.baseURL).href.replace(/\/$/, "")
        );
      } catch {
        return true;
      }
    })();
  const baseValid = (() => {
    try {
      const url = new URL(draft.baseURL);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  })();
  const connectReady =
    baseValid &&
    (!!key.trim() ||
      (keyStored &&
        (!changedHost || storedDraft.current?.baseURL === draft.baseURL)));
  return (
    <Drawer
      open
      title={
        importing ? "转为平台配置" : provider ? "编辑供应商" : "添加供应商"
      }
      size={590}
      onClose={close}
      closable={!busy}
      keyboard={!busy}
      footer={
        <Space wrap>
          {step > 0 && (
            <Button disabled={!!busy} onClick={() => setStep(step - 1)}>
              上一步
            </Button>
          )}
          {step < 2 ? (
            <Button
              type="primary"
              disabled={step === 0 ? !draft.name.trim() : !connectReady}
              onClick={() => setStep(step + 1)}
            >
              下一步
            </Button>
          ) : (
            <>
              {busy === "test" || busy === "discover" ? (
                <Button onClick={cancel}>
                  取消{busy === "test" ? "测试" : "获取"}
                </Button>
              ) : (
                <Button
                  disabled={!!busy || !!blocked}
                  onClick={() => run("test")}
                >
                  测试连接
                </Button>
              )}
              <Button
                type="primary"
                loading={busy === "save"}
                disabled={
                  !!busy ||
                  (dimensionChange && !reindex) ||
                  (importing && passed && purpose !== "text")
                }
                onClick={() => run("save")}
              >
                {passed ? (importing ? "确认转换" : "保存") : "保存草稿"}
              </Button>
            </>
          )}
        </Space>
      }
    >
      <Steps
        current={step}
        size="small"
        items={["选择预设", "填写连接", "选择模型"].map((title) => ({ title }))}
      />
      <fieldset disabled={!!busy} className={styles.editor}>
        {step === 0 && (
          <>
            <div className={styles.presetGrid}>
              {presets.map((item) => (
                <Button
                  key={item.preset}
                  disabled={!!provider}
                  aria-pressed={draft.preset === item.preset}
                  type={draft.preset === item.preset ? "primary" : "default"}
                  onClick={() => {
                    change(item);
                    select(0);
                    setDiscovered([]);
                  }}
                >
                  {item.name}
                </Button>
              ))}
            </div>
            <label>
              连接名称
              <Input
                value={draft.name}
                maxLength={100}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <label>
              API Key
              <Input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setChecks([]);
                }}
                placeholder={
                  keyStored ? "已设置，输入新 Key 可更换" : "输入 API Key"
                }
              />
            </label>
            <p>Key 仅在服务端加密保存</p>
            <details open={draft.preset === "custom" || undefined}>
              <summary>高级设置</summary>
              <div className={styles.form}>
                {draft.preset === "kimi" && (
                  <label>
                    服务地域
                    <select
                      value={
                        draft.baseURL === "https://api.moonshot.ai/v1"
                          ? "international"
                          : draft.baseURL === "https://api.moonshot.cn/v1"
                            ? "china"
                            : "custom"
                      }
                      onChange={(e) =>
                        patch({
                          baseURL:
                            e.target.value === "china"
                              ? "https://api.moonshot.cn/v1"
                              : "https://api.moonshot.ai/v1",
                        })
                      }
                    >
                      <option value="china">中国站</option>
                      <option value="international">国际站</option>
                      {![
                        "https://api.moonshot.ai/v1",
                        "https://api.moonshot.cn/v1",
                      ].includes(draft.baseURL) && (
                        <option value="custom">自定义</option>
                      )}
                    </select>
                  </label>
                )}
                <label>
                  API 地址
                  <Input
                    value={draft.baseURL}
                    placeholder="https://"
                    onChange={(e) => {
                      patch({ baseURL: e.target.value });
                      setDiscovered([]);
                    }}
                  />
                </label>
                <label>
                  对话格式
                  <select
                    value={draft.protocol}
                    onChange={(e) =>
                      patch({ protocol: e.target.value as Protocol })
                    }
                  >
                    <option value="chat">Chat Completions</option>
                    <option value="responses">Responses</option>
                  </select>
                </label>
                <Checkbox
                  checked={draft.embeddings}
                  onChange={(e) =>
                    patch({
                      embeddings: e.target.checked,
                      models: draft.models.map((m) => ({
                        ...m,
                        capabilities: e.target.checked
                          ? m.capabilities
                          : m.capabilities.filter((c) => c !== "embedding"),
                      })),
                    })
                  }
                >
                  支持向量接口
                </Checkbox>
              </div>
            </details>
            {changedHost && !key && <p>更换服务地址后，请输入该服务的 Key</p>}
          </>
        )}
        {step === 2 && (
          <>
            <Space wrap>
              <Button
                icon={<ReloadOutlined />}
                loading={busy === "discover"}
                onClick={() => run("discover")}
              >
                获取模型列表
              </Button>
              <Button
                icon={<PlusOutlined />}
                onClick={() => append(modelEntry())}
              >
                手动添加
              </Button>
            </Space>
            {!!discovered.length && (
              <label>
                发现的模型
                <select
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (name) append(modelEntry(name));
                  }}
                >
                  <option value="">选择并添加模型</option>
                  {discovered.map((name) => (
                    <option
                      key={name}
                      value={name}
                      disabled={draft.models.some((m) => m.name === name)}
                    >
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.models.length > 0 ? (
              <>
                <label>
                  编辑模型
                  <select
                    value={selected}
                    onChange={(e) => {
                      select(Number(e.target.value));
                      setChecks([]);
                      setError("");
                    }}
                  >
                    {draft.models.map((m, i) => (
                      <option key={i} value={i}>
                        {m.name || "新模型"}
                      </option>
                    ))}
                  </select>
                </label>
                {m && (
                  <ModelFields
                    model={m}
                    onChange={update}
                    embeddings={draft.embeddings}
                    onRemove={() => {
                      select(0);
                      patch({
                        models: draft.models.filter((_, i) => i !== selected),
                      });
                    }}
                  />
                )}
                {m && (
                  <label>
                    测试用途
                    <select
                      disabled={importing}
                      value={purpose ?? ""}
                      onChange={(e) => {
                        setTarget(e.target.value as Purpose);
                        setChecks([]);
                        setError("");
                      }}
                    >
                      {!purpose && <option value="">请选择支持用途</option>}
                      {m.capabilities.map((c) => (
                        <option key={c} value={c}>
                          {purposeNames[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {blocked && <p>{blocked}</p>}
              </>
            ) : (
              <p>获取厂商模型列表，或手动填写模型 ID 和支持用途</p>
            )}
            {checks.map((c) => (
              <div key={c.id}>
                <strong>
                  {c.model} · {purposeNames[c.purpose]}
                </strong>
                <CheckResults check={c} />
              </div>
            ))}
            {dimensionChange && (
              <Checkbox
                checked={reindex}
                onChange={(e) => setReindex(e.target.checked)}
              >
                已有资料需要重新建立索引（{embedding?.dimensions} →{" "}
                {measured?.dimensions} 维）
              </Checkbox>
            )}
            {passed && importing && (
              <div className={styles.confirm}>
                <strong>文字模型 · 所有公司立即生效</strong>
                <div>当前使用　{currentSource(data, "text")}</div>
                <div>
                  更换为　{draft.name} / {m.name}
                </div>
              </div>
            )}
          </>
        )}
      </fieldset>
      {error && <Alert type="error" showIcon title={error} />}
    </Drawer>
  );
}
