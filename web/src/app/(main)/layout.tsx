import { AppSidebar } from "@/components/layout/app-sidebar";
import { DynamicBreadcrumbs } from "@/components/layout/dynamic-breadcrumbs";
import { RedirectToast } from "@/components/shared/redirect-toast";
import { Separator } from "@/components/ui/separator";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full overflow-hidden">
        <AppSidebar />

        <SidebarInset className="flex-1 flex flex-col overflow-hidden w-full">
          <header className="bg-background sticky top-0 flex shrink-0 items-center gap-2 border-b p-4 z-10">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <DynamicBreadcrumbs />
          </header>

          <RedirectToast />
          <div className="flex-1 overflow-hidden flex flex-col">
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}