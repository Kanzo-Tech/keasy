import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

export default async function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();

  if (!role) {
    redirect("/login");
  }

  // Only org_admin and promotor can manage org users
  if (role === "org_user") {
    redirect("/connections?redirected=1");
  }

  return <>{children}</>;
}
