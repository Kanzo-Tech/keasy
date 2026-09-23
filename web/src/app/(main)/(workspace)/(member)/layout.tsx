import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";

export default async function WorkspaceMemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = workspaceRole(await getSession());
  if (role === null) redirect("/api/auth/signin");
  if (role !== "member") redirect("/");
  return <>{children}</>;
}
