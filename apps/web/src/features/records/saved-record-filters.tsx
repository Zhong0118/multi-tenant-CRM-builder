"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Button, Input, Select, Space } from "antd";
import type { RecordQuery } from "./record-query-state";
type Saved = { name: string; query: RecordQuery };
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
            .slice(0, 20)
        : [];
    } catch {
      return [];
    }
  }, [snapshot]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState(false);
  function persist(next: Saved[]) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(STORAGE_CHANGED));
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <div aria-label="我的筛选视图">
      <Space wrap>
        <Select
          aria-label="已保存的筛选"
          placeholder="我的筛选（仅此浏览器）"
          style={{ minWidth: 220 }}
          value={selected}
          onChange={setSelected}
          options={saved.map((v) => ({ label: v.name, value: v.name }))}
        />
        <Button
          disabled={!selected}
          onClick={() => {
            const item = saved.find((v) => v.name === selected);
            if (item) onApply({ ...item.query, page: 1 });
          }}
        >
          应用筛选
        </Button>
        <Button
          disabled={!selected}
          onClick={() => {
            persist(saved.filter((v) => v.name !== selected));
            setSelected(undefined);
          }}
        >
          删除筛选
        </Button>
        <Input
          aria-label="筛选名称"
          placeholder="为当前筛选命名"
          value={name}
          maxLength={50}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          disabled={
            !name.trim() ||
            (saved.length >= 20 && !saved.some((v) => v.name === name.trim()))
          }
          onClick={() => {
            const label = name.trim();
            persist([
              ...saved.filter((v) => v.name !== label),
              { name: label, query: { ...query, page: 1 } },
            ]);
            setSelected(label);
            setName("");
          }}
        >
          保存当前筛选
        </Button>
      </Space>
      {error && (
        <Alert type="error" title="浏览器无法保存筛选，请检查存储设置。" />
      )}
    </div>
  );
}
