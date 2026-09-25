import { getSession } from "@/lib/auth";
import { requireRole } from "@/lib/roles";

// The owner plane (catalog, datasets); a member goes home.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  requireRole(await getSession(), "owner", "/");
  return children;
}
