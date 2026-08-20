"use client";

import { useState } from "react";

import { InviteMemberForm } from "./invite-member-form";
import {
  MemberTable,
  type InvitationPage,
  type TenantMemberPage,
} from "./member-table";

export function MemberAdministration({
  tenantCode,
  viewerRole,
  initialMemberPage,
  initialInvitationPage,
}: {
  tenantCode: string;
  viewerRole: "TENANT_ADMIN" | "EMPLOYEE";
  initialMemberPage: TenantMemberPage;
  initialInvitationPage: InvitationPage;
}) {
  const [invitationRevision, setInvitationRevision] = useState(0);

  return (
    <>
      {viewerRole === "TENANT_ADMIN" ? (
        <InviteMemberForm
          tenantCode={tenantCode}
          onInvitationCreated={() =>
            setInvitationRevision((current) => current + 1)
          }
        />
      ) : null}
      <MemberTable
        key={`${initialMemberPage.page}:${invitationRevision}`}
        tenantCode={tenantCode}
        viewerRole={viewerRole}
        initialMemberPage={initialMemberPage}
        initialInvitationPage={initialInvitationPage}
      />
    </>
  );
}
