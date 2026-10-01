import { forbidden, redirect } from "next/navigation";
import { SidebarProvider } from "@kanzo-tech/ui";
import { getSession, SessionStoreDown } from "@/lib/auth/server";
import { workspaceRole } from "@/lib/auth/roles";
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
  const session = await readSession();
  if (!session) redirect("/api/auth/signin");
  if (!workspaceRole(session)) forbidden();

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <Shell>{children}</Shell>
    </SidebarProvider>
  );
}

/**
 * The session, or the auth error page when the store behind it does not answer. A server error
 * reaches the browser stripped of everything but a digest, so the code travels in the URL instead.
 */
async function readSession() {
  try {
    return await getSession();
  } catch (err) {
    if (err instanceof SessionStoreDown) redirect(`/auth/error?code=${err.code}`);
    throw err;
  }
}
