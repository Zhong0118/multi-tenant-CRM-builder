"use client";

import type { components } from "@crm/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Popconfirm, Result, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import styles from "./members.module.css";

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
    input: { phone: string; role: "TENANT_ADMIN" | "EMPLOYEE" },
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
  initialMemberPage,
  initialInvitationPage,
  api = memberApi,
  navigate,
}: {
  tenantCode: string;
  viewerRole: "TENANT_ADMIN" | "EMPLOYEE";
  initialMemberPage: TenantMemberPage;
  initialInvitationPage: InvitationPage;
  api?: MemberApi;
  navigate?: (path: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [memberPageNumber, setMemberPageNumber] = useState(
    initialMemberPage.page,
  );
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [error, setError] = useState<string>();
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
        <div>
          <strong>{member.displayName ?? "未设置姓名"}</strong>
          <span className={styles.secondary}>
            {member.phone ?? "未提供手机号"}
          </span>
        </div>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      render: (role: TenantMember["role"]) =>
        role === "TENANT_ADMIN" ? "公司管理员" : "员工",
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (status: TenantMember["status"]) => (
        <Tag color={status === "ACTIVE" ? "green" : "default"}>
          {status === "ACTIVE" ? "在职" : "已停用"}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      render: (_, member) => {
        const protectsFinalAdmin =
          member.status === "ACTIVE" &&
          member.role === "TENANT_ADMIN" &&
          activeAdminCount <= 1;
        return (
          <Space>
            {/* Only an employee's access can be restricted: an administrator
                holds fixed full access on every published object. */}
            {member.role === "EMPLOYEE" && member.status === "ACTIVE" ? (
              <Link
                href={`/workspace/${tenantCode}/members/${member.id}/access`}
                aria-label={`访问权限 ${member.displayName ?? "该成员"}`}
              >
                访问权限
              </Link>
            ) : null}
            {member.status === "ACTIVE" ? (
              <Popconfirm
                title={`确认停用 ${member.displayName ?? "该成员"}？`}
                description="该成员现有会话将在下一次工作空间请求时失效。"
                disabled={protectsFinalAdmin}
                onConfirm={() =>
                  memberMutation.mutate({ id: member.id, status: "DISABLED" })
                }
              >
                <Button
                  danger
                  type="link"
                  disabled={protectsFinalAdmin}
                  aria-label={`停用 ${member.displayName ?? "该成员"}`}
                >
                  停用
                </Button>
              </Popconfirm>
            ) : (
              <Button
                type="link"
                onClick={() =>
                  memberMutation.mutate({ id: member.id, status: "ACTIVE" })
                }
              >
                恢复
              </Button>
            )}
          </Space>
        );
      },
    },
  ];
  const invitationColumns: ColumnsType<TenantInvitation> = [
    { title: "手机号", dataIndex: "targetPhone" },
    {
      title: "角色",
      dataIndex: "role",
      render: (role: TenantInvitation["role"]) =>
        role === "TENANT_ADMIN" ? "公司管理员" : "员工",
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (status: TenantInvitation["status"]) => (
        <Tag color={status === "PENDING" ? "gold" : "default"}>
          {status === "PENDING" ? "等待接受" : status}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      render: (_, invitation) =>
        invitation.status === "PENDING" ? (
          <Space>
            <Button
              type="link"
              onClick={() =>
                invitationMutation.mutate({
                  action: "resend",
                  id: invitation.id,
                })
              }
            >
              重新发送
            </Button>
            <Popconfirm
              title="确认撤销邀请？"
              onConfirm={() =>
                invitationMutation.mutate({
                  action: "revoke",
                  id: invitation.id,
                })
              }
            >
              <Button danger type="link">
                撤销邀请
              </Button>
            </Popconfirm>
          </Space>
        ) : null,
    },
  ];
  const invitationPage = invitationsQuery.data;

  return (
    <div className={styles.tables}>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <section className={styles.tablePanel} aria-labelledby="pending-heading">
        <div className={styles.tableHeading}>
          <div>
            <span className={styles.eyebrow}>INVITATION QUEUE</span>
            <h2 id="pending-heading">待处理邀请</h2>
          </div>
          <span>每页 20 条</span>
        </div>
        <Table
          rowKey="id"
          columns={invitationColumns}
          dataSource={invitationPage?.items ?? []}
          loading={invitationsQuery.isFetching}
          pagination={{
            current: page,
            pageSize: 20,
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
      </section>
      <section className={styles.tablePanel} aria-labelledby="members-heading">
        <div className={styles.tableHeading}>
          <div>
            <span className={styles.eyebrow}>ACCESS ROSTER</span>
            <h2 id="members-heading">成员名册</h2>
          </div>
          <span>{membersQuery.data?.total ?? 0} 位成员</span>
        </div>
        <Table
          rowKey="id"
          columns={memberColumns}
          dataSource={membersQuery.data?.items ?? []}
          loading={membersQuery.isFetching}
          pagination={{
            current: memberPageNumber,
            pageSize: 20,
            total: membersQuery.data?.total ?? 0,
            showSizeChanger: false,
            onChange: (nextPage) => {
              setMemberPageNumber(nextPage);
              (navigate ?? router.push)(
                `/workspace/${tenantCode}/members?page=${nextPage}`,
              );
            },
          }}
        />
      </section>
    </div>
  );
}
