import { Separator, ShellHeader, ShellMain, SidebarTrigger } from "@kanzo-tech/ui";
import { DynamicBreadcrumbs } from "@/components/layout/dynamic-breadcrumbs";
import { RedirectToast } from "@/components/shared/redirect-toast";

export default function ChromeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ShellHeader className="flex-row items-center gap-2 bg-background p-4">
        <SidebarTrigger className="-ms-1" />
        <Separator orientation="vertical" className="h-4" />
        <DynamicBreadcrumbs />
      </ShellHeader>
      <RedirectToast />
      {/* The page's single `<main>`; everything nested under it is a `<section>`. */}
      <ShellMain className="overflow-hidden">{children}</ShellMain>
    </>
  );
}
