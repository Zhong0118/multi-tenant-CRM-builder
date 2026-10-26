"use client";

import {
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  FilterOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  TableOutlined,
  UploadOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Pagination,
  Popover,
  Segmented,
  Select,
  Table,
} from "antd";
import type { MenuProps, TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import type React from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ObjectIcon } from "@/components/navigation/object-icon";
import {
  SORTABLE_FIELD_TYPES,
  selectOptions,
  type PublishedFieldView,
  type RecordPage,
  type RecordSummary,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type { DynamicFieldMember } from "./dynamic-field";
import { canEditRecord } from "./record-access";
import { recordApi as defaultRecordApi, type RecordApi } from "./record-api";
import {
  MAX_OWNER_ASSIGNMENT_RECORDS,
  RecordBatchAssignDrawer,
} from "./record-batch-assign";
import { RecordBatchEditDrawer } from "./record-batch-edit";
import {
  MAX_DELETE_RECORDS,
  RecordBatchDeleteDrawer,
} from "./record-batch-delete";
import { recordCardFields } from "./record-card-fields";
import { CellReaderProvider, RecordCellValue } from "./record-cell";
import {
  clampToBounds,
  fieldColumnBounds,
  SYSTEM_COLUMN_BOUNDS,
  type ColumnBounds,
} from "./record-column-layout";
import {
  resolveColumnOrder,
  SYSTEM_COLUMN_LABELS,
  systemColumnKey,
  type SystemColumnKey,
} from "./record-column-order";
import { resolveRecordColumnKeys } from "./record-columns";
import { useRecordDisplayPrefs } from "./record-display-prefs";
import { RecordDisplaySettings } from "./record-display-settings";
import {
  displayValue,
  formatDateTime,
  RecordOwner,
} from "./record-display-value";
import {
  describeFilter,
  filterableFields,
  OptionQuickFilter,
  RecordFilterPopover,
} from "./record-filter-controls";
import { RecordImportDrawer } from "./record-import";
import { RecordOwnershipActions, RecordPoolStatus } from "./record-pool";
import {
  DEFAULT_POOL_LABELS,
  POOL_STAGES,
  POOL_LABEL_KEYS,
  type PoolStageFilter,
  type RecordPoolConfig,
} from "./record-pool-types";
import {
  DEFAULT_RECORD_QUERY,
  recordQuerySearch,
  withFilter,
  type RecordFilterValue,
  type RecordQuery,
} from "./record-query-state";
import { RecordRowActions } from "./record-row-actions";
import { ResizableHeaderCell } from "./resizable-columns";
import { SavedRecordFilters } from "./saved-record-filters";
import rl from "./record-list.module.css";
import styles from "./records.module.css";
import { memberSelectOptions } from "@/components/identity/member-identity";
export { displayValue } from "./record-display-value";

export interface RecordListProps {
  tenantCode: string;
  currentMemberId?: string;
  schema: RuntimeObjectSchema;
  query: RecordQuery;
  initialPage: RecordPage;
  members?: DynamicFieldMember[];
  canFilterByOwner?: boolean;
  poolConfig?: RecordPoolConfig;
  onPoolSettings?: () => void;
  api?: RecordApi;
  navigate?: (path: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

type RecordColumn = ColumnsType<RecordSummary>[number];

/**
 * The record register. Filters, sort and page live in the URL so returning from
 * a record keeps the context the member left. An `OWN` scope says so in the
 * title rather than offering an "all records" switch that would only fail.
 */
export function RecordList({
  tenantCode,
  currentMemberId,
  schema,
  query,
  initialPage,
  members = [],
  canFilterByOwner = false,
  poolConfig,
  onPoolSettings,
  api = defaultRecordApi,
  navigate,
}: RecordListProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const objectCode = schema.object.code;
  const listPath = `/workspace/${tenantCode}/objects/${objectCode}`;
  const queryDefaults: RecordQuery = {
    ...DEFAULT_RECORD_QUERY,
    sort: schema.defaultView.sort.field,
    direction: schema.defaultView.sort.direction,
  };
  const go = navigate ?? ((path: string) => router.replace(path));
  const [error, setError] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [assignmentRecords, setAssignmentRecords] = useState<RecordSummary[]>();
  const [deletionRecords, setDeletionRecords] = useState<RecordSummary[]>();
  const [batchOpen, setBatchOpen] = useState(false);
  const selectionScope = `${tenantCode}:${objectCode}:${recordQuerySearch(query, queryDefaults)}`;
  const [previousSelectionScope, setPreviousSelectionScope] =
    useState(selectionScope);
  if (previousSelectionScope !== selectionScope) {
    setPreviousSelectionScope(selectionScope);
    setSelectedRowKeys([]);
    setBatchOpen(false);
    setAssignmentRecords(undefined);
    setDeletionRecords(undefined);
  }
  const [importOpen, setImportOpen] = useState(false);
  // Columns, widths, order and reading density for this member and table.
  // The first render uses the published defaults (as the server does) and the
  // stored choice applies after mount, so hydration never disagrees.
  const display = useRecordDisplayPrefs(
    tenantCode,
    currentMemberId,
    objectCode,
  );
  const columnFieldKeys = useMemo(
    () => resolveRecordColumnKeys(schema, display.prefs.columns),
    [schema, display.prefs.columns],
  );

  const records = useQuery({
    queryKey: ["workspace", tenantCode, "records", objectCode, query],
    queryFn: () => api.list(tenantCode, objectCode, query),
    enabled:
      (query.scope !== "pool" &&
        query.poolStage !== "LEAD_POOL" &&
        query.poolStage !== "CUSTOMER_POOL") ||
      poolConfig?.enabled !== false,
    initialData: initialPage,
    staleTime: 0,
  });
  const exporting = useMutation({
    mutationFn: () =>
      api.export(tenantCode, objectCode, {
        search: query.search,
        scope: query.scope,
        poolStage: query.poolStage,
        poolQuality: query.poolQuality,
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

  // Any other navigation (sort, filter, page) drops a search still being typed.
  const [navigation, setNavigation] = useState(0);
  function apply(next: RecordQuery, fromSearch = false) {
    if (!fromSearch) setNavigation((count) => count + 1);
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

  function recordPath(recordId: string, mode?: "edit") {
    const params = new URLSearchParams(recordQuerySearch(query, queryDefaults));
    if (mode) params.set("mode", mode);
    const search = params.toString();
    return `${listPath}/${recordId}${search ? `?${search}` : ""}`;
  }

  const page = records.data ?? initialPage;
  // The phone cards repeat every row and a desktop never shows them, so they
  // are only built on a narrow screen, after hydration. Until then a phone
  // shows the table (see .data:has(.cards) in the stylesheet).
  const showCards = useSyncExternalStore(
    subscribeWide,
    () => !isWide(),
    () => false,
  );
  const editableRecord = (row: RecordSummary) =>
    canEditRecord(schema, row, currentMemberId, canFilterByOwner);
  const canSelect = schema.actions.canUpdate || schema.actions.canDelete;
  const selectableRecord = (row: RecordSummary) =>
    schema.actions.canDelete || editableRecord(row);
  const selectedRecords = page.items.filter(
    (item) => selectedRowKeys.includes(item.id) && selectableRecord(item),
  );
  const currentSelectedRowKeys = selectedRecords.map((item) => item.id);
  const owned = schema.scopes.read === "OWN";
  const showOwner = !owned && display.prefs.ownerVisible;
  const visibleColumns = resolveRecordColumnKeys(schema, columnFieldKeys)
    .map((fieldKey) =>
      schema.fields.find((field) => field.fieldKey === fieldKey),
    )
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

  const columnBounds: Record<string, ColumnBounds> = {
    ...SYSTEM_COLUMN_BOUNDS,
  };
  for (const field of visibleColumns) {
    columnBounds[field.fieldKey] = fieldColumnBounds(
      field.type,
      field.fieldKey === schema.object.titleFieldKey,
    );
  }
  const columnWidth = (key: string) => {
    const bounds = columnBounds[key];
    return clampToBounds(display.prefs.widths[key] ?? bounds.width, bounds);
  };
  const columnDensity = (key: string) =>
    display.prefs.columnDensity[key] ?? display.prefs.density;

  const fieldColumn = (field: PublishedFieldView): RecordColumn => {
    const sortable = (SORTABLE_FIELD_TYPES as readonly string[]).includes(
      field.type,
    );
    const sortOrder: "ascend" | "descend" | null =
      sortable && query.sort === field.fieldKey
        ? query.direction === "asc"
          ? "ascend"
          : "descend"
        : null;
    const width = columnWidth(field.fieldKey);
    const density = columnDensity(field.fieldKey);
    return {
      title: field.label,
      key: field.fieldKey,
      width,
      align:
        field.type === "MONEY" || field.type === "NUMBER"
          ? ("right" as const)
          : ("left" as const),
      sorter: sortable || undefined,
      sortOrder,
      sortDirections: sortable
        ? (["ascend", "descend"] as ("ascend" | "descend")[])
        : undefined,
      render: (_: unknown, row: RecordSummary) =>
        field.fieldKey === schema.object.titleFieldKey ? (
          <a
            className={`${styles.recordTitle} ${rl.titleLink}`}
            data-density={density}
            href={recordPath(row.id)}
            onClick={(event) => {
              event.preventDefault();
              go(recordPath(row.id));
            }}
          >
            {row.title}
          </a>
        ) : (
          <RecordCellValue
            field={field}
            value={row.values[field.fieldKey]}
            members={members}
            density={density}
            width={width}
            recordTitle={row.title}
            currentMemberId={currentMemberId}
          />
        ),
    };
  };
  // The record's own columns. Which of them show keeps its conditions (owner
  // when the member can see others' records and chose to, pool status when
  // the pool is on); the member's order only arranges them among the fields.
  const systemColumns: Record<SystemColumnKey, RecordColumn> = {
    recordNo: {
      title: "业务编号",
      key: "recordNo",
      dataIndex: "recordNo",
      width: columnWidth("recordNo"),
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
    systemOwner: {
      title: "负责人",
      key: "systemOwner",
      width: columnWidth("systemOwner"),
      render: (_: unknown, row: RecordSummary) => (
        <RecordOwner
          ownerMemberId={row.ownerMemberId}
          members={members}
          currentMemberId={currentMemberId}
        />
      ),
    },
    poolStatus: {
      title: "归属状态",
      key: "poolStatus",
      width: columnWidth("poolStatus"),
      render: (_: unknown, row: RecordSummary) =>
        poolConfig ? (
          <RecordPoolStatus record={row} config={poolConfig} compact />
        ) : null,
    },
    updatedAt: {
      title: "最近更新",
      key: "updatedAt",
      dataIndex: "updatedAt",
      width: columnWidth("updatedAt"),
      sorter: true,
      sortOrder:
        query.sort === "updatedAt"
          ? query.direction === "asc"
            ? "ascend"
            : "descend"
          : null,
      sortDirections: ["ascend", "descend"],
      render: (updatedAt: string) => (
        <span className={rl.noWrap}>{formatDateTime(updatedAt)}</span>
      ),
    },
  };
  const shownSystemColumns: SystemColumnKey[] = [
    "recordNo",
    ...(showOwner ? (["systemOwner"] as const) : []),
    ...(poolConfig?.enabled ? (["poolStatus"] as const) : []),
    "updatedAt",
  ];
  const columnOrder = resolveColumnOrder(
    display.prefs.order,
    visibleColumns.map((field) => field.fieldKey),
    shownSystemColumns,
  );
  // The selection checkbox (antd puts it first) and the row menu stay at the
  // two ends whatever the member's order.
  const columns: ColumnsType<RecordSummary> = [
    ...columnOrder.map((id) => {
      const system = systemColumnKey(id);
      if (system) return systemColumns[system];
      const field = visibleColumns.find((item) => item.fieldKey === id);
      return field ? fieldColumn(field) : null;
    }).filter((column): column is RecordColumn => column !== null),
    {
      // The header is read by assistive technology only; the menu button is self-explanatory.
      title: <span className={styles.visuallyHidden}>操作</span>,
      key: "actions",
      width: 56,
      fixed: "right",
      align: "center",
      render: (_, row) => rowMenu(row),
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
    query.poolQuality ||
    Object.keys(query.filters).length > 0,
  );

  const emptyState = records.isError ? null : (
    <Empty
      description={
        filtered
          ? "当前筛选条件没有匹配的记录。"
          : query.scope === "pool"
            ? "公共池暂无记录，可由负责人释放或管理员移入"
            : schema.actions.canCreate
              ? "还没有记录，新建第一条。"
              : "还没有记录。"
      }
    >
      {filtered ? (
        <Button
          onClick={() =>
            apply({
              ...query,
              page: 1,
              search: undefined,
              ownerMemberId: undefined,
              poolQuality: undefined,
              filters: {},
            })
          }
        >
          清除条件
        </Button>
      ) : null}
    </Empty>
  );

  function rowMenu(row: RecordSummary) {
    return (
      <RecordRowActions
        key={`${row.id}:${row.version}`}
        record={row}
        editable={editableRecord(row)}
        editBlockedReason={row.inPublicPool ? "领取后可编辑" : "无编辑权限"}
        canDelete={schema.actions.canDelete}
        deleting={remove.isPending && remove.variables?.id === row.id}
        onView={() => go(recordPath(row.id))}
        onEdit={() => go(recordPath(row.id, "edit"))}
        onDelete={() => remove.mutate(row)}
        tenantCode={tenantCode}
        objectCode={objectCode}
        schema={schema}
        config={poolConfig}
        currentMemberId={currentMemberId}
        isAdmin={canFilterByOwner}
        members={members}
        onChanged={async () => {
          const result = await records.refetch();
          if (result.isError) throw result.error;
          router.refresh();
        }}
      />
    );
  }

  const quickFilterFields = optionFilterFields.slice(0, 3);
  const conditionFields = filterableFields(
    schema.fields,
    schema.object.titleFieldKey,
  );
  const chipFilterKeys = Object.keys(query.filters).filter(
    (key) => !quickFilterFields.some((field) => field.fieldKey === key),
  );
  const conditionCount = Object.keys(query.filters).length;
  const anyCondition = Boolean(
    conditionCount || query.ownerMemberId || query.poolQuality,
  );
  const clearConditions = () =>
    apply({
      ...withFilter(query, { filters: {}, ownerMemberId: undefined }),
      poolQuality: undefined,
    });
  const selectedCount = currentSelectedRowKeys.length;
  const tooManyToEdit = selectedCount > 100;
  const tooManyToAssign = selectedCount > MAX_OWNER_ASSIGNMENT_RECORDS;
  const canAssign = canFilterByOwner && schema.actions.canUpdate;
  const columnLabel = (key: string) =>
    key in SYSTEM_COLUMN_LABELS
      ? SYSTEM_COLUMN_LABELS[key as SystemColumnKey]
      : (schema.fields.find((field) => field.fieldKey === key)?.label ?? key);
  const setColumnWidth = (key: string, width: number | undefined) =>
    display.update((current) => {
      const widths = { ...current.widths };
      if (width === undefined) delete widths[key];
      else widths[key] = width;
      return { widths };
    });
  const resizableColumns: ColumnsType<RecordSummary> = columns.map((column) => {
    const key = String(column.key);
    const bounds = columnBounds[key];
    if (key === "actions" || !bounds) return column;
    const width =
      typeof column.width === "number" ? column.width : bounds.width;
    return {
      ...column,
      onHeaderCell: () =>
        ({
          width,
          minWidth: bounds.min,
          maxWidth: bounds.max,
          resizeLabel: `拖动调整「${columnLabel(key)}」列宽，双击恢复`,
          onResize: (next: number) => setColumnWidth(key, next),
          onResizeReset: () => setColumnWidth(key, undefined),
        }) as React.HTMLAttributes<HTMLElement>,
    };
  });
  // The table is exactly as wide as its columns: long values wrap inside
  // their column instead of pushing the table wider.
  const tableWidth =
    resizableColumns.reduce(
      (sum, column) =>
        sum + (typeof column.width === "number" ? column.width : 0),
      0,
    ) + (canSelect ? 40 : 0);

  const overflowItems: MenuProps["items"] = [
    ...(schema.actions.canCreate
      ? [
          {
            key: "import",
            label: "导入 Excel / CSV",
            icon: <UploadOutlined aria-hidden />,
            onClick: () => setImportOpen(true),
          },
        ]
      : []),
    {
      key: "export",
      label: "导出当前结果",
      icon: <DownloadOutlined aria-hidden />,
      disabled:
        !schema.actions.canRead || page.total === 0 || exporting.isPending,
      onClick: () => exporting.mutate(),
    },
    ...(canFilterByOwner && onPoolSettings
      ? [
          { type: "divider" as const },
          {
            key: "pool",
            label: "公共池设置",
            icon: <SettingOutlined aria-hidden />,
            onClick: onPoolSettings,
          },
        ]
      : []),
  ];

  const columnChooser = (
    <RecordDisplaySettings
      fields={choosableFields}
      order={columnOrder}
      prefs={display.prefs}
      ownerChoice={!owned}
      onChange={(change) =>
        display.update(
          change.columns
            ? {
                ...change,
                columns: resolveRecordColumnKeys(schema, change.columns),
              }
            : change,
        )
      }
      onReset={display.reset}
    />
  );

  return (
    <CellReaderProvider>
      <div className={rl.page}>
        {error ? (
          <Alert type="error" showIcon title={error} className={rl.alert} />
        ) : null}
        <PageHeader
          title={
            <span className={rl.title}>
              <ObjectIcon name={schema.object.icon} />
              {owned && !poolConfig?.enabled
                ? `我的${schema.object.name}`
                : schema.object.name}
            </span>
          }
          count={page.total}
          description={schema.object.description}
          extra={
            <>
              <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{ items: overflowItems }}
              >
                <Button
                  aria-label="更多操作"
                  icon={<EllipsisOutlined aria-hidden />}
                  loading={exporting.isPending}
                />
              </Dropdown>
              {schema.actions.canCreate ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined aria-hidden />}
                  onClick={() => go(`${listPath}/new`)}
                >
                  新建{schema.object.name}
                </Button>
              ) : null}
            </>
          }
        />

        <div className={rl.viewRow}>
          <div className={rl.rowStart}>
            {poolConfig?.enabled ? (
              <Segmented
                className={rl.scope}
                aria-label="记录范围"
                value={
                  poolConfig.lifecycleEnabled
                    ? (query.poolStage ?? "all")
                    : (query.scope ?? (owned ? "mine" : "all"))
                }
                onChange={(value) => {
                  const view = String(value);
                  if (!poolConfig.lifecycleEnabled)
                    return apply({
                      ...query,
                      scope: view as "mine" | "pool" | "all",
                      poolStage: undefined,
                      page: 1,
                      ownerMemberId: undefined,
                    });
                  const privateStage = [
                    "PENDING_CONTACT",
                    "FOLLOWING",
                    "PROTECTED",
                  ].includes(view);
                  apply({
                    ...query,
                    poolStage:
                      view === "all" ? undefined : (view as PoolStageFilter),
                    scope:
                      privateStage && !canFilterByOwner ? "mine" : undefined,
                    page: 1,
                    ownerMemberId: undefined,
                  });
                }}
                options={
                  poolConfig.lifecycleEnabled
                    ? [
                        ...POOL_STAGES.map((stage) => ({
                          value: stage,
                          label: (
                            <span className={rl.scopeLabel}>
                              <span>
                                {
                                  {
                                    ...DEFAULT_POOL_LABELS,
                                    ...poolConfig.labels,
                                  }[POOL_LABEL_KEYS[stage]]
                                }
                              </span>{" "}
                              {records.data?.poolCounts?.[stage] !==
                              undefined ? (
                                <span className={rl.scopeCount}>
                                  {records.data.poolCounts[stage]}
                                </span>
                              ) : null}
                            </span>
                          ),
                        })),
                        {
                          value: "LEGACY",
                          label: (
                            <span className={rl.scopeLabel}>
                              <span>旧记录</span>{" "}
                              {records.data?.poolCounts?.LEGACY !==
                              undefined ? (
                                <span className={rl.scopeCount}>
                                  {records.data.poolCounts.LEGACY}
                                </span>
                              ) : null}
                            </span>
                          ),
                        },
                        {
                          value: "all",
                          label:
                            canFilterByOwner || schema.scopes.read === "ALL"
                              ? "全部记录"
                              : "全部可见记录",
                        },
                      ]
                    : [
                        { value: "mine", label: "我的记录" },
                        { value: "pool", label: "公共池" },
                        ...(schema.scopes.read === "ALL"
                          ? [{ value: "all", label: "全部记录" }]
                          : []),
                      ]
                }
              />
            ) : null}
            {currentMemberId ? (
              <SavedRecordFilters
                key={`${tenantCode}:${currentMemberId}:${objectCode}:views`}
                tenantCode={tenantCode}
                memberId={currentMemberId}
                objectCode={objectCode}
                query={query}
                onApply={apply}
                part="views"
              />
            ) : null}
          </div>
          <div className={rl.rowEnd}>
            <RecordSearch
              label={searchLabel}
              placeholder={`搜索${schema.object.name}`}
              value={query.search ?? ""}
              resetSignal={navigation}
              onSearch={(search) => apply(withFilter(query, { search }), true)}
            />
            <Popover
              trigger="click"
              placement="bottomRight"
              arrow={false}
              open={columnsOpen}
              onOpenChange={setColumnsOpen}
              content={columnChooser}
            >
              <Button
                icon={<TableOutlined aria-hidden />}
                className={rl.desktopOnly}
                aria-label="显示设置"
                aria-expanded={columnsOpen}
              >
                显示
              </Button>
            </Popover>
          </div>
        </div>

        <div
          className={rl.conditionRow}
          role="group"
          aria-label={`${schema.object.name}筛选`}
        >
          <div className={rl.rowStart}>
            {canFilterByOwner &&
            query.scope !== "pool" &&
            query.scope !== "mine" ? (
              <Select
                aria-label="按负责人筛选"
                placeholder="负责人"
                variant="borderless"
                allowClear
                showSearch
                optionFilterProp="searchText"
                popupMatchSelectWidth={false}
                className={rl.quickFilter}
                value={query.ownerMemberId}
                onChange={(next?: string) =>
                  apply(withFilter(query, { ownerMemberId: next }))
                }
                options={[
                  {
                    value: "unassigned",
                    label: "未指定负责人",
                    searchText: "未指定负责人",
                  },
                  // Filtering by a disabled member still finds the records they own.
                  ...memberSelectOptions(members, {
                    includeDisabled: true,
                    currentMemberId,
                  }),
                ]}
              />
            ) : null}
            {poolConfig?.lifecycleEnabled ? (
              <Select
                aria-label="按资源质量筛选"
                allowClear
                variant="borderless"
                placeholder="资源质量"
                popupMatchSelectWidth={false}
                className={rl.quickFilter}
                value={query.poolQuality}
                onChange={(poolQuality) =>
                  apply({ ...query, poolQuality, page: 1 })
                }
                options={[
                  { value: "INVALID", label: "空号 / 无效" },
                  { value: "DUPLICATE", label: "重复" },
                  { value: "LOST", label: "丢单" },
                ]}
              />
            ) : null}
            {quickFilterFields.map((field) => (
              <OptionQuickFilter
                key={field.fieldKey}
                field={field}
                filters={query.filters}
                onChange={applyFieldFilter}
              />
            ))}
            {chipFilterKeys.map((key) => {
              const field = schema.fields.find(
                (candidate) => candidate.fieldKey === key,
              );
              const label = field?.label ?? key;
              return (
                <span key={key} className={rl.chip}>
                  <button
                    type="button"
                    className={rl.chipBody}
                    onClick={() => setFiltersOpen(true)}
                  >
                    <span className={rl.chipField}>{label}</span>
                    {field
                      ? describeFilter(field, query.filters[key], members)
                      : null}
                  </button>
                  <button
                    type="button"
                    className={rl.chipRemove}
                    aria-label={`删除条件 ${label}`}
                    onClick={() => applyFieldFilter(key, undefined)}
                  >
                    <CloseOutlined aria-hidden />
                  </button>
                </span>
              );
            })}
            {conditionFields.length ? (
              <RecordFilterPopover
                fields={conditionFields}
                filters={query.filters}
                members={members}
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                onChange={applyFieldFilter}
              >
                <Button
                  type="text"
                  size="small"
                  className={rl.addFilter}
                  icon={<FilterOutlined aria-hidden />}
                  aria-expanded={filtersOpen}
                >
                  筛选{chipFilterKeys.length ? ` ${chipFilterKeys.length}` : ""}
                </Button>
              </RecordFilterPopover>
            ) : null}
          </div>
          <div className={rl.rowEnd}>
            {anyCondition ? (
              <Button
                type="text"
                size="small"
                className={rl.quiet}
                onClick={clearConditions}
              >
                清除
              </Button>
            ) : null}
            {currentMemberId ? (
              <SavedRecordFilters
                key={`${tenantCode}:${currentMemberId}:${objectCode}:save`}
                tenantCode={tenantCode}
                memberId={currentMemberId}
                objectCode={objectCode}
                query={query}
                onApply={apply}
                part="save"
              />
            ) : null}
          </div>
        </div>

        <div className={rl.mobileSort}>
          <Select
            aria-label="卡片排序字段"
            value={query.sort}
            onChange={(sort) => apply({ ...query, sort, page: 1 })}
            options={[
              { value: "recordNo", label: "业务编号" },
              { value: "createdAt", label: "创建时间" },
              { value: "updatedAt", label: "更新时间" },
              ...schema.fields
                .filter((field) =>
                  (SORTABLE_FIELD_TYPES as readonly string[]).includes(
                    field.type,
                  ),
                )
                .map((field) => ({
                  value: field.fieldKey,
                  label: field.label,
                })),
            ]}
          />
          <Select
            aria-label="卡片排序方向"
            value={query.direction}
            onChange={(direction) => apply({ ...query, direction, page: 1 })}
            options={[
              { value: "asc", label: "升序" },
              { value: "desc", label: "降序" },
            ]}
          />
        </div>

        <section
          className={rl.data}
          aria-label={`${schema.object.name}记录表`}
          data-header-tone={
            display.prefs.headerTone === "default"
              ? undefined
              : display.prefs.headerTone
          }
        >
          {records.isError ? (
            <Alert
              type="error"
              title="记录加载失败"
              description={toApiError(records.error).message}
              action={
                <Button
                  aria-label="重试"
                  loading={records.isFetching}
                  onClick={() => records.refetch()}
                >
                  重试
                </Button>
              }
            />
          ) : page.items.length === 0 ? (
            <div className={rl.cards}>{emptyState}</div>
          ) : !showCards ? null : (
            <ul
              className={rl.cards}
              aria-label={`${schema.object.name}记录卡片`}
            >
              {page.items.map((row) => {
                const ownerName = (
                  <RecordOwner
                    ownerMemberId={row.ownerMemberId}
                    members={members}
                    currentMemberId={currentMemberId}
                  />
                );
                return (
                  <li key={row.id} className={rl.card}>
                    <div className={rl.cardHeader}>
                      {canSelect ? (
                        <Checkbox
                          disabled={!selectableRecord(row)}
                          aria-label={`选择卡片 ${row.title}`}
                          checked={currentSelectedRowKeys.includes(row.id)}
                          onChange={(event) =>
                            setSelectedRowKeys((keys) =>
                              event.target.checked
                                ? [...keys, row.id]
                                : keys.filter((key) => key !== row.id),
                            )
                          }
                        />
                      ) : null}
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
                      <span className={rl.cardMenu}>{rowMenu(row)}</span>
                    </div>
                    <dl className={rl.cardMeta}>
                      <div>
                        <dt>业务编号</dt>
                        <dd className={styles.recordNo}>{row.recordNo}</dd>
                      </div>
                      {showOwner ? (
                        <div>
                          <dt>负责人</dt>
                          <dd>{ownerName}</dd>
                        </div>
                      ) : null}
                      {cardFields.extras.map((field) => (
                        <div key={field.fieldKey}>
                          <dt>{field.label}</dt>
                          <dd>
                            <RecordCellValue
                              field={field}
                              value={row.values[field.fieldKey]}
                              members={members}
                              density="compact"
                              width={160}
                              recordTitle={row.title}
                              currentMemberId={currentMemberId}
                            />
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {poolConfig?.enabled ? (
                      <div className={rl.cardPool}>
                        <RecordPoolStatus record={row} config={poolConfig} />
                        {/* On a phone, claiming from the pool is the card's main action. */}
                        <RecordOwnershipActions
                          key={`${row.id}:${row.version}`}
                          tenantCode={tenantCode}
                          objectCode={objectCode}
                          record={row}
                          schema={schema}
                          config={poolConfig}
                          currentMemberId={currentMemberId}
                          isAdmin={canFilterByOwner}
                          members={members}
                          onChanged={async () => {
                            const result = await records.refetch();
                            if (result.isError) throw result.error;
                            router.refresh();
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <Table
            className={rl.table}
            rowKey="id"
            size="small"
            columns={resizableColumns}
            components={{ header: { cell: ResizableHeaderCell } }}
            dataSource={page.items}
            loading={records.isFetching}
            onChange={handleTableChange}
            tableLayout="fixed"
            scroll={{ x: tableWidth }}
            rowSelection={
              canSelect
                ? {
                    columnWidth: 40,
                    selectedRowKeys: currentSelectedRowKeys,
                    onChange: (keys) => setSelectedRowKeys(keys.map(String)),
                    getCheckboxProps: (row) => ({
                      "aria-label": `选择 ${row.title}`,
                      disabled: !selectableRecord(row),
                    }),
                  }
                : undefined
            }
            aria-label={`${schema.object.name}记录`}
            locale={{ emptyText: emptyState }}
            pagination={false}
          />
        </section>

        <footer
          className={rl.footer}
          data-selecting={selectedCount > 0 ? "true" : undefined}
        >
          {selectedCount > 0 ? (
            <div className={rl.bulkBar} role="toolbar" aria-label="批量操作">
              <span className={rl.bulkCount}>已选 {selectedCount} 条</span>
              {tooManyToEdit || tooManyToAssign ? (
                <span className={rl.bulkLimit}>
                  批量修改每次最多 100 条，负责人分配每次最多{" "}
                  {MAX_OWNER_ASSIGNMENT_RECORDS} 条
                </span>
              ) : null}
              {schema.actions.canUpdate ? (
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined aria-hidden />}
                  disabled={
                    tooManyToEdit ||
                    selectedRecords.some((row) => !editableRecord(row))
                  }
                  onClick={() => setBatchOpen(true)}
                >
                  批量修改
                </Button>
              ) : null}
              {canAssign ? (
                <Button
                  size="small"
                  type="text"
                  icon={<UserSwitchOutlined aria-hidden />}
                  disabled={tooManyToAssign}
                  onClick={() => setAssignmentRecords([...selectedRecords])}
                >
                  分配负责人
                </Button>
              ) : null}
              {schema.actions.canDelete ? (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined aria-hidden />}
                  disabled={selectedCount > MAX_DELETE_RECORDS}
                  onClick={() => setDeletionRecords([...selectedRecords])}
                >
                  批量删除
                </Button>
              ) : null}
              <Button
                size="small"
                type="text"
                className={rl.bulkClear}
                aria-label="取消选择"
                icon={<CloseOutlined aria-hidden />}
                onClick={() => setSelectedRowKeys([])}
              />
            </div>
          ) : (
            <span className={rl.total}>共 {page.total} 条</span>
          )}
          <div className={rl.rowEnd}>
            <Select
              aria-label="每页条数"
              variant="borderless"
              size="small"
              className={rl.pageSize}
              value={page.limit}
              options={[20, 50, 100, 300, 500, 1000].map((value) => ({
                value,
                label: `${value} 条 / 页`,
              }))}
              onChange={(limit) => apply({ ...query, limit, page: 1 })}
            />
            <Pagination
              size="small"
              current={page.page}
              pageSize={page.limit}
              total={page.total}
              showSizeChanger={false}
              hideOnSinglePage={false}
              onChange={(nextPage) => apply({ ...query, page: nextPage })}
            />
          </div>
        </footer>

        {importOpen ? (
          <RecordImportDrawer
            tenantCode={tenantCode}
            schema={schema}
            api={api}
            canChooseOwner={canFilterByOwner}
            poolConfig={poolConfig}
            members={members}
            onClose={() => setImportOpen(false)}
            onCompleted={async () => {
              await records.refetch();
              router.refresh();
            }}
          />
        ) : null}

        {assignmentRecords ? (
          <RecordBatchAssignDrawer
            tenantCode={tenantCode}
            objectCode={objectCode}
            records={assignmentRecords}
            members={members}
            onClose={() => {
              setAssignmentRecords(undefined);
              setSelectedRowKeys([]);
            }}
            onChanged={async () => {
              await records.refetch();
              router.refresh();
            }}
          />
        ) : null}
        {deletionRecords ? (
          <RecordBatchDeleteDrawer
            tenantCode={tenantCode}
            objectCode={objectCode}
            records={deletionRecords}
            api={api}
            onChanged={async () => {
              const key = ["workspace", tenantCode, "records", objectCode, query];
              await queryClient.cancelQueries({ queryKey: key, exact: true });
              // A query refetch can pause indefinitely offline. This explicit
              // refresh must settle so deletion feedback remains dismissible.
              const result = await api.list(tenantCode, objectCode, query);
              queryClient.setQueryData(key, result);
              router.refresh();
            }}
            onClose={() => {
              setDeletionRecords(undefined);
              setSelectedRowKeys([]);
              const lastPage = Math.max(1, Math.ceil(page.total / page.limit));
              if (query.page > lastPage) apply({ ...query, page: lastPage });
            }}
          />
        ) : null}
        {batchOpen && selectedRecords.length > 0 ? (
          <RecordBatchEditDrawer
            tenantCode={tenantCode}
            schema={schema}
            records={selectedRecords}
            members={members}
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
    </CellReaderProvider>
  );
}

/**
 * The search box keeps its own text while typing, so a keystroke re-renders
 * this input rather than every row; the list query changes after a pause.
 */
function RecordSearch({
  label,
  placeholder,
  value,
  resetSignal,
  onSearch,
}: {
  label: string;
  placeholder: string;
  value: string;
  /** Changes whenever the list navigates for another reason. */
  resetSignal: number;
  onSearch: (search: string | undefined) => void;
}) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState({ value, resetSignal });
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  if (shown.value !== value || shown.resetSignal !== resetSignal) {
    // The URL changed underneath (back, a cleared filter) or the list moved
    // on (a sort): follow the URL and drop what was still being typed.
    setShown({ value, resetSignal });
    setText(value);
  }
  useEffect(() => {
    clearTimeout(debounce.current);
  }, [value, resetSignal]);
  useEffect(() => () => clearTimeout(debounce.current), []);
  const commit = (next: string) => {
    clearTimeout(debounce.current);
    onSearch(next.trim() || undefined);
  };
  return (
    <Input
      aria-label={label}
      title={label}
      placeholder={placeholder}
      allowClear
      prefix={<SearchOutlined aria-hidden />}
      value={text}
      className={rl.search}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        clearTimeout(debounce.current);
        debounce.current = setTimeout(() => commit(next), SEARCH_DEBOUNCE_MS);
      }}
      onPressEnter={() => commit(text)}
    />
  );
}

const WIDE = "(min-width: 768px)";

function isWide() {
  return (
    typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches
  );
}

function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
