import { SectionBody, SectionRoot } from "@kanzo-tech/ui";
import { getSession } from "@/lib/auth/server";
import { workspaceRole } from "@/lib/auth/roles";
import { MemberDashboard, OwnerDashboard } from "./dashboards";

export default async function HomePage() {
  const role = workspaceRole(await getSession());

  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        {role === "owner" ? <OwnerDashboard /> : <MemberDashboard />}
      </SectionBody>
    </SectionRoot>
  );
}
