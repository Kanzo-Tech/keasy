import { cookies } from "next/headers";
import { forbidden } from "next/navigation";
import { parseSidebarCookie, SIDEBAR_COOKIE_NAME, SidebarProvider } from "@kanzo-tech/ui";
import { can } from "@kanzo-tech/auth";
import { auth } from "@/lib/auth/server";
import { ModelProvider } from "@/lib/ai";
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
  // An outage of the store or the IdP behind it is sent to the problem page with its code, by `required`.
  if (!can(await auth.session({ required: true }), "reader")) forbidden();

  // The person's own choice, read back on the server so a reload starts where they left it.
  const defaultOpen = parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE_NAME)?.value);

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden" defaultOpen={defaultOpen}>
      {/* Where the model's shards are served, read per request so one image serves any deployment. */}
      <ModelProvider url={process.env.KEASY_MODEL_URL?.trim() || undefined}>
        <Shell>{children}</Shell>
      </ModelProvider>
    </SidebarProvider>
  );
}
