import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

// Owner-only settings (cloud accounts, AI, catalog storage). Members are sent
// back to their accessible settings; the backend also enforces these as owner-only.
export default async function OwnerSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();
  if (!role) redirect("/v1/auth/oidc-start");
  if (role !== "owner") redirect("/settings/preferences");
  return <>{children}</>;
}
