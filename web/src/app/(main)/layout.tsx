import { forbidden, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";
import { PreferencesProvider } from "@/components/providers/preferences-provider";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

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
    <PreferencesProvider>
      <SidebarProvider>
        <div className="flex h-dvh w-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="flex-1 flex flex-col overflow-hidden w-full">
            {children}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </PreferencesProvider>
  );
}
