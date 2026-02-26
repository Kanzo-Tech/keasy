"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getProviderIcon } from "@/lib/provider-icons"
import type { Connection, CloudAccountSummary, ProviderSchema } from "@/lib/types"

interface ConnectionColumnsOptions {
  onDelete: (id: string, name: string) => void
  accounts: CloudAccountSummary[]
  schema: ProviderSchema[]
}

export function getConnectionColumns(options: ConnectionColumnsOptions): ColumnDef<Connection>[] {
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
      id: "location",
      header: "Location",
      cell: ({ row }) => {
        const connection = row.original
        if (connection.location_type === "cloud" && connection.cloud_account_id) {
          const account = options.accounts.find((a) => a.id === connection.cloud_account_id)
          const provider = account
            ? options.schema.find((s) => s.id === account.provider_id)
            : null
          const Icon = provider ? getProviderIcon(provider.icon) : null
          return (
            <div className="flex items-center gap-2 text-muted-foreground">
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              <span>{account?.name ?? connection.cloud_account_id}</span>
            </div>
          )
        }
        return <Badge variant="outline">Local</Badge>
      },
    },
    {
      accessorKey: "url",
      header: "URL",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground font-mono text-xs">{getValue<string>()}</span>
      ),
    },
    {
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const connection = row.original
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
                  options.onDelete(connection.id, connection.name)
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
