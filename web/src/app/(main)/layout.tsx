import { forbidden, redirect } from "next/navigation";
import {
  Separator,
  ShellHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@kanzo-tech/ui";
import { getSession } from "@/lib/auth";
import { workspaceRole } from "@/lib/roles";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { DynamicBreadcrumbs } from "@/components/layout/dynamic-breadcrumbs";
import { RedirectToast } from "@/components/shared/redirect-toast";

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

  // One frame for every page, the full-screen workspace included: the header, and the
  // trigger that collapses the rail, are never a page's to leave out.
  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
        <ShellHeader className="min-w-0 flex-row items-center gap-2 bg-background p-4">
          <SidebarTrigger className="-ms-1" />
          <Separator orientation="vertical" className="h-4" />
          <DynamicBreadcrumbs />
        </ShellHeader>
        <RedirectToast />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
