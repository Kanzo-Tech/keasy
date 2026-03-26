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
    <div className="flex items-center justify-between mb-(--spacing-section)">
      <div>
        <h1 className="text-sm font-semibold">{title}</h1>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
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
    <div className={cn("flex-1 flex flex-col gap-(--spacing-section) overflow-auto p-(--spacing-content)", className)}>
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
    <div className={cn("shrink-0 border-t bg-background px-(--spacing-content) py-2", className)}>
      <div className="flex items-center justify-between">
        {children}
      </div>
    </div>
  );
}

export const PageShell = Object.assign(PageShellRoot, { Header, Content, Footer });
