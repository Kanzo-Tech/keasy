export function Section({
  label,
  children,
  className,
  action,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}
