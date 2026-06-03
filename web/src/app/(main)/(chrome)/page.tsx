import { getEffectiveRole } from "@/lib/auth-check";
import { PageShell } from "@/components/layout/page-shell";
import { OwnerDashboard } from "./(owner)/owner-dashboard";
import { MemberDashboard } from "./(member)/member-dashboard";

export default async function HomePage() {
  const role = await getEffectiveRole();

  if (role === "owner") {
    return (
      <PageShell>
        <PageShell.Content>
          <OwnerDashboard />
        </PageShell.Content>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageShell.Content>
        <MemberDashboard />
      </PageShell.Content>
    </PageShell>
  );
}
