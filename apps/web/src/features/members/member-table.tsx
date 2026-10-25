"use client";

import type { components } from "@crm/contracts";
import { EllipsisOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Table,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { RouteForbidden } from "@/components/feedback/route-states";
import { useToast } from "@/components/feedback/use-toast";
import { MemberIdentity } from "@/components/identity/member-identity";
import { PageHeader } from "@/components/layout/page-header";
import { StatusTag } from "@/components/workbench/status-tag";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import { BulkMemberAccess } from "./bulk-member-access";
import { BulkMemberActions } from "./member-edit-actions";
import { MemberRowMenu } from "./member-row-menu";
import styles from "./members.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

export type TenantMember = components["schemas"]["TenantMemberResponseDto"];
export type TenantMemberPage =
  components["schemas"]["TenantMemberPageResponseDto"];
export type TenantInvitation =
  components["schemas"]["TenantInvitationResponseDto"];
export type InvitationPage = components["schemas"]["InvitationPageResponseDto"];

export interface MemberListFilters {
  q?: string;
  role?: TenantMember["role"];
  status?: TenantMember["status"];
}

type MemberCriteria = MemberListFilters & { page: number; limit: number };

export interface MemberApi {
  /** One page of the roster; 20 per page unless a `limit` (≤100) is given. */
  listMembers(
    tenantCode: string,
    page: number,
    limit?: number,
    filters?: MemberListFilters,
  ): Promise<TenantMemberPage>;
  listInvitations(tenantCode: string, cursor?: string): Promise<InvitationPage>;
  invite(
    tenantCode: string,
    input: {
      phone: string;
      displayName?: string;
      role: "TENANT_ADMIN" | "EMPLOYEE";
    },
  ): Promise<components["schemas"]["CreatedInvitationResponseDto"]>;
  resend(
    tenantCode: string,
    id: string,
  ): Promise<components["schemas"]["InvitationResentResponseDto"]>;
  revoke(
    tenantCode: string,
    id: string,
  ): Promise<components["schemas"]["MembershipActionResponseDto"]>;
  changeMemberStatus(
    tenantCode: string,
    memberId: string,
    status: "ACTIVE" | "DISABLED",
  ): Promise<TenantMember>;
}

async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data) return result.data;
  throw toApiError(result.error, result.response.status);
}

export const memberApi: MemberApi = {
  async listMembers(tenantCode, page, limit = 20, filters = {}) {
    return dataOrThrow(
      await browserApiClient.GET("/api/v1/workspaces/{tenantCode}/members", {
        params: { path: { tenantCode }, query: { page, limit, ...filters } },
      }),
    );
  },
  async listInvitations(tenantCode, cursor) {
    return dataOrThrow(
      await browserApiClient.GET(
        "/api/v1/workspaces/{tenantCode}/invitations",
        {
          params: {
            path: { tenantCode },
            query: cursor ? { cursor } : {},
          },
        },
      ),
    );
  },
  async invite(tenantCode, input) {
    return dataOrThrow(
      await browserApiClient.POST(
        "/api/v1/workspaces/{tenantCode}/invitations",
        { params: { path: { tenantCode } }, body: input },
      ),
    );
  },
  async resend(tenantCode, id) {
    return dataOrThrow(
      await browserApiClient.POST(
        "/api/v1/workspaces/{tenantCode}/invitations/{id}/resend",
        { params: { path: { tenantCode, id } } },
      ),
    );
  },
  async revoke(tenantCode, id) {
    return dataOrThrow(
      await browserApiClient.POST(
        "/api/v1/workspaces/{tenantCode}/invitations/{id}/revoke",
        { params: { path: { tenantCode, id } } },
      ),
    );
  },
  async changeMemberStatus(tenantCode, memberId, status) {
    return dataOrThrow(
      await browserApiClient.PATCH(
        "/api/v1/workspaces/{tenantCode}/members/{memberId}",
        {
          params: { path: { tenantCode, memberId } },
          body: { status },
        },
      ),
    );
  },
};

/** 「188 0000 1001」 for a mainland number, anything else as stored. */
export function formatPhone(phone: string | undefined): string | undefined {
  const mainland = phone?.match(/^\+86(1\d{2})(\d{4})(\d{4})$/);
  return mainland ? `${mainland[1]} ${mainland[2]} ${mainland[3]}` : phone;
}

const ROLE_TEXT = { TENANT_ADMIN: "公司管理员", EMPLOYEE: "员工" } as const;
type RoleFilter = "ALL" | TenantMember["role"];
type StatusFilter = "ALL" | TenantMember["status"];

