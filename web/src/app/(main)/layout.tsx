import { forbidden, redirect } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@kanzo-tech/ui";
import { getEffectiveRole } from "@/lib/auth-check";
import { AppSidebar } from "@/components/layout/app-sidebar";

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getEffectiveRole();
  if (!role) redirect("/v1/auth/oidc-start");
  if (role === "none") forbidden();

  return (
    // The provider IS the viewport frame — it renders the flex row the rail and the
    // inset sit in, so keasy no longer wraps it in one of its own.
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar />
      <SidebarInset className="overflow-hidden">{children}</SidebarInset>
    </SidebarProvider>
  );
}
