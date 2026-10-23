"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Page } from "@/components/layout/page";

import { BulkInviteMembers } from "./bulk-invite-members";
import { InviteMemberForm } from "./invite-member-form";
import {
  memberApi,
  MemberTable,
  type InvitationPage,
  type TenantMemberPage,
} from "./member-table";

export function MemberAdministration({
  tenantCode,
  viewerRole,
  viewerMemberId,
  initialMemberPage,
  initialInvitationPage,
}: {
  tenantCode: string;
  viewerRole: "TENANT_ADMIN" | "EMPLOYEE";
  viewerMemberId?: string;
  initialMemberPage: TenantMemberPage;
  initialInvitationPage: InvitationPage;
}) {
  const [invitationRevision, setInvitationRevision] = useState(0);

  const queryClient = useQueryClient();
  const created = () => {
    setInvitationRevision((current) => current + 1);
    void queryClient.invalidateQueries({ queryKey: ["workspace", tenantCode, "invitations"] });
  };
  return (
    <Page width="settings">
      <MemberTable
        headerActions={
          viewerRole === "TENANT_ADMIN" ? (
            <>
              <BulkInviteMembers tenantCode={tenantCode} api={memberApi} onChanged={created} />
              <InviteMemberForm tenantCode={tenantCode} onInvitationCreated={created} />
            </>
          ) : undefined
        }
        key={`${initialMemberPage.page}:${invitationRevision}`}
        tenantCode={tenantCode}
        viewerRole={viewerRole}
        viewerMemberId={viewerMemberId}
        initialMemberPage={initialMemberPage}
        initialInvitationPage={initialInvitationPage}
      />
    </Page>
  );
}
