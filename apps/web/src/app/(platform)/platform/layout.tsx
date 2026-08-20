import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { PlatformShell } from "@/components/layout/platform-shell";
import { requireUser } from "@/lib/auth/require-user";

export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser("/platform");
  if (!user.isPlatformAdmin) redirect("/workspaces");
  return <PlatformShell>{children}</PlatformShell>;
}
