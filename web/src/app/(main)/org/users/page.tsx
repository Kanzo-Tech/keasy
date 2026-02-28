"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Copy, Link2, Plus, Trash2, UserCircle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DataTable,
  ActionItem,
  selectColumn,
  sortableHeader,
  actionsColumn,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { useOrgUsers } from "@/hooks/use-org-users";
import {
  createOrgInvite,
  fetchOrgInvites,
  revokeOrgInvite,
} from "@/lib/api";
import type { OrgUser, OrgInvite } from "@/lib/types";

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

const inviteStatusVariant = (
  status: OrgInvite["status"],
): "default" | "secondary" | "destructive" => {
  if (status === "pending") return "default";
  if (status === "used") return "secondary";
  return "destructive";
};

export default function OrgUsersPage() {
  const { users, isLoading, handleRoleChange, handleRemoveUser } = useOrgUsers();
  const {
    data: invites,
    mutate: mutateInvites,
  } = useSWR<OrgInvite[]>("org-invites", fetchOrgInvites);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState("user");
  const [isCreating, setIsCreating] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);

  const columns = useMemo(
    () => orgUserColumns(handleRoleChange, handleRemoveUser),
    [handleRoleChange, handleRemoveUser],
  );

  function handleOpenDialog() {
    setInviteRole("user");
    setCreatedInviteUrl(null);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    setInviteRole("user");
    setCreatedInviteUrl(null);
  }

  async function handleCreateInvite() {
    setIsCreating(true);
    try {
      const data = await createOrgInvite(inviteRole);
      const inviteUrl =
        data.invite_url ??
        `${window.location.origin}/invite?token=${data.token}`;
      setCreatedInviteUrl(inviteUrl);
      await mutateInvites();
      toast.success("Invite link created");
    } catch {
      toast.error("Failed to create invite");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevokeInvite(token: string) {
    try {
      await revokeOrgInvite(token);
      await mutateInvites();
      toast.success("Invite revoked");
    } catch {
      toast.error("Failed to revoke invite");
    }
  }

  function handleCopyLink(token: string) {
    const url = `${window.location.origin}/invite?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      toast.success("Link copied to clipboard");
    });
  }

  return (
    <div className="flex-1 overflow-auto p-4">
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium">Users</h2>
        <p className="text-sm text-muted-foreground">
          Manage users in your organization.
        </p>
      </div>

      {!isLoading && !users.length ? (
        <EmptyState
          icon={UserCircle}
          title="No users yet"
          description="Invite users to collaborate on data assets."
        />
      ) : (
        <DataTable
          columns={columns}
          data={users}
          searchKey="email"
          searchPlaceholder="Search users..."
          toolbarActions={
            <Button size="sm" onClick={handleOpenDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Invite User
            </Button>
          }
        />
      )}

      {/* Pending invitations section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Pending Invitations</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Invite users to join your organization via a link.
            </p>
          </div>
          {!users.length && (
            <Button size="sm" onClick={handleOpenDialog}>
              <Link2 size={14} className="mr-1.5" />
              Invite User
            </Button>
          )}
        </div>

        {invites && invites.length > 0 ? (
          <div className="rounded-md border divide-y">
            {invites.map((invite) => (
              <div
                key={invite.token}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    Invite
                    <span className="text-muted-foreground ml-2 text-xs">
                      ({invite.role})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(invite.created_at).toLocaleDateString()}
                    {" · "}
                    Expires {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={inviteStatusVariant(invite.status)}>
                  {invite.status}
                </Badge>
                {invite.status === "pending" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleCopyLink(invite.token)}
                      title="Copy invite link"
                    >
                      <Copy size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleRevokeInvite(invite.token)}
                      title="Revoke invite"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No invitations yet. Use the button above to invite a user.
          </p>
        )}
      </section>

      {/* Create invite dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Create an invite link for a new user. Share the link with them
              to join your organization.
            </DialogDescription>
          </DialogHeader>

          {createdInviteUrl ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Invite link created successfully. Share this URL with the user:
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={createdInviteUrl}
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(createdInviteUrl).then(() => {
                      toast.success("Link copied to clipboard");
                    });
                  }}
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={inviteRole}
                  onValueChange={(v) => { if (v) setInviteRole(v); }}
                  className="w-full"
                >
                  <ToggleGroupItem value="user" className="flex-1">
                    User
                  </ToggleGroupItem>
                  <ToggleGroupItem value="admin" className="flex-1">
                    Admin
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          )}

          <DialogFooter>
            {createdInviteUrl ? (
              <Button onClick={handleCloseDialog}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateInvite}
                  disabled={isCreating}
                >
                  {isCreating ? "Creating..." : "Create Invite"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
