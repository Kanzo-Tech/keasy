import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, Skeleton } from "@kanzo-tech/ui";

interface SummaryCardProps {
  href: string;
  icon: LucideIcon;
  title: string;
  value: React.ReactNode;
  description: string;
  ok?: boolean;
}

export function SummaryCard({
  href,
  icon: Icon,
  title,
  value,
  description,
  ok,
}: SummaryCardProps) {
  // One attribute, and both the wash and the ink read off it. The tones used to be literal
  // palette steps, green and amber, so the two dashboards' tiles were the one place in the
  // app that stayed the same colour whatever theme the reader had chosen.
  const status = ok === undefined ? "neutral" : ok ? "ok" : "warn";

  return (
    <Link href={href} className="group block h-full">
      <Card className="px-5 py-4 gap-0 rounded-lg shadow-none transition-colors group-hover:border-primary/40 h-full grid grid-rows-[auto_1fr_auto]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            data-status={status}
            className="rounded-full p-1.5 shrink-0 bg-muted [&_svg]:text-muted-foreground data-[status=ok]:bg-success/10 data-[status=ok]:[&_svg]:text-success data-[status=warn]:bg-warning/10 data-[status=warn]:[&_svg]:text-warning"
          >
            <Icon size={14} />
          </div>
          <span className="text-sm font-medium text-muted-foreground min-w-0 truncate">
            {title}
          </span>
        </div>
        <div className="flex items-end pt-3">
          {value === undefined ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
          )}
        </div>
        <p className="text-sm text-muted-foreground pt-1">{description}</p>
      </Card>
    </Link>
  );
}
