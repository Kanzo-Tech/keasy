import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
  return (
    <Link href={href} className="group block h-full">
      <Card className="px-5 py-4 gap-0 rounded-lg shadow-none transition-colors group-hover:border-primary/40 h-full grid grid-rows-[auto_1fr_auto]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "rounded-full p-1.5 shrink-0",
              ok === true && "bg-green-500/10",
              ok === false && "bg-amber-500/10",
              ok === undefined && "bg-muted",
            )}
          >
            <Icon
              size={14}
              className={cn(
                ok === true && "text-green-500",
                ok === false && "text-amber-500",
                ok === undefined && "text-muted-foreground",
              )}
            />
          </div>
          <span className="text-sm font-medium text-muted-foreground min-w-0 truncate">
            {title}
          </span>
        </div>
        <div className="flex items-end pt-3">
          <Skeleton loading={value === undefined}>
            <p className="text-2xl font-semibold tracking-tight">{value ?? "—"}</p>
          </Skeleton>
        </div>
        <p className="text-sm text-muted-foreground pt-1">{description}</p>
      </Card>
    </Link>
  );
}
