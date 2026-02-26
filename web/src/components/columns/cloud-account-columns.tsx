"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getProviderIcon } from "@/lib/provider-icons"
import type { CloudAccountSummary, ProviderSchema } from "@/lib/types"

interface CloudAccountColumnsOptions {
  onDelete: (id: string, name: string) => void
  schema: ProviderSchema[]
}

export function getCloudAccountColumns(options: CloudAccountColumnsOptions): ColumnDef<CloudAccountSummary>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 gap-1"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Name
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      ),
      cell: ({ getValue }) => (
        <span className="font-medium">{getValue<string>()}</span>
      ),
    },
    {
      id: "provider",
      header: "Provider",
      cell: ({ row }) => {
        const account = row.original
        const provider = options.schema.find((s) => s.id === account.provider_id)
        const Icon = provider ? getProviderIcon(provider.icon) : null
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            <span>{provider?.label ?? account.provider_id}</span>
          </div>
        )
      },
    },
    {
      id: "auth_method",
      header: "Auth method",
      cell: ({ row }) => {
        const account = row.original
        const provider = options.schema.find((s) => s.id === account.provider_id)
        const authLabel = provider?.auth_methods.find(
          (a) => a.name === account.auth_method
        )?.label
        return (
          <span className="text-muted-foreground">{authLabel ?? "\u2014"}</span>
        )
      },
    },
    {
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const account = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  options.onDelete(account.id, account.name)
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}
