"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Users } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";

type OrgEntry = {
  id: string;
  name: string;
  legal_name: string;
  role: string;
  country: string;
  vc_verified_at: string | null;
  created_at: string;
};

const fetcher = () =>
  fetch("/api/admin/organizations")
    .then((r) => r.json())
    .then((r) => r.data ?? []);

export default function ParticipantsPage() {
  const { data: orgs } = useSWR<OrgEntry[]>("admin-orgs", fetcher);

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

  if (!orgs?.length) {
    return (
      <EmptyState
        icon={Users}
        title="No participants yet"
        description="Invite organizations to participate in your dataspace."
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={orgs}
      searchKey="name"
      searchPlaceholder="Search organizations..."
    />
  );
}
