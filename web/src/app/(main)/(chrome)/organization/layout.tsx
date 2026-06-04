import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

// Workspace area: details are readable by any member; the owner additionally
// manages members (gated by the inner members/ layout). Both roles pass here.
export default async function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();
  if (!role) redirect("/v1/auth/oidc-start");
  return <>{children}</>;
}
