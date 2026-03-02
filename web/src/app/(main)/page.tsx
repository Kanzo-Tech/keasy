import { getEffectiveRole } from "@/lib/auth-check";
import { forbidden, redirect } from "next/navigation";
import { PageContent } from "@/components/layout/page-content";
import { PromotorDashboard } from "./(promotor)/promotor-dashboard";
import { ParticipantDashboard } from "./(participant)/participant-dashboard";

export default async function HomePage() {
  const role = await getEffectiveRole();

  if (!role) {
    redirect("/v1/auth/oidc-start");
  }

  if (role === "none") {
    forbidden();
  }

  if (role === "promotor") {
    return (
      <PageContent>
        <PromotorDashboard />
      </PageContent>
    );
  }

  return (
    <PageContent>
      <ParticipantDashboard />
    </PageContent>
  );
}
