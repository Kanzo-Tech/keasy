import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

export default async function WorkspaceParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();
  if (role === "promotor") redirect("/?redirected=1");
  if (!role) redirect("/v1/auth/oidc-start");
  return <>{children}</>;
}
