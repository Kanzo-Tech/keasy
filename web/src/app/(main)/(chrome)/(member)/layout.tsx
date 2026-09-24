import { getSession } from "@/lib/auth";
import { requireRole } from "@/lib/roles";

// The member data plane (connections, jobs); the owner has none and goes home.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  requireRole(await getSession(), "member", "/");
  return children;
}
