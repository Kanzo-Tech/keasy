import { getEffectiveRole } from "@/lib/auth-check";
import { redirect } from "next/navigation";
import { PromotorDashboard } from "./promotor-dashboard";
import { ParticipantDashboard } from "./participant-dashboard";

export default async function HomePage() {
  const role = await getEffectiveRole();

  if (!role) {
    redirect("/login");
  }

  if (role === "promotor") {
    return <PromotorDashboard />;
  }

  return <ParticipantDashboard />;
}
