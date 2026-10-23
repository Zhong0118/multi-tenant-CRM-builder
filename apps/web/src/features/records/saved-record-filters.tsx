"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { DeleteOutlined, PlusOutlined, DownOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Popover, Space, Typography } from "antd";
import styles from "./records.module.css";
import type { RecordQuery } from "./record-query-state";
type Saved = { name: string; query: RecordQuery };
const MAX_SAVED = 20;
export function savedFilterKey(
  tenantCode: string,
  memberId: string,
  objectCode: string,
) {
  return `crm:saved-filters:v1:${encodeURIComponent(tenantCode)}:${encodeURIComponent(memberId)}:${encodeURIComponent(objectCode)}`;
}
type SavedRecordFilterProps = {
  tenantCode: string;
  memberId: string;
  objectCode: string;
  query: RecordQuery;
  onApply: (query: RecordQuery) => void;
  /** Render only the saved views menu or only the save button; both by default. */
  part?: "views" | "save";
};
const STORAGE_CHANGED = "crm:saved-filters-changed";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(STORAGE_CHANGED, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(STORAGE_CHANGED, listener);
  };
}
export function SavedRecordFilters(props: SavedRecordFilterProps) {
  return (
    <SavedRecordFiltersSession
      key={savedFilterKey(props.tenantCode, props.memberId, props.objectCode)}
      {...props}
    />
  );
}
function SavedRecordFiltersSession({
  tenantCode,
  memberId,
  objectCode,
  query,
  onApply,
  part,
}: SavedRecordFilterProps) {
  const key = savedFilterKey(tenantCode, memberId, objectCode);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key) ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]",
  );
  const saved = useMemo<Saved[]>(() => {
    try {
      const value: unknown = JSON.parse(snapshot);
      return Array.isArray(value)
        ? value
            .filter(
              (v): v is Saved =>
                typeof v?.name === "string" &&
                v.query &&
                typeof v.query.filters === "object",
            )
            .slice(0, MAX_SAVED)
        : [];
    } catch {
      return [];
    }
  }, [snapshot]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  function persist(next: Saved[]): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(STORAGE_CHANGED));
      setError(false);
      return true;
    } catch {
      setError(true);
      return false;
    }
  }
  const label = name.trim();
  // The view the list is showing right now, so the menu can say which one is open.
  const current = JSON.stringify({ ...query, page: 1 });
  const active =
    saved.find((view) => JSON.stringify({ ...view.query, page: 1 }) === current)
      ?.name ?? selected;
  const atLimit =
    saved.length >= MAX_SAVED && !saved.some((v) => v.name === label);
  function save() {
    if (!label || atLimit) return;
    // Keep the form open and the name typed when the browser refuses to store it.
    const stored = persist([
      ...saved.filter((v) => v.name !== label),
      { name: label, query: { ...query, page: 1 } },
    ]);
    if (!stored) return;
    setSelected(label);
    setName("");
    setSaveOpen(false);
  }
  // Nothing saved yet: the views slot takes no room in the toolbar.
  if (part === "views" && saved.length === 0) return null;
  return (
    <div aria-label="我的筛选视图" className={styles.savedFilters}>
      <Space size={2}>
        {saved.length > 0 && part !== "save" ? (
          <Popover
            trigger="click"
            placement="bottomRight"
            open={listOpen}
            onOpenChange={setListOpen}
            title="我的视图"
            content={
              <ul className={styles.savedViewList} aria-label="已保存的视图">
                {saved.map((view) => (
                  <li key={view.name}>
                    <Button
                      type="text"
                      className={styles.savedViewName}
                      aria-current={view.name === active ? "true" : undefined}
                      onClick={() => {
                        setSelected(view.name);
                        setListOpen(false);
                        onApply({ ...view.query, page: 1 });
                      }}
                    >
                      {view.name}
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      aria-label={`删除视图 ${view.name}`}
                      icon={<DeleteOutlined aria-hidden />}
                      onClick={() => {
                        persist(saved.filter((v) => v.name !== view.name));
                        if (selected === view.name) setSelected(undefined);
                      }}
                    />
                  </li>
                ))}
              </ul>
            }
          >
            <Button
              type="text"
              className={styles.savedViewTrigger}
              aria-label={active ? `我的视图：${active}` : "我的视图"}
            >
              {active ?? "我的视图"} <DownOutlined aria-hidden />
            </Button>
          </Popover>
        ) : null}
        {part !== "views" ? (
          <Popover
            trigger="click"
            placement="bottomRight"
            open={saveOpen}
            onOpenChange={setSaveOpen}
            title="保存为视图"
            content={
              <div className={styles.savedViewForm}>
                <Typography.Text type="secondary">
                  把当前搜索、筛选和排序存成视图，仅保存在此浏览器。
                </Typography.Text>
                <Input
                  aria-label="视图名称"
                  placeholder="为当前筛选命名"
                  maxLength={50}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onPressEnter={save}
                />
                {atLimit ? (
                  <Typography.Text type="danger">
                    最多保存 {MAX_SAVED} 个视图，请先删除不用的。
                  </Typography.Text>
                ) : null}
                {error ? (
                  <Alert
                    type="error"
                    title="浏览器无法保存筛选，请检查存储设置。"
                  />
                ) : null}
                <Button
                  type="primary"
                  disabled={!label || atLimit}
                  onClick={save}
                >
                  保存视图
                </Button>
              </div>
            }
          >
            <Button
              type="text"
              className={styles.savedViewTrigger}
              icon={<PlusOutlined aria-hidden />}
            >
              保存为视图
            </Button>
          </Popover>
        ) : null}
      </Space>
    </div>
  );
}
