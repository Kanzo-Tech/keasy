import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";

// Owner plane (metadata + people): Members, Identity, Catalog. Disjoint from the
// member data plane — members are sent to their own home.
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = workspaceRole(await getSession());
  if (role === null) redirect("/api/auth/signin");
  if (role !== "owner") redirect("/");
  return <>{children}</>;
}
