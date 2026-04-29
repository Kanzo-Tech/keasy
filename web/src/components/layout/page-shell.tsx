import { cn } from "@/lib/utils";

// Convention: `page.tsx` owns the <PageShell> root; the inner component
// emits Header + Content + (optional) Footer as siblings. Keep this
// invariant — mixing root ownership produces inconsistent padding.

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

function Header({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-4 px-4 pt-4 pb-3">
      <div className="min-w-0">
        <h1 className="text-base font-semibold truncate">{title}</h1>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
        )}
      </div>
      {actions}
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
    <div className={cn("flex-1 flex flex-col gap-4 overflow-auto px-4 pb-4", className)}>
      {children}
    </div>
  );
}

// Footer is the canonical home for primary actions (Cancel / Test / Save).
// Sticky at the bottom of the shell, separated by a top border.
function Footer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("shrink-0 border-t bg-background px-4 py-3", className)}>
      <div className="flex items-center justify-between gap-2">
        {children}
      </div>
    </div>
  );
}

export const PageShell = Object.assign(PageShellRoot, { Header, Content, Footer });