function memberCriteriaPath(tenantCode: string, criteria: MemberCriteria) {
  const params = new URLSearchParams({ page: String(criteria.page) });
  if (criteria.limit !== 20) params.set("limit", String(criteria.limit));
  if (criteria.q) params.set("q", criteria.q);
  if (criteria.role) params.set("role", criteria.role);
  if (criteria.status) params.set("status", criteria.status);
  return `/workspace/${tenantCode}/members?${params}`;
}

export function MemberTable({
  tenantCode,
  viewerRole,
  viewerMemberId,
  initialMemberPage,
  initialFilters = {},
  initialInvitationPage,
  headerActions,
  api = memberApi,
  navigate,
}: {
  tenantCode: string;
  viewerRole: "TENANT_ADMIN" | "EMPLOYEE";
  viewerMemberId?: string;
  initialMemberPage: TenantMemberPage;
  initialFilters?: MemberListFilters;
  initialInvitationPage: InvitationPage;
  /** 邀请成员 and 批量邀请, rendered in the page header beside the count. */
  headerActions?: ReactNode;
  api?: MemberApi;
  navigate?: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [criteria, setCriteria] = useState<MemberCriteria>({
    page: initialMemberPage.page,
    limit: initialMemberPage.limit,
    ...initialFilters,
  });
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [revoking, setRevoking] = useState<TenantInvitation>();
  const [query, setQuery] = useState(initialFilters.q ?? "");
  const search = query.trim();
  const searchPending = search !== (criteria.q ?? "");
  const filtering = Boolean(criteria.q || criteria.role || criteria.status);
  const cursor = cursors[page - 1];
  const membersQueryKey = ["workspace", tenantCode, "members"] as const;
  const invitationsQueryKey = ["workspace", tenantCode, "invitations"] as const;
  const { page: memberPageNumber, limit, ...filters } = criteria;
  const membersQuery = useQuery({
    queryKey: [...membersQueryKey, criteria],
    queryFn: () =>
      api.listMembers(tenantCode, memberPageNumber, limit, filters),
    initialData:
      memberPageNumber === initialMemberPage.page &&
      limit === initialMemberPage.limit &&
      criteria.q === initialFilters.q &&
      criteria.role === initialFilters.role &&
      criteria.status === initialFilters.status
        ? initialMemberPage
        : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: viewerRole === "TENANT_ADMIN",
  });
  useEffect(() => {
    if (!searchPending) return;
    const timer = setTimeout(() => {
      setCriteria((current) => ({
        ...current,
        page: 1,
        q: search || undefined,
      }));
      setSelectedIds([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchPending]);

  useEffect(() => {
    if (viewerRole !== "TENANT_ADMIN") return;
    const path = memberCriteriaPath(tenantCode, criteria);
    if (navigate) navigate(path);
    else if (`${window.location.pathname}${window.location.search}` !== path)
      window.history.replaceState(null, "", path);
  }, [criteria, navigate, tenantCode, viewerRole]);

  useEffect(() => {
    if (!membersQuery.data || membersQuery.isFetching || membersQuery.error)
      return;
    const lastPage = Math.max(1, Math.ceil(membersQuery.data.total / limit));
    if (memberPageNumber <= lastPage) return;
    // A successful refresh can shrink the result set after a member is changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCriteria((current) => ({ ...current, page: lastPage }));
    setSelectedIds([]);
  }, [
    membersQuery.data,
    membersQuery.isFetching,
    membersQuery.error,
    limit,
    memberPageNumber,
  ]);

  function changeCriteria(change: Partial<MemberCriteria>) {
    setSelectedIds([]);
    setCriteria((current) => ({
      ...current,
      page: 1,
      q: search || undefined,
      ...change,
    }));
  }
  const invitationsQuery = useQuery({
    queryKey: [...invitationsQueryKey, cursor ?? "first"],
    queryFn: () => api.listInvitations(tenantCode, cursor),
    initialData: page === 1 ? initialInvitationPage : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: viewerRole === "TENANT_ADMIN",
  });
  const refresh = (scope: "members" | "invitations") =>
    queryClient.invalidateQueries({
      queryKey: ["workspace", tenantCode, scope],
      exact: false,
    });
  const invitationMutation = useMutation({
    mutationFn: ({
      action,
      id,
    }: {
      action: "resend" | "revoke";
      id: string;
    }) =>
      action === "resend"
        ? api.resend(tenantCode, id)
        : api.revoke(tenantCode, id),
    onSuccess: (_data, variables) => {
      if (variables.action === "revoke") {
        setPage(1);
        setCursors([undefined]);
      }
      toast.success(
        variables.action === "resend" ? "邀请已重新发送" : "邀请已撤销",
      );
      void refresh("invitations");
    },
    onMutate: () => setError(undefined),
    onError: showError,
  });
  const memberMutation = useMutation({
    mutationFn: ({
      member,
      status,
    }: {
      member: TenantMember;
      status: "ACTIVE" | "DISABLED";
    }) => api.changeMemberStatus(tenantCode, member.id, status),
    onSuccess: (_data, { member, status }) => {
      const name = member.displayName ?? "该成员";
      toast.success(
        status === "ACTIVE" ? `${name}已恢复使用` : `已停用${name}`,
      );
      void refresh("members");
    },
    onMutate: () => setError(undefined),
    onError: showError,
  });

  function showError(caught: unknown) {
    const apiError = toApiError(caught);
    setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
  }

  function clearFilters() {
    setQuery("");
    setCriteria((current) => ({ page: 1, limit: current.limit }));
    setSelectedIds([]);
  }

  if (viewerRole !== "TENANT_ADMIN") {
    return (
      <RouteForbidden
        title="仅公司管理员可管理成员"
        homeHref={`/workspace/${tenantCode}`}
      />
    );
  }

  const activeAdminCount = membersQuery.data?.activeAdminCount ?? 0;
  const memberColumns: ColumnsType<TenantMember> = [
    {
      title: "成员",
      key: "member",
      render: (_, member) => (
        <MemberIdentity
          size="lg"
          currentMemberId={viewerMemberId}
          member={{
            id: member.id,
            displayName: member.displayName ?? null,
            status: member.status,
          }}
          description={
            <>
              <span className={styles.compactRole}>
                {ROLE_TEXT[member.role]}
                {" · "}
              </span>
              {formatPhone(member.phone) ?? "未提供手机号"}
            </>
          }
        />
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 140,
      responsive: ["md"],
      render: (role: TenantMember["role"]) => ROLE_TEXT[role],
    },
    {
      title: "访问权限",
      key: "access",
      width: 168,
      responsive: ["md"],
      render: (_, member) =>
        member.status !== "ACTIVE" ? (
          <span className={styles.muted}>停用期间无法访问</span>
        ) : member.role === "TENANT_ADMIN" ? (
          <span className={styles.muted}>全部业务表</span>
        ) : (
          <Link
            className={styles.accessLink}
            href={`/workspace/${tenantCode}/members/${member.id}/access`}
            aria-label={`查看和设置${member.displayName ?? "该成员"}的访问权限`}
          >
            查看和设置
          </Link>
        ),
    },
    {
      title: <span className={styles.visuallyHidden}>操作</span>,
      key: "actions",
      width: 56,
      align: "center",
      render: (_, member) => (
        <MemberRowMenu
          tenantCode={tenantCode}
          member={member}
          isSelf={member.id === viewerMemberId}
          protectsFinalAdmin={
            member.status === "ACTIVE" &&
            member.role === "TENANT_ADMIN" &&
            activeAdminCount <= 1
          }
          onStatusChange={(status) => memberMutation.mutate({ member, status })}
          onChanged={() => void refresh("members")}
          onError={setError}
        />
      ),
    },
  ];
  const invitationColumns: ColumnsType<TenantInvitation> = [
    {
      title: "受邀人",
      key: "person",
      render: (_, invitation) => (
        <MemberIdentity
          size="lg"
          unassignedLabel={invitation.displayName ?? "未填写姓名"}
          memberId={null}
          description={
            <>
              {formatPhone(invitation.targetPhone)}
              {invitation.status === "PENDING"
                ? ` · ${formatExpiry(invitation.expiresAt)}`
                : null}
            </>
          }
        />
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 140,
      responsive: ["sm"],
      render: (role: TenantInvitation["role"]) => ROLE_TEXT[role],
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (status: TenantInvitation["status"]) => (
        <StatusTag tone={invitationTone(status)}>
          {invitationStatusText[status]}
        </StatusTag>
      ),
    },
    {
      title: <span className={styles.visuallyHidden}>操作</span>,
      key: "actions",
      width: 56,
      align: "center",
      render: (_, invitation) =>
        invitation.status === "PENDING" ? (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
              items: [
                {
                  key: "resend",
                  label: "重新发送",
                  onClick: () =>
                    invitationMutation.mutate({
                      action: "resend",
                      id: invitation.id,
                    }),
                },
                {
                  key: "revoke",
                  label: "撤销邀请",
                  danger: true,
                  onClick: () => setRevoking(invitation),
                },
              ],
            }}
          >
            <Button
              type="text"
              size="small"
              aria-label={`更多操作 ${invitation.displayName ?? invitation.targetPhone ?? "邀请"}`}
              icon={<EllipsisOutlined aria-hidden />}
              loading={
                invitationMutation.isPending &&
                invitationMutation.variables?.id === invitation.id
              }
            />
          </Dropdown>
        ) : null,
    },
  ];
  const invitationPage = invitationsQuery.data;
  const pendingCount = (invitationPage?.items ?? []).filter(
    (item) => item.status === "PENDING",
  ).length;
  const memberItems = membersQuery.data?.items ?? [];
  const selectedMembers = memberItems.filter((member) =>
    selectedIds.includes(member.id),
  );
  const listError = membersQuery.error;
  const total = membersQuery.data?.total;

  return (
    <>
      <PageHeader
        title="成员"
        count={total}
        description={
          <>
            {membersQuery.data
              ? `${activeAdminCount} 位在职管理员`
              : "公司管理员"}
            ，可使用全部业务表和设置。员工按业务表的员工默认权限访问，可为个人设置例外。
          </>
        }
        extra={headerActions}
      />
      <div className={styles.toolbar}>
        <Segmented
          aria-label="成员与邀请"
          value={tab}
          onChange={(value) => setTab(value as "members" | "invitations")}
          options={[
            { value: "members", label: "成员" },
            {
              value: "invitations",
              label: (
                <span className={styles.tabLabel}>
                  邀请
                  {pendingCount ? (
                    <span className={styles.tabCount}>{pendingCount}</span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
        {tab === "members" ? (
          <div className={styles.filters} role="search" aria-label="筛选成员">
            <Input
              allowClear
              maxLength={100}
              aria-label="搜索成员"
              placeholder="搜索姓名或手机号"
              prefix={<SearchOutlined aria-hidden />}
              value={query}
              className={styles.search}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIds([]);
              }}
            />
            <Select
              aria-label="角色"
              value={criteria.role ?? "ALL"}
              className={styles.filter}
              popupMatchSelectWidth={false}
              onChange={(value: RoleFilter) => {
                changeCriteria({ role: value === "ALL" ? undefined : value });
              }}
              options={[
                { value: "ALL", label: "全部角色" },
                { value: "TENANT_ADMIN", label: "公司管理员" },
                { value: "EMPLOYEE", label: "员工" },
              ]}
            />
            <Select
              aria-label="状态"
              value={criteria.status ?? "ALL"}
              className={styles.filter}
              popupMatchSelectWidth={false}
              onChange={(value: StatusFilter) => {
                changeCriteria({ status: value === "ALL" ? undefined : value });
              }}
              options={[
                { value: "ALL", label: "全部状态" },
                { value: "ACTIVE", label: "在职" },
                { value: "DISABLED", label: "已停用" },
              ]}
            />
          </div>
        ) : null}
      </div>
      {tab === "members" && (selectedIds.length > 0 || filtering) ? (
        <div className={styles.listBar}>
          {selectedIds.length > 0 ? (
            <div
              className={styles.selection}
              role="toolbar"
              aria-label="批量操作"
            >
              <span>已选 {selectedIds.length} 人</span>
              <BulkMemberAccess
                tenantCode={tenantCode}
                selected={selectedMembers}
                buttonLabel="设置访问权限"
                onChanged={() => {
                  setSelectedIds([]);
                  void refresh("members");
                }}
              />
              <BulkMemberActions
                tenantCode={tenantCode}
                selected={selectedMembers.filter(
                  (member) => member.id !== viewerMemberId,
                )}
                buttonLabel="批量管理"
                onChanged={() => {
                  setSelectedIds([]);
                  void refresh("members");
                }}
              />
              <Button type="text" onClick={() => setSelectedIds([])}>
                取消选择
              </Button>
            </div>
          ) : (
            <span className={styles.resultCount} role="status">
              {listError
                ? "成员名单读取失败"
                : searchPending ||
                    (membersQuery.isFetching && !membersQuery.data)
                  ? "正在查询成员…"
                  : `找到 ${total ?? 0} 位成员`}
            </span>
          )}
          {filtering ? (
            <Button type="link" size="small" onClick={clearFilters}>
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => setError(undefined)}
          className={styles.alert}
        />
      ) : null}
      {tab === "members" && listError ? (
        <Alert
          type="error"
          showIcon
          className={styles.alert}
          title={`成员名单读取失败：${toApiError(listError).message}`}
          action={
            <Button size="small" onClick={() => void membersQuery.refetch()}>
              重试
            </Button>
          }
        />
      ) : null}
      {tab === "members" ? (
        <Table
          className={styles.table}
          rowKey="id"
          aria-label="成员名册"
          columns={memberColumns}
          rowClassName={(member) =>
            member.status === "DISABLED" ? styles.disabledRow : ""
          }
          rowSelection={{
            columnWidth: 40,
            selectedRowKeys: selectedIds,
            onChange: setSelectedIds,
            getTitleCheckboxProps: () => ({ "aria-label": "选择本页全部成员" }),
            getCheckboxProps: (member) => ({
              disabled:
                searchPending ||
                membersQuery.isFetching ||
                !viewerMemberId ||
                member.id === viewerMemberId,
              "aria-label":
                member.id === viewerMemberId
                  ? "不能选择自己"
                  : `选择 ${member.displayName ?? formatPhone(member.phone) ?? "成员"}`,
            }),
          }}
          dataSource={memberItems}
          loading={searchPending || membersQuery.isFetching}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  listError
                    ? "名单暂时无法读取，请重试"
                    : searchPending || membersQuery.isFetching
                      ? "正在查询成员…"
                      : filtering
                        ? "没有符合条件的成员"
                        : "公司还没有成员"
                }
              >
                {filtering &&
                !listError &&
                !searchPending &&
                !membersQuery.isFetching ? (
                  <Button onClick={clearFilters}>清除筛选</Button>
                ) : null}
              </Empty>
            ),
          }}
          pagination={
            membersQuery.data && !listError
              ? {
                  current: memberPageNumber,
                  pageSize: limit,
                  total: total ?? 0,
                  hideOnSinglePage: false,
                  showSizeChanger: true,
                  pageSizeOptions: [20, 50, 100],
                  showTotal: (count) => `共 ${count} 位成员`,
                  locale: { items_per_page: "人 / 页" },
                  onChange: (nextPage, nextLimit) => {
                    changeCriteria({
                      page: nextLimit === limit ? nextPage : 1,
                      limit: nextLimit,
                    });
                  },
                }
              : false
          }
        />
      ) : (
        <>
          {invitationsQuery.error ? (
            <Alert
              type="error"
              showIcon
              className={styles.alert}
              title={`邀请读取失败：${toApiError(invitationsQuery.error).message}`}
              action={
                <Button
                  size="small"
                  onClick={() => void invitationsQuery.refetch()}
                >
                  重试
                </Button>
              }
            />
          ) : null}
          <Table
            className={styles.table}
            rowKey="id"
            aria-label="待处理邀请"
            columns={invitationColumns}
            dataSource={invitationPage?.items ?? []}
            loading={invitationsQuery.isFetching}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="没有待处理的邀请。"
                />
              ),
            }}
            pagination={{
              current: page,
              pageSize: 20,
              hideOnSinglePage: true,
              showSizeChanger: false,
              total: invitationPage?.nextCursor ? page * 20 + 1 : page * 20,
              onChange: (nextPage) => {
                if (nextPage > page && invitationPage?.nextCursor) {
                  setCursors((current) => {
                    const next = [...current];
                    next[nextPage - 1] = invitationPage.nextCursor;
                    return next;
                  });
                }
                setPage(nextPage);
              },
            }}
          />
        </>
      )}
      <Modal
        open={Boolean(revoking)}
        title="撤销这条邀请？"
        okText="撤销邀请"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={OVERLAY_SIZE.confirm}
        onCancel={() => setRevoking(undefined)}
        onOk={() => {
          if (revoking)
            invitationMutation.mutate({ action: "revoke", id: revoking.id });
          setRevoking(undefined);
        }}
      >
        撤销后对方无法再用这条邀请加入公司，需要时可以重新邀请。
      </Modal>
    </>
  );
}

/** 「3 天后过期」, 「1 天内过期」 or 「已过期」 for a pending invitation. */
function formatExpiry(expiresAt: string, now = Date.now()) {
  const days = Math.ceil((Date.parse(expiresAt) - now) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "已过期";
  if (days === 1) return "1 天内过期";
  return `${days} 天后过期`;
}

const invitationStatusText: Record<TenantInvitation["status"], string> = {
  PENDING: "等待接受",
  ACCEPTED: "已接受",
  DECLINED: "已拒绝",
  REVOKED: "已撤销",
  EXPIRED: "已过期",
};

function invitationTone(status: TenantInvitation["status"]) {
  if (status === "PENDING") return "warning" as const;
  if (status === "ACCEPTED") return "success" as const;
  return "neutral" as const;
}
