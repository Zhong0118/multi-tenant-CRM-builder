"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Page } from "@/components/layout/page";

import { BulkInviteMembers } from "./bulk-invite-members";
import { InviteMemberForm } from "./invite-member-form";
import { MemberGroups } from "./member-groups";
import { memberGroupsApi } from "./member-groups-api";
import {
  memberApi,
  MemberTable,
  type InvitationPage,
  type MemberListFilters,
  type TenantMemberPage,
} from "./member-table";

export function MemberAdministration({
  tenantCode,
  viewerRole,
  viewerMemberId,
  initialMemberPage,
  initialFilters,
  initialInvitationPage,
}: {
  tenantCode: string;
  viewerRole: "TENANT_ADMIN" | "EMPLOYEE";
  viewerMemberId?: string;
  initialMemberPage: TenantMemberPage;
  initialFilters?: MemberListFilters;
  initialInvitationPage: InvitationPage;
}) {
  const queryClient = useQueryClient();
  const groups = useQuery({
    queryKey: ["workspace", tenantCode, "member-groups"],
    queryFn: () => memberGroupsApi.list(tenantCode),
    staleTime: 30_000,
    enabled: viewerRole === "TENANT_ADMIN",
  });
  // Refresh the invitations in place. Remounting the table here would also
  // remount the invite dialog and drawer in its header, closing them before
  // they show the registration link and per-row results.
  const created = () => {
    void queryClient.invalidateQueries({
      queryKey: ["workspace", tenantCode, "invitations"],
    });
  };
  return (
    <Page width="settings">
      <MemberTable
        headerActions={
          viewerRole === "TENANT_ADMIN" ? (
            <>
              <BulkInviteMembers
                tenantCode={tenantCode}
                api={memberApi}
                onChanged={created}
              />
              <InviteMemberForm
                tenantCode={tenantCode}
                onInvitationCreated={created}
              />
            </>
          ) : undefined
        }
        key={initialMemberPage.page}
        tenantCode={tenantCode}
        viewerRole={viewerRole}
        viewerMemberId={viewerMemberId}
        initialMemberPage={initialMemberPage}
        initialFilters={initialFilters}
        initialInvitationPage={initialInvitationPage}
        groups={groups.data?.items}
        groupManagement={
          viewerRole === "TENANT_ADMIN" ? (
            <MemberGroups tenantCode={tenantCode} />
          ) : undefined
        }
      />
    </Page>
  );
}
