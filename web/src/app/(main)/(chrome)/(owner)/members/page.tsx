"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, UserCircle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import type { OrgUser } from "@/lib/types";

function memberColumns(
  onRemove: (userId: string, name: string) => void,
): ColumnDef<OrgUser>[] {
  return [
    selectColumn<OrgUser>(),
    {
      id: "name",
      header: sortableHeader("Nombre"),
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
      header: "Rol",
      cell: ({ row }) => {
        const role = row.original.role;
        return (
          <Badge variant={role === "owner" ? "default" : "secondary"}>
            {role === "owner" ? "Propietario" : "Miembro"}
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
          Eliminar
        </ActionItem>
      );
    }),
  ];
}

export default function MembersPage() {
  const { users, isLoading, handleRemoveUser } = useOrgUsers();
  const [email, setEmail] = useState("");

  const columns = useMemo(
    () => memberColumns(handleRemoveUser),
    [handleRemoveUser],
  );

  const inviteMutation = useMutation({
    mutationFn: (address: string) => api.org.inviteMember(address),
    onSuccess: (_, address) => {
      toast.success(`Invitación enviada a ${address}`);
      setEmail("");
    },
    onError: () => toast.error("No se pudo enviar la invitación"),
  });

  function handleInvite() {
    const address = email.trim();
    if (!address || inviteMutation.isPending) return;
    inviteMutation.mutate(address);
  }

  return (
    <PageShell>
      <PageShell.Content className="gap-8">
        <SettingsSection
          title="Miembros"
          description="Personas con acceso a este espacio de trabajo. Invita a alguien por email — recibirá un correo para unirse como miembro."
        >
          <form
            className="flex items-center gap-2 max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              handleInvite();
            }}
          >
            <Input
              type="email"
              placeholder="persona@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={inviteMutation.isPending}
            />
            <Button
              type="submit"
              disabled={!email.trim() || inviteMutation.isPending}
            >
              <Send size={14} className="mr-1.5" />
              {inviteMutation.isPending ? "Enviando..." : "Invitar"}
            </Button>
          </form>

          {!isLoading && !users.length ? (
            <EmptyState
              icon={UserCircle}
              title="Aún no hay miembros"
              description="Invita a alguien por email para darle acceso a este espacio de trabajo."
            />
          ) : (
            <DataTable
              columns={columns}
              data={users}
              searchKey="email"
              searchPlaceholder="Buscar miembros..."
            />
          )}
        </SettingsSection>
      </PageShell.Content>
    </PageShell>
  );
}
