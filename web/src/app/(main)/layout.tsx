import { forbidden, redirect } from "next/navigation";
import { SidebarProvider } from "@kanzo-tech/ui";
import { AuthError } from "@kanzo-tech/auth";
import { currentOrganization, getSession } from "@/lib/auth/server";
import { holds } from "@/lib/auth/roles";
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
  const session = await readSession();
  if (!session) redirect("/api/auth/signin");
  if (!holds(session, await currentOrganization(), "reader")) forbidden();

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
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
    return await getSession();
  } catch (err) {
    // The store, or the IdP, did not answer: a coded failure, which the problem page renders.
    if (err instanceof AuthError) redirect(`${PROBLEM_PAGE}?code=${encodeURIComponent(err.code)}`);
    throw err;
  }
}
