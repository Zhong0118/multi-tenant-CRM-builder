"use client";

import { DeleteOutlined, EditOutlined, EyeOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
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
import { recordCardFields } from "./record-card-fields";
import { toApiError } from "@/lib/api/api-error";
import {
  dateRangeFilterValue,
  DEFAULT_RECORD_QUERY,
  optionFilterValues,
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
  const queryDefaults: RecordQuery = {
    ...DEFAULT_RECORD_QUERY,
    sort: schema.defaultView.sort.field,
    direction: schema.defaultView.sort.direction,
  };
  const go = navigate ?? ((path: string) => router.replace(path));
  const [searchInput, setSearchInput] = useState(query.search ?? "");
  const [error, setError] = useState<string>();
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const records = useQuery({
    queryKey: ["workspace", tenantCode, "records", objectCode, query],
    queryFn: () => api.list(tenantCode, objectCode, query),
    initialData: initialPage,
    staleTime: 0,
  });
  const remove = useMutation({
    mutationFn: (record: RecordSummary) =>
      api.remove(tenantCode, objectCode, record.id, record.version),
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      await records.refetch();
      router.refresh();
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  function apply(next: RecordQuery) {
    const search = recordQuerySearch(next, queryDefaults);
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

  function recordPath(recordId: string, mode?: "edit") {
    const params = new URLSearchParams(recordQuerySearch(query, queryDefaults));
    if (mode) params.set("mode", mode);
    const search = params.toString();
    return `${listPath}/${recordId}${search ? `?${search}` : ""}`;
  }

  const page = records.data ?? initialPage;
  const owned = schema.scopes.read === "OWN";
  const visibleColumns = schema.defaultView.columnFieldKeys
    .map((fieldKey) => schema.fields.find((f) => f.fieldKey === fieldKey))
    .filter((field): field is PublishedFieldView => field !== undefined);
  const optionFilterFields = schema.fields.filter(
    (field) =>
      (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT") &&
      selectOptions(field).length > 0,
  );
  const dateFilterFields = schema.fields.filter(
    (field) => field.type === "DATE" || field.type === "DATETIME",
  );
  const searchFieldLabels = schema.fields
    .filter(
      (field) =>
        field.fieldKey === schema.object.titleFieldKey ||
        (schema.defaultView.columnFieldKeys.includes(field.fieldKey) &&
          (field.type === "TEXT" ||
            field.type === "TEXTAREA" ||
            field.type === "PHONE" ||
            field.type === "EMAIL")),
    )
    .map((field) => field.label);
  const searchLabel =
    searchFieldLabels.length > 0
      ? `搜索${searchFieldLabels.join("、")}`
      : `搜索${schema.object.name}标题`;

  const columns: ColumnsType<RecordSummary> = [
    {
      title: "序号",
      key: "rowIndex",
      width: 64,
      align: "center",
      render: (_value, _row, index) => (
        <span className={styles.rowIndex}>
          {(page.page - 1) * page.limit + index + 1}
        </span>
      ),
    },
    {
      title: "业务编号",
      key: "recordNo",
      dataIndex: "recordNo",
      width: 104,
      sorter: true,
      sortOrder:
        query.sort === "recordNo"
          ? query.direction === "asc"
            ? "ascend"
            : "descend"
          : null,
      sortDirections: ["ascend", "descend"],
      render: (recordNo: string) => (
        <span className={styles.recordNo}>{recordNo}</span>
      ),
    },
    ...visibleColumns.map((field) => ({
      title: field.label,
      key: field.fieldKey,
      render: (_: unknown, row: RecordSummary) =>
        field.fieldKey === schema.object.titleFieldKey ? (
          <a
            className={styles.recordTitle}
            href={recordPath(row.id)}
            onClick={(event) => {
              event.preventDefault();
              go(recordPath(row.id));
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
      dataIndex: "updatedAt",
      width: 168,
      sorter: true,
      sortOrder:
        query.sort === "updatedAt"
          ? query.direction === "asc"
            ? "ascend"
            : "descend"
          : null,
      sortDirections: ["ascend", "descend"],
      render: (updatedAt: string) => formatDateTime(updatedAt),
    },
    {
      title: "操作",
      key: "actions",
      width: 124,
      fixed: "right",
      render: (_, row) => recordActions(row),
    },
  ];

  const handleTableChange: TableProps<RecordSummary>["onChange"] = (
    _pagination,
    _filters,
    sorter,
    extra,
  ) => {
    if (extra.action !== "sort" || Array.isArray(sorter)) {
      return;
    }
    if (!sorter.order) {
      apply({
        ...query,
        page: 1,
        sort: schema.defaultView.sort.field,
        direction: schema.defaultView.sort.direction,
      });
      return;
    }
    const sort = sorter.columnKey;
    if (sort !== "recordNo" && sort !== "updatedAt") return;
    apply({
      ...query,
      page: 1,
      sort,
      direction: sorter.order === "ascend" ? "asc" : "desc",
    });
  };

  const filtered = Boolean(
    query.search ||
    query.ownerMemberId ||
    Object.keys(query.filters).length > 0,
  );
  const cardFields = recordCardFields(schema);

  function recordActions(row: RecordSummary) {
    return (
      <Space size={2} className={styles.rowActions}>
        <Tooltip title="查看">
          <Button
            type="text"
            size="small"
            className={styles.rowActionButton}
            aria-label={`查看 ${row.title}`}
            icon={<EyeOutlined />}
            onClick={() => go(recordPath(row.id))}
          />
        </Tooltip>
        <Tooltip title={schema.actions.canUpdate ? "编辑" : "无编辑权限"}>
          <span className={styles.actionSlot}>
            <Button
              type="text"
              size="small"
              className={styles.rowActionButton}
              aria-label={`编辑 ${row.title}`}
              icon={<EditOutlined />}
              disabled={!schema.actions.canUpdate}
              onClick={() => go(recordPath(row.id, "edit"))}
            />
          </span>
        </Tooltip>
        {schema.actions.canDelete ? (
          <Popconfirm
            title={`确认删除 ${row.title}？`}
            description="删除后业务列表不再显示，审计历史仍会保留。"
            okText="确认删除"
            cancelText="取消"
            onConfirm={() => remove.mutate(row)}
          >
            <Tooltip title="删除">
              <Button
                danger
                type="text"
                size="small"
                className={styles.rowActionButton}
                aria-label={`删除 ${row.title}`}
                icon={<DeleteOutlined />}
                loading={remove.isPending && remove.variables?.id === row.id}
              />
            </Tooltip>
          </Popconfirm>
        ) : (
          <Tooltip title="无删除权限">
            <span className={styles.actionSlot}>
              <Button
                danger
                disabled
                type="text"
                size="small"
                className={styles.rowActionButton}
                aria-label={`删除 ${row.title}`}
                icon={<DeleteOutlined />}
              />
            </span>
          </Tooltip>
        )}
      </Space>
    );
  }

  return (
    <div className={styles.list}>
      {error ? <Alert type="error" showIcon title={error} /> : null}
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
            aria-label={searchLabel}
            placeholder={searchLabel}
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
        {optionFilterFields.map((field) => {
          const options = selectOptions(field);
          return (
            <Select
              key={field.fieldKey}
              mode="multiple"
              aria-label={`按${field.label}筛选`}
              placeholder={`全部${field.label}`}
              allowClear
              className={styles.optionFilter}
              value={optionFilterValues(query.filters, field.fieldKey)}
              onChange={(values: string[]) => {
                const filters = { ...query.filters };
                if (values.length === 0) delete filters[field.fieldKey];
                else filters[field.fieldKey] = values;
                apply(withFilter(query, { filters }));
              }}
              options={options.map((option) => ({
                value: option.key,
                label: <OptionBadge option={option} />,
              }))}
            />
          );
        })}
        {dateFilterFields.map((field) => {
          const range = dateRangeFilterValue(query.filters, field.fieldKey);
          return (
            <div
              key={field.fieldKey}
              role="group"
              aria-label={`按${field.label}筛选`}
            >
              <DatePicker.RangePicker
                allowEmpty={[true, true]}
                allowClear
                className={styles.dateFilter}
                separator="至"
                placeholder={[`${field.label}起`, `${field.label}止`]}
                value={[
                  range?.from ? dayjs(range.from) : null,
                  range?.to ? dayjs(range.to) : null,
                ]}
                onChange={(next: [Dayjs | null, Dayjs | null] | null) => {
                  const filters = { ...query.filters };
                  const from = next?.[0]?.isValid()
                    ? next[0].format("YYYY-MM-DD")
                    : undefined;
                  const to = next?.[1]?.isValid()
                    ? next[1].format("YYYY-MM-DD")
                    : undefined;
                  if (!from && !to) delete filters[field.fieldKey];
                  else filters[field.fieldKey] = { from, to };
                  apply(withFilter(query, { filters }));
                }}
              />
            </div>
          );
        })}
        {Object.keys(query.filters).length > 0 ? (
          <Button
            type="text"
            onClick={() => apply(withFilter(query, { filters: {} }))}
          >
            清除筛选
          </Button>
        ) : null}
      </FilterBar>

      <DataPanel
        className={styles.registerPanel}
        ariaLabel={`${schema.object.name}记录表`}
      >
        {page.items.length === 0 ? (
          <Empty
            description={
              filtered
                ? "当前筛选条件没有匹配的记录。"
                : schema.actions.canCreate
                  ? "还没有记录，新建第一条。"
                  : "还没有记录。"
            }
          />
        ) : (
          <ul
            className={styles.cardList}
            aria-label={`${schema.object.name}记录卡片`}
          >
            {page.items.map((row) => {
              const ownerName = row.ownerMemberId
                ? (members.find((member) => member.id === row.ownerMemberId)
                    ?.displayName ?? "未设置姓名")
                : "未指定";
              return (
                <li key={row.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <a
                      className={styles.recordTitle}
                      href={recordPath(row.id)}
                      onClick={(event) => {
                        event.preventDefault();
                        go(recordPath(row.id));
                      }}
                    >
                      {row.title}
                    </a>
                    {cardFields.status
                      ? displayValue(
                          cardFields.status,
                          row.values[cardFields.status.fieldKey],
                          members,
                        )
                      : null}
                  </div>
                  <dl className={styles.cardMeta}>
                    <div>
                      <dt>业务编号</dt>
                      <dd className={styles.recordNo}>{row.recordNo}</dd>
                    </div>
                    <div>
                      <dt>负责人</dt>
                      <dd>{ownerName}</dd>
                    </div>
                    {cardFields.extras.map((field) => (
                      <div key={field.fieldKey}>
                        <dt>{field.label}</dt>
                        <dd>
                          {displayValue(
                            field,
                            row.values[field.fieldKey],
                            members,
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {recordActions(row)}
                </li>
              );
            })}
          </ul>
        )}
        <Table
          className={styles.register}
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={page.items}
          loading={records.isFetching}
          onChange={handleTableChange}
          scroll={{ x: "max-content" }}
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
