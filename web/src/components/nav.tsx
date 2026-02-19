"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Workflow, Cable, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const topLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/connections", label: "Connections", icon: Cable },
  { href: "/jobs", label: "Jobs", icon: Workflow },
];

const bottomLinks = [
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLink({
  href,
  label,
  icon: Icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  pathname: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
        (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"))
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground"
      )}
    >
      <Icon size={16} />
      {label}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-card p-4 flex flex-col">
      <div className="flex items-center gap-2.5 mb-4 px-2">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-primary-foreground">K</span>
        </div>
        <span className="text-lg font-semibold">Keasy</span>
      </div>
      <div className="flex flex-col gap-1">
        {topLinks.map((link) => (
          <NavLink key={link.href} {...link} pathname={pathname} />
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-1">
        {bottomLinks.map((link) => (
          <NavLink key={link.href} {...link} pathname={pathname} />
        ))}
      </div>
      <div className="border-t border-border pt-3 mt-3 px-2">
        <a
          href="https://kanzo.tech"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Made by Kanzo.tech
        </a>
      </div>
    </aside>
  );
}
