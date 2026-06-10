import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

// Member-only settings (cloud accounts, AI) — the data plane's own infrastructure.
// Owners have no data plane; they're sent back to their accessible settings.
export default async function MemberSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();
  if (!role) redirect("/v1/auth/oidc-start");
  if (role !== "member") redirect("/settings/preferences");
  return <>{children}</>;
}
