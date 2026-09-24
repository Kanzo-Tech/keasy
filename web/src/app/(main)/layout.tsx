import { forbidden, redirect } from "next/navigation";
import { SidebarProvider } from "@kanzo-tech/ui";
import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";
import { Shell } from "./shell";

/**
 * Nothing under here is the same for two people: every page is behind a session
 * cookie and draws what that person's role allows. Saying so is what keeps the
 * build from trying to prerender a signed-in shell — and from needing the
 * client secret to do it.
 */
export const dynamic = "force-dynamic";

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin");
  if (!workspaceRole(session)) forbidden();

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <Shell>{children}</Shell>
    </SidebarProvider>
  );
}
