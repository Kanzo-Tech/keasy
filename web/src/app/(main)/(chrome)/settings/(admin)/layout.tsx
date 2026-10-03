import { requireRole } from "@/lib/auth/server";

// The workspace's storage and its members are an admin's.
export default async function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin", "/settings/preferences");
  return children;
}
