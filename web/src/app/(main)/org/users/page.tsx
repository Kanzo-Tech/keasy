"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/empty-state";
import { getOrgUserColumns } from "@/components/columns/org-user-columns";
import { useOrgUsers } from "@/hooks/use-org-users";

export default function OrgUsersPage() {
  const { users, isLoading, handleRoleChange, handleRemoveUser } = useOrgUsers();

  const columns = useMemo(
    () =>
      getOrgUserColumns({
        onRoleChange: handleRoleChange,
        onRemove: handleRemoveUser,
      }),
    [handleRoleChange, handleRemoveUser]
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
          description="Add users to your organization to collaborate on data assets."
          actionHref="/org/users/new"
          actionLabel="Add User"
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
