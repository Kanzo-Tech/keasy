"use client";

import { MoreHorizontal } from "lucide-react";
import { Button, Menu, MenuContent, MenuTrigger } from "@kanzo-tech/ui";
import type { ColumnDef } from "@kanzo-tech/ui/table";

/**
 * The trailing "…" column every keasy table ends in. The design system ships the table
 * parts and the menu, not a column factory over the two — the showcase writes this inline
 * per table — so the four call sites share one here rather than four copies.
 *
 * The trigger stops propagation so opening the menu is not also a row activation.
 */
export function actionsColumn<T>(
  renderItems: (row: T) => React.ReactNode,
): ColumnDef<T> {
  return {
    id: "actions",
    enableSorting: false,
    enableHiding: false,
    size: 48,
    cell: ({ row }) => (
      <div className="text-end">
        <Menu>
          <MenuTrigger asChild>
            <Button
              aria-label="Open row actions"
              onClick={(event) => event.stopPropagation()}
              size="icon-sm"
              variant="ghost"
            >
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent>{renderItems(row.original)}</MenuContent>
        </Menu>
      </div>
    ),
  };
}
