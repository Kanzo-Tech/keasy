import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";

// Member-only settings (cloud accounts, AI) — the data plane's own infrastructure.
// Owners have no data plane; they're sent back to their accessible settings.
export default async function MemberSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = workspaceRole(await getSession());
  if (role === null) redirect("/api/auth/signin");
  if (role !== "member") redirect("/settings/preferences");
  return <>{children}</>;
}
