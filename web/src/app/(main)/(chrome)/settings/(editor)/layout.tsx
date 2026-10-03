import { requireRole } from "@/lib/auth/server";

// Cloud accounts and AI keys are an editor's; a reader keeps their preferences.
export default async function EditorSettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole("editor", "/settings/preferences");
  return children;
}
