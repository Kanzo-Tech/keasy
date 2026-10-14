"use client";

import type { ReactNode } from "react";
import { type QueryKey, useSuspenseQuery, type UseSuspenseQueryOptions } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Button,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  Skeleton,
} from "@kanzo-tech/ui";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  DataTableSearch,
  DataTableToolbar,
  DataTableViewOptions,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { PAGE_TABLE } from "@/lib/ui/table-heights";

export interface ResourceListProps<T, D, E, K extends QueryKey> {
  /** The rows' query (`$api.queryOptions`, with a `select` to narrow them), read under the list's own boundary. */
  query: UseSuspenseQueryOptions<D, E, T[], K>;
  columns: ColumnDef<T>[];
  /** What the list says when it has no rows. */
  empty: { icon: ReactNode; title: string; description: ReactNode };
  /** The create action, offered when set: its words and where it goes. */
  create?: { label: string; href: string };
  /** Where a row opens. */
  href: (row: T) => string;
  /** What the rows are, plural, for the search box over their `name`. */
  noun: string;
  /** Filters beside the search. */
  filters?: ReactNode;
}

/**
 * A page that lists one kind of resource: loading and failure in its boundary, the empty state, or the
 * table with its toolbar — search, the filters, the columns' options, *Create* — and pagination; a row
 * opens its own page. Each page keeps its query and its columns. A list that needs a bulk action or
 * server pagination composes the table's parts itself and leaves this.
 */
export function ResourceList<T, D, E, K extends QueryKey>(props: ResourceListProps<T, D, E, K>) {
  return (
    <Boundary
      fallback={
        <Loading>
          <Skeleton className="h-40 w-full" />
        </Loading>
      }
    >
      <Rows {...props} />
    </Boundary>
  );
}

function Rows<T, D, E, K extends QueryKey>({ query, columns, empty, create, href, noun, filters }: ResourceListProps<T, D, E, K>) {
  const router = useRouter();
  const rows = settled(useSuspenseQuery(query));
  // TanStack's page reset is queued as a microtask from inside render, so a reset that lands before
  // this component first commits is a state update React refuses (a facet filter's row model is what
  // reaches it), and every poll that changes a row sent the reader back to page one. The page resets
  // where it should: when the reader filters.
  const table = useDataTable({
    columns,
    data: rows,
    autoResetPageIndex: false,
    onColumnFiltersChange: () => table.setPageIndex(0),
  });

  if (rows.length === 0) {
    return (
      <EmptyRoot>
        <EmptyHeader>
          <EmptyIndicator variant="icon">{empty.icon}</EmptyIndicator>
          <EmptyTitle asChild>
            <h2>{empty.title}</h2>
          </EmptyTitle>
          <EmptyDescription>{empty.description}</EmptyDescription>
        </EmptyHeader>
        {create && (
          <EmptyContent>
            <Button asChild size="sm" variant="outline">
              <Link href={create.href}>{create.label}</Link>
            </Button>
          </EmptyContent>
        )}
      </EmptyRoot>
    );
  }
  return (
    <DataTableRoot className={PAGE_TABLE.root} table={table}>
      <DataTableToolbar>
        <DataTableSearch column="name" placeholder={`Search ${noun}...`} />
        {filters}
        <div className="ms-auto flex items-center gap-2">
          <DataTableViewOptions />
          {create && (
            <Button asChild size="sm">
              <Link href={create.href}>
                <Plus />
                {create.label}
              </Link>
            </Button>
          )}
        </div>
      </DataTableToolbar>
      <DataTableContent<T>
        className={PAGE_TABLE.content}
        empty={`No ${noun} match this filter.`}
        maxHeight={PAGE_TABLE.maxHeight}
        onRowClick={(row) => router.push(href(row))}
        stickyHeader
      />
      <DataTablePagination />
    </DataTableRoot>
  );
}
