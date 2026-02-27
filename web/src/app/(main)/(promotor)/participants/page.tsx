"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Users, Copy, Trash2, Link2 } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OrgEntry } from "@/lib/types";

type InviteEntry = {
  token: string;
  org_id: string | null;
  org_name: string | null;
  status: "pending" | "used" | "expired";
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

const orgFetcher = () =>
  fetch("/api/admin/organizations")
    .then((r) => r.json())
    .then((r) => r.data ?? []);

const inviteFetcher = () =>
  fetch("/api/admin/invites")
    .then((r) => r.json())
    .then((r) => r.data ?? []);

export default function ParticipantsPage() {
  const { data: orgs } = useSWR<OrgEntry[]>("admin-orgs", orgFetcher);
  const {
    data: invites,
    mutate: mutateInvites,
  } = useSWR<InviteEntry[]>("admin-invites", inviteFetcher);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<OrgEntry>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Organization",
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => {
          const role = row.getValue("role") as string;
          return (
            <Badge variant={role === "promotor" ? "default" : "secondary"}>
              {role === "promotor" ? "Promotor" : "Participant"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "country",
        header: "Country",
      },
      {
        accessorKey: "vc_verified_at",
        header: "Verified",
        cell: ({ row }) => {
          const verified = row.getValue("vc_verified_at");
          return verified ? (
            <Badge variant="outline">Verified</Badge>
          ) : (
            <span className="text-muted-foreground text-sm">-</span>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Joined",
        cell: ({ row }) => {
          const date = row.getValue("created_at") as string;
          return (
            <span className="text-sm text-muted-foreground">
              {new Date(date).toLocaleDateString()}
            </span>
          );
        },
      },
    ],
    [],
  );

  async function handleCreateInvite() {
    if (!orgName.trim()) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_name: orgName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.message ?? "Failed to create invite");
        return;
      }
      const data = json.data ?? json;
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
      const res = await fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.message ?? "Failed to revoke invite");
        return;
      }
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

  function handleOpenDialog() {
    setOrgName("");
    setCreatedInviteUrl(null);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    setOrgName("");
    setCreatedInviteUrl(null);
  }

  const statusVariant = (
    status: InviteEntry["status"],
  ): "default" | "secondary" | "destructive" => {
    if (status === "pending") return "default";
    if (status === "used") return "secondary";
    return "destructive";
  };

  return (
    <div className="flex-1 overflow-auto p-4">
    <div className="space-y-8">
      {/* Organizations table */}
      {!orgs?.length ? (
        <EmptyState
          icon={Users}
          title="No participants yet"
          description="Invite organizations to participate in your dataspace."
        />
      ) : (
        <DataTable
          columns={columns}
          data={orgs}
          searchKey="name"
          searchPlaceholder="Search organizations..."
        />
      )}

      {/* Invite management section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Pending Invitations</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Invite organizations to join your dataspace via a link.
            </p>
          </div>
          <Button size="sm" onClick={handleOpenDialog}>
            <Link2 size={14} className="mr-1.5" />
            Invite Organization
          </Button>
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
                    {invite.org_name ?? "Unknown Organization"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(invite.created_at).toLocaleDateString()}
                    {" · "}
                    Expires {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={statusVariant(invite.status)}>
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
            No invitations yet. Use the button above to invite an organization.
          </p>
        )}
      </section>

      {/* Create invite dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Organization</DialogTitle>
            <DialogDescription>
              Create an invite link for a new participant organization. Share
              the link with them to onboard to your dataspace.
            </DialogDescription>
          </DialogHeader>

          {createdInviteUrl ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Invite link created successfully. Share this URL with the
                organization:
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
                <Label htmlFor="org-name">Organization Name</Label>
                <Input
                  id="org-name"
                  placeholder="Acme Corp"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateInvite();
                  }}
                />
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
                  disabled={isCreating || !orgName.trim()}
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
