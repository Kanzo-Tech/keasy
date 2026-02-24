interface SettingsSectionProps {
  title: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function SettingsSection({
  title,
  description,
  children,
  action,
}: SettingsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage({ children }: { children: React.ReactNode }) {
  return <div className="space-y-8 max-w-2xl">{children}</div>;
}
