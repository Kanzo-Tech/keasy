import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SectionAction {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

interface SettingsSectionProps {
  title: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  action?: SectionAction;
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
        {action && (
          <div className="shrink-0">
            <SectionActionButton action={action} />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function SectionActionButton({ action }: { action: SectionAction }) {
  const content = action.loading ? (
    <>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {action.loadingLabel ?? action.label}
    </>
  ) : (
    <>
      {action.icon}
      {action.label}
    </>
  );

  if (action.href) {
    return (
      <Button variant="outline" size="sm" disabled={action.disabled} asChild>
        <Link href={action.href}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={action.onClick}
      disabled={action.disabled || action.loading}
    >
      {content}
    </Button>
  );
}

export function SettingsPage({ children }: { children: React.ReactNode }) {
  return <div className="space-y-8">{children}</div>;
}
