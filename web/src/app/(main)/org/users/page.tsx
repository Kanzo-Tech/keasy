"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus, UserCircle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DataTable,
  ActionItem,
  selectColumn,
  sortableHeader,
  actionsColumn,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { useOrgUsers } from "@/hooks/use-org-users";
import type { OrgUser } from "@/lib/types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  inactive: "secondary",
};

function orgUserColumns(
  onRoleChange: (userId: string, role: string) => void,
  onRemove: (userId: string, name: string) => void,
): ColumnDef<OrgUser>[] {
  return [
    selectColumn<OrgUser>(),
    {
      id: "name",
      header: sortableHeader("Name"),
      accessorFn: (row) =>
        [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
      cell: ({ getValue }) => (
        <div className="flex items-center gap-2 font-medium">
          <UserCircle className="h-4 w-4 text-muted-foreground" />
          {getValue<string>()}
        </div>
      ),
    },
    {
      accessorKey: "email",
      header: sortableHeader("Email"),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => (
        <Select
          value={row.original.role}
          onValueChange={(val) => onRoleChange(row.original.id, val)}
        >
          <SelectTrigger
            className="w-[100px] h-8"
            onClick={(e) => e.stopPropagation()}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue<string>();
        return (
          <Badge variant={STATUS_VARIANT[status] ?? "outline"}>
            {status}
          </Badge>
        );
      },
    },
    actionsColumn<OrgUser>((user) => {
      const displayName =
        [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
      return (
        <ActionItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(user.id, displayName);
          }}
        >
          Remove
        </ActionItem>
      );
    }),
  ];
}

export default function OrgUsersPage() {
  const { users, isLoading, handleRoleChange, handleRemoveUser } = useOrgUsers();

  const columns = useMemo(
    () => orgUserColumns(handleRoleChange, handleRemoveUser),
    [handleRoleChange, handleRemoveUser],
  );

  return (
    <div className="flex-1 overflow-auto p-4">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage users in your organization.
          </p>
        </div>
        <Button asChild>
          <Link href="/org/users/new">
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Link>
        </Button>
      </div>

      {!isLoading && !users.length ? (
        <EmptyState
          icon={UserCircle}
          title="No users yet"
          description={
            <>
              <Link href="/org/users/new" className="underline underline-offset-4 hover:text-foreground">
                Add a user
              </Link>{" "}
              to collaborate on data assets.
            </>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={users}
          searchKey="email"
          searchPlaceholder="Search users..."
        />
      )}
    </div>
    </div>
  );
}
