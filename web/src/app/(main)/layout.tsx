import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { parseSidebarCookie, SIDEBAR_COOKIE_NAME, SidebarProvider } from "@kanzo-tech/ui";
import { AuthError, can } from "@kanzo-tech/auth";
import { auth } from "@/lib/auth/server";
import { PROBLEM_PAGE } from "@/lib/routes";
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
  if (!can(await readSession(), "reader")) forbidden();

  // The person's own choice, read back on the server so a reload starts where they left it.
  const defaultOpen = parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden" defaultOpen={defaultOpen}>
      <Shell>{children}</Shell>
    </SidebarProvider>
  );
}

/**
 * The session, or the auth error page when the store or the IdP behind it does not answer. A server error
 * reaches the browser stripped of everything but a digest, so the code travels in the URL instead.
 */
async function readSession() {
  try {
    return await auth.session({ required: true });
  } catch (err) {
    // The store, or the IdP, did not answer: a coded failure, which the problem page renders.
    if (err instanceof AuthError) redirect(`${PROBLEM_PAGE}?code=${encodeURIComponent(err.code)}`);
    throw err;
  }
}
