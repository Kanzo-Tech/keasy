"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Trash2, UserCircle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { useOrgUsers } from "@/hooks/use-org-users";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { OrgUser, OrgInvite } from "@/lib/types";

function memberColumns(
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
      cell: ({ row }) => {
        const role = row.original.role;
        return (
          <Badge variant={role === "owner" ? "default" : "secondary"}>
            {role === "owner" ? "Owner" : "Member"}
          </Badge>
        );
      },
    },
    actionsColumn<OrgUser>((user) => {
      // The owner cannot be removed (bootstrapped from config).
      if (user.role === "owner") return null;
      const displayName =
        [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
      return (
        <ActionItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(user.user_id, displayName);
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
): "default" | "destructive" => {
  if (status === "active") return "default";
  return "destructive";
};

export default function MembersPage() {
  const queryClient = useQueryClient();
  const { users, isLoading, handleRemoveUser } = useOrgUsers();
  const { data: invites } = useQuery<OrgInvite[]>({
    queryKey: queryKeys.org.invites,
    queryFn: api.org.invites,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const columns = useMemo(
    () => memberColumns(handleRemoveUser),
    [handleRemoveUser],
  );

  async function handleCreateInvite() {
    setIsCreating(true);
    try {
      const data = await api.org.createInvite();
      const inviteUrl =
        data.invite_url ??
        `${window.location.origin}/invite?token=${data.token}`;
      setCreatedInviteUrl(inviteUrl);
      setDialogOpen(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.invites });
      toast.success("Invite link created");
    } catch {
      toast.error("Failed to create invite");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevokeInvite(token: string) {
    try {
      await api.org.revokeInvite(token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.invites });
      toast.success("Invite revoked");
    } catch {
      toast.error("Failed to revoke invite");
    }
  }

  function copy(url: string) {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied to clipboard"))
      .catch(() => toast.error("Failed to copy link"));
  }

  const inviteButton = (
    <Button size="sm" onClick={handleCreateInvite} disabled={isCreating}>
      <Link2 size={14} className="mr-1.5" />
      {isCreating ? "Creating..." : "Create invite link"}
    </Button>
  );

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Members"
        description="People with access to this workspace. Share an invite link to add more — anyone who joins becomes a member."
      >
      {!isLoading && !users.length ? (
        <EmptyState
          icon={UserCircle}
          title="No members yet"
          description="Share an invite link to add people to your workspace."
        />
      ) : (
        <DataTable
          columns={columns}
          data={users}
          searchKey="email"
          searchPlaceholder="Search members..."
          toolbarActions={inviteButton}
        />
      )}

      {/* Active invite links */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Invite links</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Reusable links valid for 7 days. Anyone with a link joins as a member.
            </p>
          </div>
          {!users.length && inviteButton}
        </div>

        {invites && invites.length > 0 ? (
          <div className="rounded-md border divide-y">
            {invites.map((invite) => (
              <div
                key={invite.token}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">Invite link</p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(invite.created_at).toLocaleDateString()}
                    {" · "}
                    Expires {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={inviteStatusVariant(invite.status)}>
                  {invite.status}
                </Badge>
                {invite.status === "active" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        copy(
                          `${window.location.origin}/invite?token=${invite.token}`,
                        )
                      }
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
            No invite links yet. Use the button above to create one.
          </p>
        )}
      </section>

      {/* Created-link dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite link created</DialogTitle>
            <DialogDescription>
              Share this link to add people to your workspace. They join as a
              member. The link is reusable for 7 days.
            </DialogDescription>
          </DialogHeader>

          {createdInviteUrl && (
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
                onClick={() => copy(createdInviteUrl)}
              >
                <Copy size={14} />
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
