import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";
import { PageShell } from "@/components/layout/page-shell";
import { OwnerDashboard } from "./(owner)/owner-dashboard";
import { MemberDashboard } from "./(member)/member-dashboard";

export default async function HomePage() {
  const role = workspaceRole(await getSession());

  return (
    <PageShell>
      <PageShell.Content>
        {role === "owner" ? <OwnerDashboard /> : <MemberDashboard />}
      </PageShell.Content>
    </PageShell>
  );
}
