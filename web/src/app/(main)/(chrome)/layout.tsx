import { DynamicBreadcrumbs } from "@/components/layout/dynamic-breadcrumbs";
import { RedirectToast } from "@/components/shared/redirect-toast";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default function ChromeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bg-background sticky top-0 flex shrink-0 items-center gap-2 border-b p-4 z-10">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        <DynamicBreadcrumbs />
      </header>
      <RedirectToast />
      <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
    </>
  );
}
