import { requireRole } from "@/lib/auth/server";

// Cloud accounts and AI are the data plane's own infrastructure; an owner has none.
export default async function MemberSettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole("member", "/settings/preferences");
  return children;
}
