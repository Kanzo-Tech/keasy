import { requireRole } from "@/lib/auth/server";

// Creating a job or a connection needs an editor; a reader goes home.
export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  await requireRole("editor", "/");
  return children;
}
