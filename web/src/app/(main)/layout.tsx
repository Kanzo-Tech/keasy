import { forbidden, redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";
import { PreferencesProvider } from "@/components/providers/preferences-provider";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getEffectiveRole();
  if (!role) redirect("/v1/auth/oidc-start");
  if (role === "none") forbidden();

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
