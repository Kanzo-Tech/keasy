import { getEffectiveRole } from "@/lib/auth-check";
import { redirect } from "next/navigation";
import { PromotorDashboard } from "./(promotor)/promotor-dashboard";
import { ParticipantDashboard } from "./(participant)/participant-dashboard";

export default async function HomePage() {
  const role = await getEffectiveRole();

  if (!role) {
    redirect("/v1/auth/oidc-start");
  }

  if (role === "promotor") {
    return (
      <div className="flex-1 overflow-auto p-4">
        <PromotorDashboard />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <ParticipantDashboard />
    </div>
  );
}
