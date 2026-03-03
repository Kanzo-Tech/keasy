import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface SectionAction {
  label: string;
  icon?: React.ReactNode;
  variant?: "outline" | "ghost" | "default";
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  tooltip?: string;
}

interface SettingsSectionProps {
  title: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  /** Structured action buttons rendered in the header. */
  action?: SectionAction | SectionAction[];
  /** Free-form ReactNode rendered in the action slot (takes precedence over `action`). */
  actionSlot?: React.ReactNode;
}

export function SettingsSection({
  title,
  description,
  children,
  action,
  actionSlot,
}: SettingsSectionProps) {
  const slot = actionSlot ?? (action && (
    <div className="flex items-center gap-2">
      {(Array.isArray(action) ? action : [action]).map((a) => (
        <SectionActionButton key={a.label} action={a} />
      ))}
    </div>
  ));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        {slot && <div className="shrink-0">{slot}</div>}
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

  const variant = action.variant ?? "outline";

  const button = action.href ? (
    <Button variant={variant} size="sm" disabled={action.disabled} asChild>
      <Link href={action.href}>{content}</Link>
    </Button>
  ) : (
    <Button
      variant={variant}
      size="sm"
      onClick={action.onClick}
      disabled={action.disabled || action.loading}
    >
      {content}
    </Button>
  );

  if (!action.tooltip) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span wrapper so tooltip works on disabled buttons */}
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent>{action.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function SettingsPage({ children }: { children: React.ReactNode }) {
  return <div className="space-y-8">{children}</div>;
}
