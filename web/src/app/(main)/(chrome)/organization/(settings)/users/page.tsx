"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Copy, Link2, Plus, Trash2, UserCircle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { EmptyState } from "@/components/shared/empty-state";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { useOrgUsers } from "@/hooks/use-org-users";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { MEMBER_ROLES } from "@/lib/constants/enums";
import type { OrgUser, OrgInvite } from "@/lib/types";

/* ---------- Schema ---------- */

const inviteSchema = z.object({
  role: z.enum(MEMBER_ROLES as [string, ...string[]]),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

/* ---------- Column definitions ---------- */

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
          onValueChange={(val) => onRoleChange(row.original.user_id, val)}
        >
          <SelectTrigger
            className="w-[100px] h-8"
            onClick={(e) => e.stopPropagation()}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMBER_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    actionsColumn<OrgUser>((user) => {
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

/* ---------- Page ---------- */

export default function OrgUsersPage() {
  const queryClient = useQueryClient();
  const { users, isLoading, handleRoleChange, handleRemoveUser } = useOrgUsers();
  const { data: invites } = useQuery<OrgInvite[]>({
    queryKey: queryKeys.org.invites,
    queryFn: api.org.invites,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: "user" },
  });

  const createInvite = useMutation({
    mutationFn: (values: InviteFormValues) => api.org.createInvite(values.role),
    onSuccess: async (data) => {
      const inviteUrl =
        data.invite_url ??
        `${window.location.origin}/invite?token=${data.token}`;
      setCreatedInviteUrl(inviteUrl);
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.invites });
      toast.success("Invite link created");
    },
    onError: () => {
      toast.error("Failed to create invite");
    },
  });

  const columns = useMemo(
    () => orgUserColumns(handleRoleChange, handleRemoveUser),
    [handleRoleChange, handleRemoveUser],
  );

  function handleOpenDialog() {
    form.reset({ role: "user" });
    setCreatedInviteUrl(null);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    form.reset({ role: "user" });
    setCreatedInviteUrl(null);
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

  function handleCopyLink(token: string) {
    const url = `${window.location.origin}/invite?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      toast.success("Link copied to clipboard");
    }).catch(() => toast.error("Failed to copy link"));
  }

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Users"
        description="Manage users in your organization."
      >
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
                {invite.status === "active" && (
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
            <form
              id="invite-form"
              onSubmit={form.handleSubmit((values) => createInvite.mutate(values))}
              className="space-y-3"
            >
              <Field>
                <FieldLabel>Role</FieldLabel>
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={field.value}
                      onValueChange={(v) => { if (v) field.onChange(v); }}
                      className="w-full"
                    >
                      <ToggleGroupItem value="user" className="flex-1">
                        User
                      </ToggleGroupItem>
                      <ToggleGroupItem value="admin" className="flex-1">
                        Admin
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              </Field>
            </form>
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
                  type="submit"
                  form="invite-form"
                  disabled={createInvite.isPending}
                >
                  {createInvite.isPending ? "Creating..." : "Create Invite"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
