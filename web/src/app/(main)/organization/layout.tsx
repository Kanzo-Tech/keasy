import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";
import { OrgNav } from "@/components/organization/org-nav";

export default async function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();

  if (role === "promotor") {
    redirect("/?redirected=1");
  }

  if (!role) {
    redirect("/v1/auth/oidc-start");
  }

  return (
    <div className="flex h-full w-full gap-4 overflow-auto p-4">
      <aside className="w-1/5 min-w-50 max-w-62.5">
        <OrgNav />
      </aside>
      <div className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto">{children}</div>
      </div>
    </div>
  );
}
