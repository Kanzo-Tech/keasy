"use client";

import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  cn,
} from "@kanzo-tech/ui";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { useSearchParams } from "next/navigation";

import { $api } from "@/lib/api/client";
import { type Crumb, generateBreadcrumbs } from "@/app/(main)/_parts/route-config";

/** A crumb's name: its label resolved (a job's own name), else the route's. */
function useCrumbName(crumb: Crumb): string {
  const jobId = crumb.label?.kind === "job" ? crumb.label.id : "";
  // The named exception to "useSuspenseQuery only" (fossil docs/design/failure, G2.4): the header
  // must not suspend or fail on a label. The route's name stands until the job's arrives, and the
  // page below the header reads the same job and shows its failure.
  const { data: job } = $api.useQuery(
    "get",
    "/v1/jobs/{id}",
    { params: { path: { id: jobId } } },
    { enabled: !!jobId },
  );
  return (jobId && job?.name) || crumb.name;
}

function CrumbLink({ crumb }: { crumb: Crumb }) {
  const name = useCrumbName(crumb);
  return (
    <BreadcrumbLink asChild className="max-w-38 truncate">
      <Link href={crumb.path} title={name}>
        {name}
      </Link>
    </BreadcrumbLink>
  );
}

function CrumbPage({ crumb }: { crumb: Crumb }) {
  const name = useCrumbName(crumb);
  return (
    <BreadcrumbPage className="truncate" title={name}>
      {name}
    </BreadcrumbPage>
  );
}

function CrumbMenuItem({ crumb }: { crumb: Crumb }) {
  const router = useRouter();
  const name = useCrumbName(crumb);
  return (
    <MenuItem onSelect={() => router.push(crumb.path)} title={name} value={crumb.path}>
      <span className="max-w-64 truncate">{name}</span>
    </MenuItem>
  );
}

/** Shown only where the trail is too narrow for its middle. */
const NARROW = "@md/trail:hidden";
/** Hidden where the trail is too narrow for it. */
const WIDE = "hidden @md/trail:inline-flex";

/**
 * The header's trail, as the kanzo-ui workspace showcase lays it out in a
 * fixed-height strip: one row that never wraps, the leaf the one crumb that
 * truncates, and — where the strip is narrow — the middle folded into a menu
 * behind an ellipsis.
 */
export function Trail({ crumbs }: { crumbs: Crumb[] }) {
  const middle = crumbs.slice(1, -1);
  return (
    <Breadcrumb className="@container/trail min-w-0 flex-1">
      <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const inMiddle = index > 0 && !last;
          return (
            <Fragment key={crumb.path}>
              {index === 1 && middle.length > 0 && (
                <>
                  <BreadcrumbItem className={NARROW}>
                    <Menu>
                      <MenuTrigger
                        aria-label="Show the hidden crumbs"
                        className="flex size-6 items-center justify-center rounded-md hover:text-foreground"
                      >
                        <BreadcrumbEllipsis />
                      </MenuTrigger>
                      <MenuContent>
                        {middle.map((c) => (
                          <CrumbMenuItem crumb={c} key={c.path} />
                        ))}
                      </MenuContent>
                    </Menu>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className={NARROW} />
                </>
              )}
              {/* The separator is a sibling of the item, never a child: both
                  render `li`. */}
              <BreadcrumbItem className={cn(last && "min-w-0", inMiddle && WIDE)}>
                {last ? <CrumbPage crumb={crumb} /> : <CrumbLink crumb={crumb} />}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator className={cn(inMiddle && WIDE)} />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** The trail to `pathname` as the query it was opened with names it. Reads the search params, so it
 *  renders under a `Suspense` whose fallback is the trail without them. */
export function SearchTrail({ pathname }: { pathname: string }) {
  return <Trail crumbs={generateBreadcrumbs(pathname, useSearchParams())} />;
}
