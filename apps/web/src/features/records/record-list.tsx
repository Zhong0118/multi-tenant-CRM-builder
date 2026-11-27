"use client";

import { useAiFeature } from "@/features/ai-governance/access";
import { DueLabel } from "@/components/workbench/due-label";
import { useNow } from "@/lib/format/use-now";
import {
  legacyFiltersToRule,
  type FilterPreviewRequest,
  type FilterRule,
} from "@crm/contracts";
import { CommunicationDraftDialog } from "./communication-draft";
import { previewRecordFilter } from "./filter-preview-api";
import { ListAssistantButton } from "@/features/ai/assistant-panel-button";
import { RecordFilterPanel, RecordFilterChips } from "./record-filter-panel";
import { RecordViewPicker } from "./record-views";
import {
  useRecordViews,
  type RecordView,
  type RecordViewDraft,
} from "./record-view-api";
import { canTransfer } from "@/features/objects/record-transfer-permissions";
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
} from "antd";
import type { MenuProps } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ObjectIcon } from "@/components/navigation/object-icon";
import {
  SORTABLE_FIELD_TYPES,
  selectOptions,
  type RecordPage,
  type RecordSummary,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type { DynamicFieldMember } from "./dynamic-field";
import {
  canEditRecord,
  canEditRecordFields,
  queryFields,
  recordFields,
} from "./record-access";
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
import { RecordListTable } from "./record-list-table";
import { CallButton } from "@/features/telephony/call-button";
import { CallDialog, type CallTarget } from "@/features/telephony/call-dialog";
import {
  dialable,
  UNAVAILABLE_REASON,
} from "@/features/telephony/telephony-api";
import { useTelephonyRuntime } from "@/features/telephony/use-telephony";
import { useRecordListLayout } from "./use-record-list-layout";
import { useRecordSelection } from "./use-record-selection";
import { RecordDisplaySettings } from "./record-display-settings";
import { displayValue, RecordOwner } from "./record-display-value";
import {
  describeFilter,
  quickFilterValues,
  DateQuickFilter,
  isDateFilterField,
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
  isPristineRecordQuery,
  recordQuerySearch,
  restrictRecordQuery,
  withFilter,
  type RecordFilterValue,
  type RecordQuery,
} from "./record-query-state";
import {
  RecordCommunicationDrawer,
  RecordCommunicationPreview,
} from "./record-communication-drawer";
import { RecordRowActions } from "./record-row-actions";

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

/**
 * The record register. Filters, sort and page live in the URL so returning from
 * a record keeps the context the member left. An `OWN` scope says so in the
 * title rather than offering an "all records" switch that would only fail.
 */
export function RecordList({
  tenantCode,
  currentMemberId,
  schema,
  query: requestedQuery,
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
  const route = restrictRecordQuery(requestedQuery, schema);
  const objectCode = schema.object.code;
  const listPath = `/workspace/${tenantCode}/objects/${objectCode}`;
  const queryDefaults: RecordQuery = {
    ...DEFAULT_RECORD_QUERY,
    sort: schema.defaultView.sort.field,
    direction: schema.defaultView.sort.direction,
  };
  const go = navigate ?? ((path: string) => router.replace(path));
  const viewQuery = useRecordViews(tenantCode, objectCode, currentMemberId);
  const views = viewQuery.data ?? [];
  const baseId = route.viewId ?? route.baseViewId;
  const activeView = baseId
    ? views.find((v) => v.id === baseId)
    : views.find((v) => v.code === "all");
  const pristine = isPristineRecordQuery(route, schema.defaultView.sort);
  const useDefaultView = pristine && Boolean(activeView?.available);
  const cleanView =
    (route.viewId || useDefaultView) && activeView?.available
      ? activeView
      : undefined;
  const request = useDefaultView ? { ...route, viewId: activeView!.id } : route;
  const query: RecordQuery = cleanView
    ? restrictRecordQuery(
        {
          ...route,
          ...cleanView.queryOptions,
          filterRule: cleanView.filterRule,
          sort: cleanView.sort?.field ?? route.sort,
          direction: cleanView.sort?.direction ?? route.direction,
        },
        schema,
      )
    : route;
  const layout = useRecordListLayout(
    tenantCode,
    currentMemberId,
    schema,
    activeView,
    Boolean(poolConfig?.enabled),
  );
  const queryScope = `${tenantCode}:${objectCode}:${recordQuerySearch(query, queryDefaults)}`;
  const [filterEdit, setFilterEdit] = useState<{
    scope: string;
    index: number;
  }>();
  if (filterEdit && filterEdit.scope !== queryScope) setFilterEdit(undefined);
  const [communicationRecord, setCommunicationRecord] =
    useState<RecordSummary>();
  const telephony = useTelephonyRuntime(tenantCode, objectCode).data;
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const [error, setError] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  let rule = query.filterRule;
  if (!rule) {
    try {
      rule = legacyFiltersToRule(query.filters, queryFields(schema));
    } catch {
      /* The explicit legacy query continues to use the original record endpoint. */
    }
  }
  const emptyRule: FilterRule = { version: 1, match: "all", conditions: [] };
  const activeRule = rule ?? emptyRule;
  const dirty = Boolean(
    layout.layoutDraft ||
    route.baseViewId ||
    (!cleanView &&
      (route.search ||
        route.scope ||
        route.poolStage ||
        route.poolQuality ||
        route.ownerMemberId ||
        rule?.conditions.length ||
        route.sort !== queryDefaults.sort ||
        route.direction !== queryDefaults.direction)),
  );
  const baseBlocked = Boolean(
    (baseId && !activeView?.available) ||
    (pristine && activeView && !activeView.available),
  );
  const viewReady = !baseBlocked && Boolean(rule);
  const filterProps = {
    schema,
    members,
    isAdmin: canFilterByOwner,
    rule: activeRule,
    editIndex: filterEdit?.index ?? null,
    onEditIndex: (index: number | null) =>
      setFilterEdit(index === null ? undefined : { scope: queryScope, index }),
    onPreview: (input: FilterPreviewRequest, signal: AbortSignal) =>
      previewRecordFilter(
        tenantCode,
        objectCode,
        {
          ...input,
          ...(activeView?.available && { baseViewId: activeView.id }),
        },
        signal,
      ),
    onApply: (filterRule: FilterRule) =>
      apply({ ...query, filters: {}, filterRule, page: 1 }),
  };
  const records = useQuery({
    queryKey: ["workspace", tenantCode, "records", objectCode, request],
    queryFn: () => api.list(tenantCode, objectCode, request),
    enabled:
      viewReady &&
      ((query.scope !== "pool" &&
        query.poolStage !== "LEAD_POOL" &&
        query.poolStage !== "CUSTOMER_POOL") ||
        poolConfig?.enabled !== false),
    initialData: baseBlocked || useDefaultView ? undefined : initialPage,
    staleTime: 0,
  });
  const exporting = useMutation({
    mutationFn: () =>
      api.export(tenantCode, objectCode, {
        ...(request.viewId &&
          !layout.layoutDraft &&
          (layout.namedLayout || !layout.personalPrefs.columns.length) && {
            viewId: request.viewId,
          }),
        ...(query.filterRule && { filterRule: query.filterRule }),
        search: query.search,
        scope: query.scope,
        poolStage: query.poolStage,
        poolQuality: query.poolQuality,
        ownerMemberId: query.ownerMemberId,
        filters: query.filters,
        sort: query.sort,
        direction: query.direction,
        columns: layout.columnFieldKeys,
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
  function selectView(view: RecordView | undefined) {
    layout.discardDraft();
    setFilterEdit(undefined);
    navigateQuery({ ...queryDefaults, limit: route.limit, viewId: view?.id });
  }
  function apply(next: RecordQuery, fromSearch = false) {
    if (!viewReady) return;
    navigateQuery(
      {
        ...next,
        viewId: undefined,
        ...(activeView && {
          baseViewId: activeView.id,
          filterRule:
            next.filterRule ??
            legacyFiltersToRule(next.filters, queryFields(schema)),
        }),
      },
      fromSearch,
    );
  }
  function navigateQuery(next: RecordQuery, fromSearch = false) {
    if (!fromSearch) setNavigation((count) => count + 1);
    const search = recordQuerySearch(
      restrictRecordQuery(next, schema),
      queryDefaults,
    );
    go(search === "" ? listPath : `${listPath}?${search}`);
  }

  function applyFieldFilter(
    fieldKey: string,
    value: RecordFilterValue | undefined,
  ) {
    const filters = { ...query.filters };
    if (value === undefined) delete filters[fieldKey];
    else filters[fieldKey] = value;
    if (query.filterRule) {
      if (!quickFilterValues(query, fieldKey)) return;
      const others = query.filterRule.conditions.filter(
        (term) => !("fieldKey" in term && term.fieldKey === fieldKey),
      );
      const addition =
        value === undefined
          ? []
          : legacyFiltersToRule({ [fieldKey]: value }, queryFields(schema))
              .conditions;
      apply({
        ...query,
        filters: {},
        page: 1,
        filterRule: {
          version: 1,
          match: "all",
          conditions: [...others, ...addition],
        },
      });
    } else apply(withFilter(query, { filters }));
  }

  function recordPath(recordId: string, mode?: "edit") {
    const params = new URLSearchParams(recordQuerySearch(route, queryDefaults));
    if (mode) params.set("mode", mode);
    const search = params.toString();
    return `${listPath}/${recordId}${search ? `?${search}` : ""}`;
  }

  const noRows = { ...initialPage, total: 0, items: [] };
  const page =
    !viewReady || records.isError
      ? noRows
      : (records.data ?? (useDefaultView ? noRows : initialPage));
  const now = useNow();
  const timeZone =
    page.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  function nextContact(value?: string | null) {
    return value ? (
      <DueLabel
        dueAt={value}
        timeZone={timeZone}
        now={now}
        format="dateAndWeekday"
      />
    ) : (
      "—"
    );
  }
  const [activityRecord, setActivityRecord] = useState<RecordSummary>();
  // The phone cards repeat every row and a desktop never shows them, so they
  // are only built on a narrow screen, after hydration. Until then a phone
  // shows the table (see .data:has(.cards) in the stylesheet).
  const showCards = useSyncExternalStore(
    subscribeWide,
    () => !isWide(),
    () => false,
  );
  const editableRecord = (row: RecordSummary) =>
    canEditRecordFields(schema, row, currentMemberId, canFilterByOwner);
  const selection = useRecordSelection(
    queryScope,
    page.items,
    schema.actions,
    editableRecord,
  );
  const owned = schema.scopes.read === "OWN";
  const groupRead = schema.scopes.read === "GROUP";
  const queryableFields = queryFields(schema);
  const optionFilterFields = queryableFields.filter(
    (field) =>
      (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT") &&
      selectOptions(field).length > 0,
  );
  const searchFieldLabels = queryableFields
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

  const importAssist = useAiFeature("import_assist", false);
  const communication = useAiFeature("communication");
  const callableFields = new Set(
    telephony?.enabled ? telephony.fields.map((field) => field.fieldKey) : [],
  );
  const callBlocked = telephony?.available
    ? null
    : (UNAVAILABLE_REASON[telephony?.reason ?? ""] ?? "现在不能外呼");
  // Pool records are a preview until claimed; the record page says the same.
  const callAction = (
    row: RecordSummary,
    field: { fieldKey: string; label: string },
  ) =>
    callableFields.has(field.fieldKey) &&
    dialable(row.values[field.fieldKey]) &&
    !(row.inPublicPool && !canFilterByOwner) ? (
      <CallButton
        label={`拨打${field.label}`}
        disabledReason={callBlocked}
        onCall={() =>
          setCallTarget({
            objectCode,
            recordId: row.id,
            recordTitle: row.title,
            values: row.values,
            fieldKey: field.fieldKey,
          })
        }
      />
    ) : null;
  const canCommunicate = (row: RecordSummary) =>
    communication &&
    canEditRecord(schema, row, currentMemberId, canFilterByOwner);

  const filtered = Boolean(
    query.filterRule?.conditions.length ||
    query.search ||
    query.ownerMemberId ||
    query.poolQuality ||
    Object.keys(query.filters).length > 0,
  );

  const emptyState =
    !viewReady || records.isError ? null : (
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
                filterRule: query.filterRule ? emptyRule : undefined,
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
        onCommunicate={
          canCommunicate(row) ? () => setCommunicationRecord(row) : undefined
        }
        onActivity={
          row.latestActivity !== undefined
            ? () => setActivityRecord(row)
            : undefined
        }
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

  const shortcuts = new Map(
    queryableFields.map((field) => [
      field.fieldKey,
      quickFilterValues(query, field.fieldKey),
    ]),
  );
  const quickFilterFields = optionFilterFields
    .filter((field) => shortcuts.get(field.fieldKey))
    .slice(0, 3);
  const conditionFields = filterableFields(
    queryableFields,
    schema.object.titleFieldKey,
  );
  const dateQuickField =
    conditionFields.find(
      (field) =>
        field.fieldKey === schema.defaultView.sort.field &&
        isDateFilterField(field) &&
        shortcuts.get(field.fieldKey),
    ) ??
    conditionFields.find(
      (field) => isDateFilterField(field) && shortcuts.get(field.fieldKey),
    );
  const chipFilterKeys = Object.keys(query.filters).filter(
    (key) =>
      key !== dateQuickField?.fieldKey &&
      !quickFilterFields.some((field) => field.fieldKey === key),
  );
  const conditionCount = Object.keys(query.filters).length;
  const anyCondition = Boolean(
    conditionCount ||
    query.filterRule?.conditions.length ||
    query.ownerMemberId ||
    query.poolQuality,
  );
  const clearConditions = () =>
    apply({
      ...withFilter(query, { filters: {}, ownerMemberId: undefined }),
      filterRule: query.filterRule ? emptyRule : undefined,
      poolQuality: undefined,
    });
  const selectedCount = selection.records.length;
  const tooManyToEdit = selectedCount > 100;
  const tooManyToAssign = selectedCount > MAX_OWNER_ASSIGNMENT_RECORDS;
  const canAssign = canFilterByOwner && schema.actions.canUpdate;
  const draft: RecordViewDraft = {
    filterRule: activeRule,
    queryOptions: {
      search: query.search,
      scope: query.scope,
      poolStage: query.poolStage,
      poolQuality: query.poolQuality,
      ownerMemberId: query.ownerMemberId,
    },
    sort: { field: query.sort, direction: query.direction },
    ...layout.viewLayout,
  };

  const policy = { ...schema.actions, readScope: schema.scopes.read };
  const canImport = canTransfer(policy, "canImport");
  const canExport = canTransfer(policy, "canExport");
  const overflowItems: MenuProps["items"] = [
    ...(canImport
      ? [
          {
            key: "import",
            label: "导入 Excel / CSV",
            icon: <UploadOutlined aria-hidden />,
            onClick: () => setImportOpen(true),
          },
        ]
      : []),
    ...(canExport
      ? [
          {
            key: "export",
            label: "导出当前结果",
            icon: <DownloadOutlined aria-hidden />,
            disabled: page.total === 0 || exporting.isPending,
            onClick: () => exporting.mutate(),
          },
        ]
      : []),
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

  return (
    <CellReaderProvider>
      <div className={rl.page}>
        {!rule || (baseBlocked && !viewQuery.isPending) ? (
          <Alert
            type="warning"
            title="该视图条件不可用"
            action={
              <Button onClick={() => selectView(undefined)}>
                返回全部记录
              </Button>
            }
          />
        ) : null}
        {communicationRecord && (
          <CommunicationDraftDialog
            key={communicationRecord.id}
            tenantCode={tenantCode}
            objectCode={objectCode}
            recordId={communicationRecord.id}
            recordTitle={communicationRecord.title}
            fields={recordFields(schema, communicationRecord)}
            members={members}
            onClose={() => setCommunicationRecord(undefined)}
          />
        )}
        <CallDialog
          tenantCode={tenantCode}
          target={callTarget}
          onClose={() => setCallTarget(null)}
        />
        {activityRecord ? (
          <RecordCommunicationDrawer
            key={activityRecord.id}
            tenantCode={tenantCode}
            schema={schema}
            record={activityRecord}
            currentMemberId={currentMemberId}
            isAdmin={canFilterByOwner}
            api={api}
            onClose={() => setActivityRecord(undefined)}
            onCreated={async () => {
              await queryClient.invalidateQueries(
                { queryKey: ["workspace", tenantCode, "records", objectCode] },
                { throwOnError: true },
              );
            }}
          />
        ) : null}
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
              <ListAssistantButton key={recordQuerySearch(route, queryDefaults)} tenantCode={tenantCode} memberId={currentMemberId} objectCode={objectCode} objectName={schema.object.name} view={activeView} ready={viewReady} filter={filterProps} />
              {overflowItems.length > 0 && (
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
              )}
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

        {poolConfig?.enabled ? (
          <Segmented
            className={rl.scope}
            aria-label="记录范围"
            value={
              poolConfig.lifecycleEnabled
                ? (query.poolStage ?? "all")
                : (query.scope ??
                  (owned ? "mine" : groupRead ? "group" : "all"))
            }
            onChange={(value) => {
              const view = String(value);
              if (!poolConfig.lifecycleEnabled)
                return apply({
                  ...query,
                  scope: view as RecordQuery["scope"],
                  poolStage: undefined,
                  page: 1,
                  ownerMemberId: undefined,
                });
              const privateStage = [
                "PENDING_CONTACT",
                "FOLLOWING",
                "PROTECTED",
              ].includes(view);
              const publicStage =
                view === "LEAD_POOL" || view === "CUSTOMER_POOL";
              apply({
                ...query,
                poolStage:
                  view === "all" ? undefined : (view as PoolStageFilter),
                scope: groupRead
                  ? !publicStage && query.scope === "group"
                    ? "group"
                    : "mine"
                  : privateStage && !canFilterByOwner
                    ? "mine"
                    : undefined,
                page: 1,
                ownerMemberId:
                  groupRead && !publicStage ? query.ownerMemberId : undefined,
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
                          {records.data?.poolCounts?.[stage] !== undefined ? (
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
                          {records.data?.poolCounts?.LEGACY !== undefined ? (
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
                    ...(groupRead
                      ? [{ value: "group", label: "本组记录" }]
                      : []),
                    ...(schema.scopes.read === "ALL"
                      ? [{ value: "all", label: "全部记录" }]
                      : []),
                  ]
            }
          />
        ) : null}
        <div className={rl.viewRow}>
          <div className={rl.rowStart}>
            {currentMemberId ? (
              <RecordViewPicker
                tenantCode={tenantCode}
                memberId={currentMemberId}
                objectCode={objectCode}
                schema={schema}
                views={views}
                current={activeView}
                dirty={dirty}
                draft={draft}
                isAdmin={canFilterByOwner}
                onSelect={selectView}
              />
            ) : null}
          </div>
          <div className={rl.rowEnd}>
            <RecordSearch
              disabled={
                schema.queryFieldKeys !== undefined &&
                searchFieldLabels.length === 0
              }
              label={searchLabel}
              placeholder={`搜索${schema.object.name}`}
              value={query.search ?? ""}
              resetSignal={navigation}
              onSearch={(search) => apply(withFilter(query, { search }), true)}
            />
            {viewReady && (views.length || query.filterRule) ? (
              <RecordFilterPanel
                key={JSON.stringify([
                  tenantCode,
                  currentMemberId,
                  objectCode,
                  activeView?.id,
                ])}
                {...filterProps}
              />
            ) : null}
            <Popover
              trigger="click"
              placement="bottomRight"
              arrow={false}
              open={columnsOpen}
              onOpenChange={setColumnsOpen}
              content={<RecordDisplaySettings {...layout.settings} />}
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
            {groupRead &&
            currentMemberId &&
            query.scope !== "pool" &&
            query.poolStage !== "LEAD_POOL" &&
            query.poolStage !== "CUSTOMER_POOL" ? (
              <Select
                aria-label="按小组成员筛选"
                prefix="小组成员"
                variant="borderless"
                showSearch
                optionFilterProp="searchText"
                popupMatchSelectWidth={false}
                className={rl.quickFilter}
                value={
                  query.scope === "mine"
                    ? currentMemberId
                    : (query.ownerMemberId ?? "group")
                }
                onChange={(memberId: string) =>
                  apply({
                    ...query,
                    scope: memberId === currentMemberId ? "mine" : "group",
                    ownerMemberId:
                      memberId === currentMemberId || memberId === "group"
                        ? undefined
                        : memberId,
                    page: 1,
                  })
                }
                options={[
                  {
                    label: "小组成员",
                    options: memberSelectOptions(members, {
                      includeDisabled: true,
                      currentMemberId,
                    }),
                  },
                  { value: "group", label: "全部本组", searchText: "全部本组" },
                ]}
              />
            ) : null}
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
                filters={shortcuts.get(field.fieldKey)!}
                onChange={applyFieldFilter}
              />
            ))}
            {dateQuickField ? (
              <DateQuickFilter
                field={dateQuickField}
                filters={shortcuts.get(dateQuickField.fieldKey)!}
                onChange={applyFieldFilter}
              />
            ) : null}
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
            {views.length || query.filterRule ? (
              <RecordFilterChips {...filterProps} />
            ) : !baseBlocked && conditionFields.length ? (
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
          </div>
        </div>

        <div className={rl.mobileSort}>
          <Select
            aria-label="卡片排序字段"
            value={query.sort}
            onChange={(sort) => apply({ ...query, sort, page: 1 })}
            options={[
              { value: "recordNo", label: "业务编号" },
              { value: "nextFollowUpAt", label: "下次跟进" },
              { value: "createdAt", label: "创建时间" },
              { value: "updatedAt", label: "更新时间" },
              ...queryableFields
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
            layout.personalPrefs.headerTone === "default"
              ? undefined
              : layout.personalPrefs.headerTone
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
                const cardFields = recordCardFields(
                  {
                    ...schema,
                    fields: recordFields(schema, row),
                    groupFieldAccess: undefined,
                  },
                  layout.columnFieldKeys,
                );
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
                      {selection.rowSelection ? (
                        <Checkbox {...selection.cardCheckboxProps(row)} />
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
                      {layout.prefs.nextFollowUpVisible && (
                        <div>
                          <dt>下次跟进</dt>
                          <dd>{nextContact(row.nextFollowUpAt)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>业务编号</dt>
                        <dd className={styles.recordNo}>{row.recordNo}</dd>
                      </div>
                      {layout.showOwner ? (
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
                              action={callAction(row, field)}
                            />
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {layout.personalPrefs.activityVisible ? (
                      <RecordCommunicationPreview
                        record={row}
                        onOpen={() => setActivityRecord(row)}
                      />
                    ) : null}
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
          <RecordListTable
            schema={schema}
            layout={layout.table}
            rows={page.items}
            loading={records.isFetching}
            members={members}
            currentMemberId={currentMemberId}
            poolConfig={poolConfig}
            query={query}
            queryableFields={queryableFields}
            apply={apply}
            rowSelection={selection.rowSelection}
            emptyState={emptyState}
            recordPath={recordPath}
            go={go}
            canCommunicate={canCommunicate}
            onCommunicate={setCommunicationRecord}
            onActivity={setActivityRecord}
            rowMenu={rowMenu}
            nextContact={nextContact}
            callAction={callAction}
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
                    selection.records.some((row) => !editableRecord(row))
                  }
                  onClick={() => selection.open("edit")}
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
                  onClick={() => selection.open("assign")}
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
                  onClick={() => selection.open("delete")}
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
                onClick={selection.clear}
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
              onChange={(limit) =>
                navigateQuery({ ...request, limit, page: 1 })
              }
            />
            <Pagination
              size="small"
              current={page.page}
              pageSize={page.limit}
              total={page.total}
              showSizeChanger={false}
              hideOnSinglePage={false}
              onChange={(nextPage) =>
                navigateQuery({ ...request, page: nextPage })
              }
            />
          </div>
        </footer>

        {importOpen && !canImport && (
          <Alert type="warning" showIcon title="当前已无导入权限" />
        )}
        {canImport && importOpen ? (
          <RecordImportDrawer
            assistEnabled={importAssist}
            memberKey={currentMemberId}
            timeZone={page.timeZone ?? undefined}
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

        {selection.action?.kind === "assign" ? (
          <RecordBatchAssignDrawer
            tenantCode={tenantCode}
            objectCode={objectCode}
            records={selection.action.records}
            members={members}
            onClose={selection.close}
            onChanged={async () => {
              await records.refetch();
              router.refresh();
            }}
          />
        ) : null}
        {selection.action?.kind === "delete" ? (
          <RecordBatchDeleteDrawer
            tenantCode={tenantCode}
            objectCode={objectCode}
            records={selection.action.records}
            api={api}
            onChanged={async () => {
              const key = [
                "workspace",
                tenantCode,
                "records",
                objectCode,
                query,
              ];
              await queryClient.cancelQueries({ queryKey: key, exact: true });
              // A query refetch can pause indefinitely offline. This explicit
              // refresh must settle so deletion feedback remains dismissible.
              const result = await api.list(tenantCode, objectCode, query);
              queryClient.setQueryData(key, result);
              router.refresh();
            }}
            onClose={() => {
              selection.close();
              const lastPage = Math.max(1, Math.ceil(page.total / page.limit));
              if (query.page > lastPage) apply({ ...query, page: lastPage });
            }}
          />
        ) : null}
        {selection.action?.kind === "edit" && selectedCount > 0 ? (
          <RecordBatchEditDrawer
            tenantCode={tenantCode}
            schema={schema}
            records={selection.records}
            members={members}
            api={api}
            onClose={selection.close}
            onCompleted={async () => {
              selection.clear();
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
  disabled,
  label,
  placeholder,
  value,
  resetSignal,
  onSearch,
}: {
  disabled?: boolean;
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
      disabled={disabled}
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
