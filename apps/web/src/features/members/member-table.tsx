"use client";

import type { components } from "@crm/contracts";
import { EllipsisOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Empty, Modal, Result, Segmented, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

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

export interface MemberApi {
  listMembers(tenantCode: string, page: number): Promise<TenantMemberPage>;
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
  async listMembers(tenantCode, page) {
    return dataOrThrow(
      await browserApiClient.GET("/api/v1/workspaces/{tenantCode}/members", {
        params: { path: { tenantCode }, query: { page, limit: 20 } },
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

export function MemberTable({
  tenantCode,
  viewerRole,
  viewerMemberId,
  initialMemberPage,
  initialInvitationPage,
  headerActions,
  api = memberApi,
  navigate,
}: {
  tenantCode: string;
  viewerRole: "TENANT_ADMIN" | "EMPLOYEE";
  viewerMemberId?: string;
  initialMemberPage: TenantMemberPage;
  initialInvitationPage: InvitationPage;
  /** 邀请成员 and 批量邀请, rendered in the page header beside the count. */
  headerActions?: ReactNode;
  api?: MemberApi;
  navigate?: (path: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [memberPageNumber, setMemberPageNumber] = useState(
    initialMemberPage.page,
  );
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [revoking, setRevoking] = useState<TenantInvitation>();
  const cursor = cursors[page - 1];
  const membersQueryKey = ["workspace", tenantCode, "members"] as const;
  const invitationsQueryKey = ["workspace", tenantCode, "invitations"] as const;
  const membersQuery = useQuery({
    queryKey: [...membersQueryKey, memberPageNumber],
    queryFn: () => api.listMembers(tenantCode, memberPageNumber),
    initialData:
      memberPageNumber === initialMemberPage.page
        ? initialMemberPage
        : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: viewerRole === "TENANT_ADMIN",
  });
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
      void refresh("invitations");
    },
    onMutate: () => setError(undefined),
    onError: showError,
  });
  const memberMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "ACTIVE" | "DISABLED";
    }) => api.changeMemberStatus(tenantCode, id, status),
    onSuccess: () => void refresh("members"),
    onMutate: () => setError(undefined),
    onError: showError,
  });

  function showError(caught: unknown) {
    const apiError = toApiError(caught);
    setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
  }

  if (viewerRole !== "TENANT_ADMIN") {
    return (
      <Result
        status="403"
        title="仅公司管理员可管理成员"
        subTitle="你可以继续使用工作空间内已授权的业务功能。"
      />
    );
  }

  const activeAdminCount = membersQuery.data?.activeAdminCount ?? 0;
  const memberColumns: ColumnsType<TenantMember> = [
    {
      title: "成员",
      key: "member",
      render: (_, member) => (
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden>
            {(member.displayName ?? member.phone ?? "?").slice(0, 1)}
          </span>
          <span className={styles.personText}>
            <strong>{member.displayName ?? "未设置姓名"}</strong>
            <span className={styles.secondary}>{member.phone ?? "未提供手机号"}</span>
          </span>
        </div>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 160,
      responsive: ["md"],
      render: (role: TenantMember["role"]) => (role === "TENANT_ADMIN" ? "公司管理员" : "员工"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      responsive: ["sm"],
      render: (status: TenantMember["status"]) => (
        <StatusTag tone={status === "ACTIVE" ? "success" : "neutral"}>
          {status === "ACTIVE" ? "在职" : "已停用"}
        </StatusTag>
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
            member.status === "ACTIVE" && member.role === "TENANT_ADMIN" && activeAdminCount <= 1
          }
          onStatusChange={(status) => memberMutation.mutate({ id: member.id, status })}
          onChanged={() => void refresh("members")}
        />
      ),
    },
  ];
  const invitationColumns: ColumnsType<TenantInvitation> = [
    {
      title: "受邀人",
      key: "person",
      render: (_, invitation) => (
        <div className={styles.person}>
          <span className={styles.avatar} data-pending aria-hidden>
            {(invitation.displayName ?? invitation.targetPhone ?? "?").slice(0, 1)}
          </span>
          <span className={styles.personText}>
            <strong>{invitation.displayName ?? "未填写姓名"}</strong>
            <span className={styles.secondary}>{invitation.targetPhone}</span>
          </span>
        </div>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 160,
      render: (role: TenantInvitation["role"]) => (role === "TENANT_ADMIN" ? "公司管理员" : "员工"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (status: TenantInvitation["status"]) => (
        <StatusTag tone={invitationTone(status)}>{invitationStatusText[status]}</StatusTag>
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
                  onClick: () => invitationMutation.mutate({ action: "resend", id: invitation.id }),
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
            />
          </Dropdown>
        ) : null,
    },
  ];
  const invitationPage = invitationsQuery.data;
  const pendingCount = (invitationPage?.items ?? []).filter((item) => item.status === "PENDING").length;
  const memberItems = membersQuery.data?.items ?? [];
  const selectedMembers = memberItems.filter((member) => selectedIds.includes(member.id));

  return (
    <>
      <PageHeader title="成员" count={membersQuery.data?.total ?? 0} extra={headerActions} />
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
                  邀请{pendingCount ? <span className={styles.tabCount}>{pendingCount}</span> : null}
                </span>
              ),
            },
          ]}
        />
        {tab === "members" && selectedIds.length > 0 ? (
          <div className={styles.selection} role="toolbar" aria-label="批量操作">
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
              selected={selectedMembers.filter((member) => member.id !== viewerMemberId)}
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
        ) : null}
      </div>
      {error ? <Alert type="error" showIcon title={error} className={styles.alert} /> : null}
      {tab === "members" ? (
        <Table
          className={styles.table}
          rowKey="id"
          aria-label="成员名册"
          columns={memberColumns}
          rowSelection={{
            columnWidth: 40,
            selectedRowKeys: selectedIds,
            onChange: setSelectedIds,
            getCheckboxProps: (member) => ({
              disabled: !viewerMemberId || member.id === viewerMemberId,
            }),
          }}
          dataSource={memberItems}
          loading={membersQuery.isFetching}
          pagination={{
            current: memberPageNumber,
            pageSize: 20,
            total: membersQuery.data?.total ?? 0,
            hideOnSinglePage: true,
            showSizeChanger: false,
            onChange: (nextPage) => {
              setSelectedIds([]);
              setMemberPageNumber(nextPage);
              (navigate ?? router.push)(`/workspace/${tenantCode}/members?page=${nextPage}`);
            },
          }}
        />
      ) : (
        <Table
          className={styles.table}
          rowKey="id"
          aria-label="待处理邀请"
          columns={invitationColumns}
          dataSource={invitationPage?.items ?? []}
          loading={invitationsQuery.isFetching}
          scroll={{ x: 600 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待处理的邀请。" /> }}
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
          if (revoking) invitationMutation.mutate({ action: "revoke", id: revoking.id });
          setRevoking(undefined);
        }}
      >
        撤销后对方无法再用这条邀请加入公司，需要时可以重新邀请。
      </Modal>
    </>
  );
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
