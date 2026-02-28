import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

export default async function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();

  if (!role) {
    redirect("/v1/auth/oidc-start");
  }

  // Only org_admin and promotor can manage org users
  if (role === "org_user") {
    redirect("/?redirected=1");
  }

  return <>{children}</>;
}
