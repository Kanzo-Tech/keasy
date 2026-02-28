"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { generateBreadcrumbs } from "@/lib/route-config";
import { type LucideIcon } from "lucide-react";

export function DynamicBreadcrumbs() {
  const pathname = usePathname();
  const breadcrumbs = generateBreadcrumbs(pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={crumb.path}>
            <BreadcrumbItem>
              {index === breadcrumbs.length - 1 ? (
                <BreadcrumbPage className="max-w-[200px] truncate">
                  {crumb.name}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={crumb.path} className="max-w-[150px] truncate">
                  {crumb.name}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}