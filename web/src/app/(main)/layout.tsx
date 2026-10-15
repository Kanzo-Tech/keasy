import { cookies } from "next/headers";
import { forbidden } from "next/navigation";
import { parseSidebarCookie, SIDEBAR_COOKIE_NAME, SidebarProvider } from "@kanzo-tech/ui";
import { AuthProvider, can } from "@kanzo-tech/auth";
import { auth } from "@/lib/auth/server";
import { Shell } from "./shell";

/**
 * Nothing under here is the same for two people: every page is read from the token the edge
 * forwards and draws what that person's role allows. Saying so is what keeps the build from trying
 * to prerender a signed-in shell.
 */
export const dynamic = "force-dynamic";

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A token that does not verify, or keys that cannot be had, is sent to the problem page with its code, by `required`.
  const session = await auth.session({ required: true });
  if (!can(session, "reader")) forbidden();

  // The person's own choice, read back on the server so a reload starts where they left it.
  const defaultOpen = parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);

  return (
    <AuthProvider session={session}>
      <SidebarProvider className="h-dvh min-h-0 overflow-hidden" defaultOpen={defaultOpen}>
        <Shell>{children}</Shell>
      </SidebarProvider>
    </AuthProvider>
  );
}
