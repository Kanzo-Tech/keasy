import { requireRole } from "@/lib/auth/server";

// The member data plane (connections, jobs); the owner has none and goes home.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  await requireRole("member", "/");
  return children;
}
