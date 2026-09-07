"use client";

import { DeleteOutlined, EditOutlined, EyeOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  InputNumber,
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
  SORTABLE_FIELD_TYPES,
  selectOptions,
  type PublishedFieldView,
  type RecordPage,
  type RecordSummary,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { OptionBadge } from "@/features/objects/option-badge";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordBatchEditDrawer } from "./record-batch-edit";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import { recordCardFields } from "./record-card-fields";
import {
  readStoredRecordColumnKeys,
  resolveRecordColumnKeys,
  writeStoredRecordColumnKeys,
} from "./record-columns";
import { toApiError } from "@/lib/api/api-error";
import {
  booleanFilterValue,
  dateRangeFilterValue,
  DEFAULT_RECORD_QUERY,
  numericRangeFilterValue,
  optionFilterValues,
  presenceFilterValue,
  recordQuerySearch,
  relativeDateFilterValue,
  RELATIVE_DATE_PRESET_LABELS,
  RELATIVE_DATE_PRESETS,
  textContainsFilterValue,
  withFilter,
  type RecordFilterValue,
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
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [columnFieldKeys, setColumnFieldKeys] = useState(() =>
    resolveRecordColumnKeys(
      schema,
      readStoredRecordColumnKeys(tenantCode, objectCode),
    ),
  );
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const records = useQuery({
    queryKey: ["workspace", tenantCode, "records", objectCode, query],
    queryFn: () => api.list(tenantCode, objectCode, query),
    initialData: initialPage,
    staleTime: 0,
  });
  const exporting = useMutation({
    mutationFn: () =>
      api.export(tenantCode, objectCode, {
        search: query.search,
        ownerMemberId: query.ownerMemberId,
        filters: query.filters,
        sort: query.sort,
        direction: query.direction,
        columns: columnFieldKeys,
      }),
    onMutate: () => setError(undefined),
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
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

  function applyFieldFilter(
    fieldKey: string,
    value: RecordFilterValue | undefined,
  ) {
    const filters = { ...query.filters };
    if (value === undefined) delete filters[fieldKey];
    else filters[fieldKey] = value;
    apply(withFilter(query, { filters }));
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
  const visibleColumns = resolveRecordColumnKeys(schema, columnFieldKeys)
    .map((fieldKey) => schema.fields.find((field) => field.fieldKey === fieldKey))
    .filter((field): field is PublishedFieldView => field !== undefined);
  const choosableFields = schema.fields.filter(
    (field) => field.access !== "HIDDEN",
  );
  const cardFields = recordCardFields(schema, columnFieldKeys);
  const optionFilterFields = schema.fields.filter(
    (field) =>
      (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT") &&
      selectOptions(field).length > 0,
  );
  const dateFilterFields = schema.fields.filter(
    (field) => field.type === "DATE" || field.type === "DATETIME",
  );
  const numericFilterFields = schema.fields.filter(
    (field) => field.type === "NUMBER" || field.type === "MONEY",
  );
  const booleanFilterFields = schema.fields.filter(
    (field) => field.type === "BOOLEAN",
  );
  const memberFilterFields = schema.fields.filter(
    (field) => field.type === "MEMBER",
  );
  const textFilterFields = schema.fields.filter(
    (field) =>
      (field.type === "TEXT" ||
        field.type === "TEXTAREA" ||
        field.type === "PHONE" ||
        field.type === "EMAIL") &&
      field.fieldKey !== schema.object.titleFieldKey,
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
    ...visibleColumns.map((field) => {
      const sortable = (SORTABLE_FIELD_TYPES as readonly string[]).includes(
        field.type,
      );
      const sortOrder:
        | "ascend"
        | "descend"
        | null = sortable && query.sort === field.fieldKey
        ? query.direction === "asc"
          ? "ascend"
          : "descend"
        : null;
      return {
        title: field.label,
        key: field.fieldKey,
        sorter: sortable || undefined,
        sortOrder,
        sortDirections: sortable ? (["ascend", "descend"] as ("ascend" | "descend")[]) : undefined,
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
      };
    }),
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
    const sort = String(sorter.columnKey ?? "");
    const sortableColumns = new Set([
      "recordNo",
      "updatedAt",
      ...visibleColumns
        .filter((field) =>
          (SORTABLE_FIELD_TYPES as readonly string[]).includes(field.type),
        )
        .map((field) => field.fieldKey),
    ]);
    if (!sortableColumns.has(sort)) return;
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

  function saveColumns(next: string[]) {
    const resolved = resolveRecordColumnKeys(schema, next);
    setColumnFieldKeys(resolved);
    writeStoredRecordColumnKeys(tenantCode, objectCode, resolved);
  }

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
          <Space size={12}>
            <Typography.Text type="secondary">
              共 {page.total} 条 · 第 {page.page} 页
            </Typography.Text>
            {schema.actions.canUpdate ? (
              <Button
                disabled={selectedRowKeys.length === 0}
                onClick={() => setBatchOpen(true)}
              >
                批量修改{selectedRowKeys.length > 0 ? ` ${selectedRowKeys.length}` : ""}
              </Button>
            ) : null}
            <Button onClick={() => setColumnsOpen(true)}>列设置</Button>
            <Button
              onClick={() => exporting.mutate()}
              loading={exporting.isPending}
              disabled={!schema.actions.canRead || page.total === 0}
            >
              导出当前结果
            </Button>
          </Space>
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
              onChange={(values: string[]) =>
                applyFieldFilter(
                  field.fieldKey,
                  values.length === 0 ? undefined : values,
                )
              }
              options={options.map((option) => ({
                value: option.key,
                label: <OptionBadge option={option} />,
              }))}
            />
          );
        })}
        {dateFilterFields.map((field) => {
          const range = dateRangeFilterValue(query.filters, field.fieldKey);
          const relative = relativeDateFilterValue(
            query.filters,
            field.fieldKey,
          );
          return (
            <div
              key={field.fieldKey}
              role="group"
              aria-label={`按${field.label}筛选`}
              className={styles.dateFilterGroup}
            >
              <Select
                allowClear
                aria-label={`按${field.label}快捷筛选`}
                placeholder="快捷时间"
                className={styles.relativeFilter}
                value={relative}
                onChange={(next?: (typeof RELATIVE_DATE_PRESETS)[number]) =>
                  applyFieldFilter(
                    field.fieldKey,
                    next ? { relative: next } : undefined,
                  )
                }
                options={RELATIVE_DATE_PRESETS.map((preset) => ({
                  value: preset,
                  label: RELATIVE_DATE_PRESET_LABELS[preset],
                }))}
              />
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
                  const from = next?.[0]?.isValid()
                    ? next[0].format("YYYY-MM-DD")
                    : undefined;
                  const to = next?.[1]?.isValid()
                    ? next[1].format("YYYY-MM-DD")
                    : undefined;
                  applyFieldFilter(
                    field.fieldKey,
                    !from && !to ? undefined : { from, to },
                  );
                }}
              />
            </div>
          );
        })}
        {numericFilterFields.map((field) => {
          const range = numericRangeFilterValue(query.filters, field.fieldKey);
          const money = field.type === "MONEY";
          return (
            <div
              key={field.fieldKey}
              role="group"
              aria-label={`按${field.label}筛选`}
              className={styles.numericFilter}
            >
              <InputNumber
                aria-label={`${field.label}最小值`}
                placeholder={`${field.label}最小`}
                value={range?.min}
                min={field.validation.min}
                max={field.validation.max}
                precision={money ? (field.validation.scale ?? 2) : undefined}
                onChange={(next) => {
                  const min = typeof next === "number" ? next : undefined;
                  const max = range?.max;
                  applyFieldFilter(
                    field.fieldKey,
                    min === undefined && max === undefined
                      ? undefined
                      : { min, max },
                  );
                }}
              />
              <span aria-hidden>至</span>
              <InputNumber
                aria-label={`${field.label}最大值`}
                placeholder={`${field.label}最大`}
                value={range?.max}
                min={field.validation.min}
                max={field.validation.max}
                precision={money ? (field.validation.scale ?? 2) : undefined}
                onChange={(next) => {
                  const min = range?.min;
                  const max = typeof next === "number" ? next : undefined;
                  applyFieldFilter(
                    field.fieldKey,
                    min === undefined && max === undefined
                      ? undefined
                      : { min, max },
                  );
                }}
              />
            </div>
          );
        })}
        {booleanFilterFields.map((field) => (
          <Select
            key={field.fieldKey}
            allowClear
            aria-label={`按${field.label}筛选`}
            placeholder={`全部${field.label}`}
            className={styles.booleanFilter}
            value={booleanFilterValue(query.filters, field.fieldKey)}
            onChange={(next?: boolean) =>
              applyFieldFilter(field.fieldKey, next)
            }
            options={[
              { value: true, label: "是" },
              { value: false, label: "否" },
            ]}
          />
        ))}
        {memberFilterFields.map((field) => (
          <Select
            key={field.fieldKey}
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label={`按${field.label}筛选`}
            placeholder={`全部${field.label}`}
            className={styles.ownerFilter}
            value={optionFilterValues(query.filters, field.fieldKey)}
            onChange={(values: string[]) =>
              applyFieldFilter(
                field.fieldKey,
                values.length === 0 ? undefined : values,
              )
            }
            options={members.map((member) => ({
              value: member.id,
              label: member.displayName ?? "未设置姓名",
            }))}
          />
        ))}
        {textFilterFields.map((field) => (
          <div key={field.fieldKey} className={styles.textFilterGroup}>
            <Select
              allowClear
              aria-label={`按${field.label}填充筛选`}
              placeholder="有值或空值"
              className={styles.presenceFilter}
              value={presenceFilterValue(query.filters, field.fieldKey)}
              onChange={(next?: "empty" | "not_empty") =>
                applyFieldFilter(
                  field.fieldKey,
                  next ? { presence: next } : undefined,
                )
              }
              options={[
                { value: "not_empty", label: "有值" },
                { value: "empty", label: "空值" },
              ]}
            />
            <Input
              allowClear
              aria-label={`按${field.label}筛选`}
              placeholder={`${field.label}包含`}
              className={styles.searchInput}
              value={
                textContainsFilterValue(query.filters, field.fieldKey) ?? ""
              }
              onChange={(event) => {
                const next = event.target.value.trim();
                applyFieldFilter(
                  field.fieldKey,
                  next === "" ? undefined : { contains: next },
                );
              }}
            />
          </div>
        ))}
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
          rowSelection={
            schema.actions.canUpdate
              ? {
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys.map(String)),
                  getCheckboxProps: (row) => ({
                    "aria-label": `选择 ${row.title}`,
                  }),
                }
              : undefined
          }
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

      <Drawer
        title="列设置"
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          只影响你自己看到和导出的列，不会改业务表发布时的默认列表。隐藏字段不会出现在这里。
        </Typography.Paragraph>
        <div className={styles.columnChooser}>
          {choosableFields.map((field) => {
            const selected = columnFieldKeys.includes(field.fieldKey);
            return (
              <label key={field.fieldKey} className={styles.columnChooserRow}>
                <input
                  type="checkbox"
                  aria-label={`显示列 ${field.label}`}
                  checked={selected}
                  onChange={(event) =>
                    saveColumns(
                      event.target.checked
                        ? [...columnFieldKeys, field.fieldKey]
                        : columnFieldKeys.filter(
                            (fieldKey) => fieldKey !== field.fieldKey,
                          ),
                    )
                  }
                />
                <span>{field.label}</span>
                <code>{field.fieldKey}</code>
              </label>
            );
          })}
        </div>
        <Button
          className={styles.columnReset}
          onClick={() => saveColumns(schema.defaultView.columnFieldKeys)}
        >
          恢复默认列
        </Button>
      </Drawer>

      {batchOpen ? (
        <RecordBatchEditDrawer
          tenantCode={tenantCode}
          schema={schema}
          records={page.items.filter((item) => selectedRowKeys.includes(item.id))}
          members={members}
          canChooseOwner={canFilterByOwner}
          api={api}
          onClose={() => setBatchOpen(false)}
          onCompleted={async () => {
            setBatchOpen(false);
            setSelectedRowKeys([]);
            await records.refetch();
            router.refresh();
          }}
        />
      ) : null}
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
