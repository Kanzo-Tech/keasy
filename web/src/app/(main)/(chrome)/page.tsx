import { getEffectiveRole } from "@/lib/auth-check";
import { PageShell } from "@/components/layout/page-shell";
import { PromotorDashboard } from "./(promotor)/promotor-dashboard";
import { ParticipantDashboard } from "./(participant)/participant-dashboard";

export default async function HomePage() {
  const role = await getEffectiveRole();

  if (role === "promotor") {
    return (
      <PageShell>
        <PageShell.Content>
          <PromotorDashboard />
        </PageShell.Content>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageShell.Content>
        <ParticipantDashboard />
      </PageShell.Content>
    </PageShell>
  );
}
