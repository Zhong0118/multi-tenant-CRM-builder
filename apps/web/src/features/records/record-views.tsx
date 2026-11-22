"use client";

import {
  CheckOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dropdown,
  Input,
  Modal,
  Radio,
  type MenuProps,
} from "antd";
import { useEffect, useRef, useState } from "react";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";
import {
  recordViewApi,
  recordViewsKey,
  type RecordView,
  type RecordViewDraft,
} from "./record-view-api";
import {
  importLegacyViews,
  readLegacyViews,
  viewError,
} from "./record-view-import";
import { savedFilterKey } from "./saved-record-filters";
import styles from "./record-views.module.css";

type PickerProps = {
  tenantCode: string;
  objectCode: string;
  memberId?: string;
  schema: RuntimeObjectSchema;
  views: RecordView[];
  current?: RecordView | null;
  dirty: boolean;
  draft: RecordViewDraft;
  isAdmin: boolean;
  onSelect: (view: RecordView | undefined) => void;
};
type Dialog = "switch" | "create" | "manage" | "archive" | "rename" | "import";

export function RecordViewPicker(props: PickerProps) {
  return (
    <ViewPickerSession
      key={JSON.stringify([props.tenantCode, props.objectCode, props.memberId])}
      {...props}
    />
  );
}

