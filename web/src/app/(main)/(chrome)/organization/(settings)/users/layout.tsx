import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

export default async function OrgUsersLayout({ children }: { children: React.ReactNode }) {
  const role = await getEffectiveRole();
  if (!role) redirect("/v1/auth/oidc-start");
  if (role === "member") redirect("/organization/details");
  return <>{children}</>;
}
