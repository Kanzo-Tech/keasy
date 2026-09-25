import { requireRole } from "@/lib/auth/server";

// The owner plane (catalog, datasets); a member goes home.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "/");
  return children;
}
