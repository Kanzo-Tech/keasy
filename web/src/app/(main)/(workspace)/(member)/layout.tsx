import { getSession } from "@/lib/auth";
import { requireRole } from "@/lib/roles";

export default async function WorkspaceMemberLayout({ children }: { children: React.ReactNode }) {
  requireRole(await getSession(), "member", "/");
  return children;
}