function ViewPickerSession({
  tenantCode,
  objectCode,
  memberId,
  schema,
  views,
  current,
  dirty,
  draft,
  isAdmin,
  onSelect,
}: PickerProps) {
  const client = useQueryClient();
  const key = recordViewsKey(tenantCode, objectCode, memberId);
  const legacyKey = memberId
    ? savedFilterKey(tenantCode, memberId, objectCode)
    : undefined;
  const [legacyCount, setLegacyCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [target, setTarget] = useState<RecordView>();
  const [nextView, setNextView] = useState<RecordView>();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<RecordView["scope"]>("PERSONAL");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const clean = useRef(current);
  useEffect(() => {
    if (!dirty || current?.id !== clean.current?.id) clean.current = current;
  }, [current, dirty]);
  useEffect(() => {
    if (!legacyKey) return;
    try {
      const count = readLegacyViews(legacyKey).length;
      // This browser preference is first available after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLegacyCount(count);
      if (count && !localStorage.getItem(legacyKey + ":offered")) {
        setDialog("import");
        localStorage.setItem(legacyKey + ":offered", "1");
      }
    } catch {
      /* Browser storage is optional. Server views remain available. */
    }
  }, [legacyKey]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function remember(view: RecordView) {
    client.setQueryData<RecordView[]>(key, (old) => {
      const rows = old ?? views;
      return rows.some((row) => row.id === view.id)
        ? rows.map((row) => (row.id === view.id ? view : row))
        : [...rows, view];
    });
  }
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(viewError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function openCreate(next?: RecordView) {
    setError("");
    setNextView(next);
    setScope("PERSONAL");
    setName("");
    setDialog("create");
  }
  function finish(view: RecordView | undefined) {
    setDialog(null);
    setError("");
    setNextView(undefined);
    onSelect(view);
  }
  async function save(next?: RecordView) {
    const source = clean.current;
    if (!source?.canEdit) {
      openCreate(next);
      return;
    }
    await run(async () => {
      // Patching unchanged inherited columns or sort would freeze a preset at the current publication.
      const { columnFieldKeys, sort, ...settings } = draft;
      const updated = await recordViewApi.update(
        tenantCode,
        objectCode,
        source.id,
        {
          ...settings,
          expectedRevision: source.revision,
          ...(JSON.stringify(columnFieldKeys) !==
            JSON.stringify(source.columnFieldKeys) && { columnFieldKeys }),
          ...(sort.field !== source.sort?.field ||
          sort.direction !== source.sort.direction
            ? { sort }
            : {}),
        },
      );
      remember(updated);
      void client.invalidateQueries({
        queryKey: ["workspace", tenantCode, "records", objectCode],
      });
      finish(next ?? updated);
    });
  }
  function switchTo(view: RecordView) {
    if (!view.available || view.id === current?.id) return;
    setError("");
    if (!dirty) {
      finish(view);
      return;
    }
    setNextView(view);
    setDialog("switch");
  }
  async function commitForm() {
    const label = name.trim();
    if (!label) return;
    await run(async () => {
      if (dialog === "rename" && target) {
        const updated = await recordViewApi.update(
          tenantCode,
          objectCode,
          target.id,
          { name: label, expectedRevision: target.revision },
        );
        remember(updated);
        setDialog("manage");
        return;
      }
      const created = await recordViewApi.create(tenantCode, objectCode, {
        ...draft,
        name: label,
        scope,
      });
      remember(created);
      finish(nextView ?? created);
    });
  }
  async function archive() {
    if (!target?.canEdit) return;
    await run(async () => {
      await recordViewApi.archive(
        tenantCode,
        objectCode,
        target.id,
        target.revision,
      );
      const remaining = (
        client.getQueryData<RecordView[]>(key) ?? views
      ).filter((view) => view.id !== target.id);
      client.setQueryData(key, remaining);
      if (target.id === current?.id)
        finish(
          remaining.find((view) => view.available && view.code === "all") ??
            remaining.find((view) => view.available),
        );
      else setDialog("manage");
    });
  }
  function showImport() {
    setDialog("import");
    setError("");
    setFailures([]);
  }
  async function importViews() {
    if (!legacyKey || !memberId) return;
    await run(async () => {
      const results = await importLegacyViews(
        legacyKey,
        tenantCode,
        objectCode,
        schema,
        memberId,
        remember,
      );
      setFailures(results);
      setLegacyCount(readLegacyViews(legacyKey).length);
      if (!results.length) setDialog(null);
    });
  }
  async function reload() {
    await run(async () => {
      const rows = await recordViewApi.list(tenantCode, objectCode);
      client.setQueryData(key, rows);
      const latest = rows.find(
        (view) => view.id === current?.id && view.available,
      );
      finish(latest ?? rows.find((view) => view.available));
    });
  }

  const items: MenuProps["items"] = [];
  for (const [scope, label] of [
    ["SHARED", "团队视图"],
    ["PERSONAL", "个人视图"],
  ] as const) {
    const group = views.filter((view) => view.scope === scope);
    if (group.length)
      items.push({
        type: "group",
        label,
        children: group.map((view) => ({
          key: view.id,
          disabled: !view.available,
          label: (
            <span>
              {view.name}
              {!view.available && (
                <small className={styles.reason}>该视图条件不可用</small>
              )}
            </span>
          ),
          icon: view.id === current?.id ? <CheckOutlined /> : undefined,
          onClick: () => switchTo(view),
        })),
      });
  }
  if (items.length) items.push({ type: "divider" });
  if (dirty && current?.canEdit) items.push({ key: "save", label: "保存修改" });
  items.push({
    key: "create",
    label: "另存为新视图",
    onClick: () => openCreate(),
  });
  if (views.some((view) => view.canEdit))
    items.push({
      key: "manage",
      label: "管理视图",
      onClick: () => {
        setError("");
        setDialog("manage");
      },
    });
  if (legacyCount)
    items.push({ key: "import", label: "导入本机方案", onClick: showImport });
  const form = dialog === "create" || dialog === "rename";
  const title =
    dialog === "switch"
      ? "保留当前修改？"
      : dialog === "archive"
        ? "归档视图？"
        : dialog === "import"
          ? "导入本机筛选方案"
          : dialog === "rename"
            ? "重命名视图"
            : dialog === "create"
              ? "另存为新视图"
              : "管理视图";
  const errorNotice = error && (
    <Alert
      type="error"
      showIcon
      title={error}
      action={
        <Button size="small" onClick={() => void reload()} disabled={busy}>
          重新加载
        </Button>
      }
    />
  );
  return (
    <div className={styles.picker}>
      <Dropdown
        trigger={["click"]}
        autoFocus
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={{
          items,
          selectable: true,
          selectedKeys: current ? [current.id] : [],
          onClick: ({ key }) => {
            setMenuOpen(false);
            if (key === "save") void save();
          },
        }}
        disabled={busy}
      >
        <Button
          className={styles.trigger}
          icon={<TableOutlined />}
          aria-label="切换记录视图"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-description={
            (current?.name ?? "全部（按权限）") + (dirty ? "，已修改" : "")
          }
          title={current?.name}
        >
          <span className={styles.triggerText}>
            <span>{current?.name ?? "全部（按权限）"}</span>
            {dirty && <small>已修改</small>}
          </span>
          <DownOutlined className={styles.caret} />
        </Button>
      </Dropdown>
      {dirty && (
        <div className={styles.changed}>
          {current?.canEdit && (
            <Button
              type="link"
              size="small"
              disabled={busy}
              onClick={() => void save()}
            >
              保存
            </Button>
          )}
          <Button
            type="link"
            size="small"
            disabled={busy}
            onClick={() => openCreate()}
          >
            另存为
          </Button>
        </div>
      )}
      {!dialog && errorNotice}
      <Modal
        open={dialog !== null}
        title={title}
        width={420}
        closable={!busy}
        mask={{ closable: !busy }}
        keyboard={!busy}
        onCancel={() => {
          if (!busy) {
            setDialog(null);
            setError("");
          }
        }}
        footer={null}
      >
        {dialog && errorNotice}
        {dialog === "switch" && (
          <>
            <p>切换到「{nextView?.name}」前，可先保存当前修改。</p>
            <div className={styles.actions}>
              <Button disabled={busy} onClick={() => setDialog(null)}>
                返回
              </Button>
              <Button disabled={busy} onClick={() => finish(nextView)}>
                放弃修改
              </Button>
              <Button
                type="primary"
                loading={busy}
                onClick={() => void save(nextView)}
              >
                {current?.canEdit ? "保存并切换" : "另存并切换"}
              </Button>
            </div>
          </>
        )}
        {form && (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void commitForm();
            }}
          >
            <label>
              视图名称
              <Input
                autoFocus
                maxLength={100}
                value={name}
                aria-label="视图名称"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {dialog === "create" && isAdmin && (
              <Radio.Group
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                options={[
                  { value: "PERSONAL", label: "个人视图" },
                  { value: "SHARED", label: "团队共享" },
                ]}
              />
            )}
            <div className={styles.actions}>
              <Button disabled={busy} onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={busy}
                disabled={!name.trim()}
              >
                保存视图
              </Button>
            </div>
          </form>
        )}
        {dialog === "manage" && (
          <ul className={styles.list}>
            {views
              .filter((v) => v.canEdit)
              .map((v) => (
                <li key={v.id}>
                  <span>
                    {v.name}
                    <small className={styles.reason}>
                      {v.scope === "PERSONAL" ? "个人" : "团队"}
                    </small>
                  </span>
                  {v.available && (
                    <Button
                      type="text"
                      aria-label={`重命名 ${v.name}`}
                      icon={<EditOutlined />}
                      onClick={() => {
                        setTarget(v);
                        setName(v.name);
                        setDialog("rename");
                      }}
                    />
                  )}
                  <Button
                    type="text"
                    danger
                    aria-label={`归档 ${v.name}`}
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      setTarget(v);
                      setDialog("archive");
                    }}
                  />
                </li>
              ))}
          </ul>
        )}
        {dialog === "archive" && (
          <>
            <p>
              「{target?.name}」将从视图列表移除。
              {dirty && target?.id === current?.id
                ? "当前未保存的修改也会丢失。"
                : ""}
            </p>
            <div className={styles.actions}>
              <Button disabled={busy} onClick={() => setDialog("manage")}>
                返回
              </Button>
              <Button
                danger
                type="primary"
                loading={busy}
                onClick={() => void archive()}
              >
                归档视图
              </Button>
            </div>
          </>
        )}
        {dialog === "import" && (
          <>
            <p>把本机保存的 {legacyCount} 个筛选方案导入为个人视图</p>
            {failures.length > 0 && (
              <div role="status">
                <p>以下方案仍保留在本机</p>
                <ul>
                  {failures.map((failure, i) => (
                    <li key={i}>{failure}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className={styles.actions}>
              <Button disabled={busy} onClick={() => setDialog(null)}>
                稍后
              </Button>
              <Button
                type="primary"
                loading={busy}
                onClick={() => void importViews()}
              >
                导入为个人视图
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
