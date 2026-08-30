"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Input, Select, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

import { FilterBar } from "@/components/workbench/filter-bar";
import { DataPanel } from "@/components/workbench/surface";
import {
  selectOptions,
  type PublishedFieldView,
  type RecordPage,
  type RecordSummary,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { OptionBadge } from "@/features/objects/option-badge";

import type { DynamicFieldMember } from "./dynamic-field";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import {
  recordQuerySearch,
  withFilter,
  type RecordQuery,
} from "./record-query-state";

import styles from "./records.module.css";

export interface RecordListProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  query: RecordQuery;
  initialPage: RecordPage;
  members?: DynamicFieldMember[];
  canFilterByOwner?: boolean;
  api?: RecordApi;
  navigate?: (path: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The record register. Filters, sort and page live in the URL so returning from
 * a record keeps the context the member left. An `OWN` scope says so in the
 * title rather than offering an "all records" switch that would only fail.
 */
export function RecordList({
  tenantCode,
  schema,
  query,
  initialPage,
  members = [],
  canFilterByOwner = false,
  api = defaultRecordApi,
  navigate,
}: RecordListProps) {
  const router = useRouter();
  const objectCode = schema.object.code;
  const listPath = `/workspace/${tenantCode}/objects/${objectCode}`;
  const go = navigate ?? ((path: string) => router.replace(path));
  const [searchInput, setSearchInput] = useState(query.search ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const records = useQuery({
    queryKey: ["workspace", tenantCode, "records", objectCode, query],
    queryFn: () => api.list(tenantCode, objectCode, query),
    initialData: initialPage,
    staleTime: 0,
  });

  function apply(next: RecordQuery) {
    const search = recordQuerySearch(next);
    go(search === "" ? listPath : `${listPath}?${search}`);
  }

  function onSearchChange(value: string) {
    setSearchInput(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(
      () => apply(withFilter(query, { search: value.trim() || undefined })),
      SEARCH_DEBOUNCE_MS,
    );
  }

  const page = records.data ?? initialPage;
  const owned = schema.scopes.read === "OWN";
  const visibleColumns = schema.defaultView.columnFieldKeys
    .map((fieldKey) => schema.fields.find((f) => f.fieldKey === fieldKey))
    .filter((field): field is PublishedFieldView => field !== undefined);

  const columns: ColumnsType<RecordSummary> = [
    {
      title: "编号",
      key: "recordNo",
      width: 88,
      render: (_, row) => (
        <span className={styles.recordNo}>{row.recordNo}</span>
      ),
    },
    ...visibleColumns.map((field) => ({
      title: field.label,
      key: field.fieldKey,
      render: (_: unknown, row: RecordSummary) =>
        field.fieldKey === schema.object.titleFieldKey ? (
          <a
            className={styles.recordTitle}
            href={`${listPath}/${row.id}`}
            onClick={(event) => {
              event.preventDefault();
              go(`${listPath}/${row.id}`);
            }}
          >
            {row.title}
          </a>
        ) : (
          displayValue(field, row.values[field.fieldKey], members)
        ),
    })),
    {
      title: "最近更新",
      key: "updatedAt",
      width: 168,
      render: (_, row) => formatDateTime(row.updatedAt),
    },
  ];

  const filtered = Boolean(query.search || query.ownerMemberId);

  return (
    <div className={styles.list}>
      <header className={styles.listHeader}>
        <div>
          <h1>{owned ? `我的${schema.object.name}` : schema.object.name}</h1>
          {schema.object.description ? (
            <p>{schema.object.description}</p>
          ) : null}
        </div>
        {schema.actions.canCreate ? (
          <Button type="primary" onClick={() => go(`${listPath}/new`)}>
            新建{schema.object.name}
          </Button>
        ) : null}
      </header>

      <FilterBar
        ariaLabel={`${schema.object.name}筛选与排序`}
        search={
          <Input
            aria-label="搜索标题"
            placeholder={`搜索${schema.object.name}标题`}
            allowClear
            value={searchInput}
            className={styles.searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            onPressEnter={() =>
              apply(
                withFilter(query, { search: searchInput.trim() || undefined }),
              )
            }
          />
        }
        batchActions={
          <Typography.Text type="secondary">
            共 {page.total} 条 · 第 {page.page} 页
          </Typography.Text>
        }
      >
        {canFilterByOwner ? (
          <Select
            aria-label="按负责人筛选"
            placeholder="全部负责人"
            allowClear
            showSearch
            optionFilterProp="label"
            className={styles.ownerFilter}
            value={query.ownerMemberId}
            onChange={(next?: string) =>
              apply(withFilter(query, { ownerMemberId: next }))
            }
            options={members.map((member) => ({
              value: member.id,
              label: member.displayName ?? "未设置姓名",
            }))}
          />
        ) : null}
        <Select
          aria-label="排序字段"
          className={styles.sortFilter}
          value={query.sort}
          onChange={(sort: RecordQuery["sort"]) =>
            apply({ ...query, sort, page: 1 })
          }
          options={[
            { value: "updatedAt", label: "按最近更新" },
            { value: "createdAt", label: "按创建时间" },
            { value: "recordNo", label: "按记录编号" },
          ]}
        />
        <Select
          aria-label="排序方向"
          className={styles.directionFilter}
          value={query.direction}
          onChange={(direction: RecordQuery["direction"]) =>
            apply({ ...query, direction, page: 1 })
          }
          options={[
            { value: "desc", label: "降序" },
            { value: "asc", label: "升序" },
          ]}
        />
      </FilterBar>

      <DataPanel
        className={styles.registerPanel}
        ariaLabel={`${schema.object.name}记录表`}
      >
        <Table
          className={styles.register}
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={page.items}
          loading={records.isFetching}
          aria-label={`${schema.object.name}记录`}
          locale={{
            emptyText: (
              <Empty
                description={
                  filtered
                    ? "当前筛选条件没有匹配的记录。"
                    : schema.actions.canCreate
                      ? "还没有记录，新建第一条。"
                      : "还没有记录。"
                }
              />
            ),
          }}
          pagination={{
            current: page.page,
            pageSize: page.limit,
            total: page.total,
            showSizeChanger: false,
            onChange: (nextPage) => apply({ ...query, page: nextPage }),
          }}
        />
      </DataPanel>
    </div>
  );
}

export function displayValue(
  field: PublishedFieldView,
  value: unknown,
  members: DynamicFieldMember[],
): ReactNode {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "BOOLEAN":
      return value === true ? "是" : "否";
    case "SINGLE_SELECT":
      return optionValue(field, String(value));
    case "MULTI_SELECT":
      return (
        <span className={styles.optionValues}>
          {(Array.isArray(value) ? value : []).map((key) =>
            optionValue(field, String(key)),
          )}
        </span>
      );
    case "MEMBER":
      return (
        members.find((member) => member.id === value)?.displayName ??
        String(value)
      );
    case "DATETIME":
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}

function optionValue(field: PublishedFieldView, key: string): ReactNode {
  const option = selectOptions(field).find(
    (candidate) => candidate.key === key,
  );
  if (!option) return key;
  return <OptionBadge key={key} option={option} />;
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
