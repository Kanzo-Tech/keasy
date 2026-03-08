import { cn } from "@/lib/utils";

function PageShellRoot({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col flex-1 min-h-0", className)}>
      {children}
    </div>
  );
}

function Content({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex-1 overflow-auto p-4", className)}>
      {children}
    </div>
  );
}

function Footer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("shrink-0 border-t bg-background px-4 py-3", className)}>
      <div className="flex items-center justify-between">
        {children}
      </div>
    </div>
  );
}

export const PageShell = Object.assign(PageShellRoot, { Content, Footer });
