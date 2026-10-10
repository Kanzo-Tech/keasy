"use client";

import { MenuItem, Tooltip, TooltipContent, TooltipTrigger } from "@kanzo-tech/ui";

/**
 * A control that cannot be used now, said why: a disabled button takes no pointer, so the tooltip
 * sits on a wrapper (as the studio's Create does).
 */
export function Blocked({ reason, children }: { reason?: string; children: React.ReactNode }) {
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" role="presentation" tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A menu item the caller may not use on this object: disabled, and saying why under its label —
 * a menu holds no tooltip, and a reason hidden on hover is one a keyboard never reads.
 */
export function BlockedMenuItem({
  reason,
  children,
  ...props
}: React.ComponentProps<typeof MenuItem> & { reason?: string }) {
  if (!reason) return <MenuItem {...props}>{children}</MenuItem>;
  return (
    <MenuItem {...props} disabled title={reason}>
      <span className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-2">{children}</span>
        <span className="text-muted-foreground text-xs">{reason}</span>
      </span>
    </MenuItem>
  );
}
