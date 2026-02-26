"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Building2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { OrgEntry } from "@/lib/types"

const ROLE_LABEL: Record<string, string> = {
  promotor: "Promotor",
  participant: "Participant",
}

export const organizationColumns: ColumnDef<OrgEntry>[] = [
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
      <div className="flex items-center gap-2 font-medium">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        {getValue<string>()}
      </div>
    ),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ getValue }) => {
      const role = getValue<string>()
      return (
        <Badge variant="outline">{ROLE_LABEL[role] ?? role}</Badge>
      )
    },
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8 gap-1"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Created
        <ArrowUpDown className="h-4 w-4" />
      </Button>
    ),
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">
        {new Date(getValue<string>()).toLocaleDateString()}
      </span>
    ),
  },
]
