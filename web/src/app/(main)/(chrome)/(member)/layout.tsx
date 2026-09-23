import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";

// Member data plane (connections, jobs). Disjoint from the owner's metadata
// plane — the owner has no data surface and is sent back to their home.
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = workspaceRole(await getSession());
  if (role === null) redirect("/api/auth/signin");
  if (role !== "member") redirect("/");
  return <>{children}</>;
}
