import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface PageHeaderProps {
  title: string;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
}

export function PageHeader({
  title,
  action,
  badge,
  subtitle,
  backHref,
  backLabel,
}: PageHeaderProps) {
  return (
    <div className="mb-6">
      {backHref && (
        <Link
          href={backHref}
          className="text-sm text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1"
        >
          <ArrowLeft size={14} />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold leading-none">{title}</h2>
        {badge}
        {(subtitle || action) && <div className="flex-1" />}
        {action && <div>{action}</div>}
      </div>
      {subtitle && (
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      )}
    </div>
  );
}
