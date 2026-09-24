import { getSession } from "@/lib/auth";
import { requireRole } from "@/lib/roles";

// Cloud accounts and AI are the data plane's own infrastructure; an owner has none.
export default async function MemberSettingsLayout({ children }: { children: React.ReactNode }) {
  requireRole(await getSession(), "member", "/settings/preferences");
  return children;
}
