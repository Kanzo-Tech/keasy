import { cn } from "@/lib/utils";

export function SidebarContentLayout({
  nav,
  children,
  asideClassName,
}: {
  nav: React.ReactNode;
  children: React.ReactNode;
  asideClassName?: string;
}) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className={cn("w-1/5 min-w-50 max-w-62.5 shrink-0 overflow-auto", asideClassName)}>{nav}</aside>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {children}
      </div>
    </div>
  );
}
