import { requireRole } from "@/lib/auth/server";

export default async function WorkspaceMemberLayout({ children }: { children: React.ReactNode }) {
  await requireRole("member", "/");
  return children;
}
