"use client";

import { useState } from "react";
import useSWR from "swr";
import { Network } from "lucide-react";
import { GraphView } from "@/components/discovery/graph-view";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrgEntry } from "@/lib/types";

const orgFetcher = () =>
  fetch("/v1/admin/organizations")
    .then((r) => r.json())
    .then((r) => (r.data ?? []).filter((o: OrgEntry) => o.role !== "promotor"));

export default function GraphPage() {
  const [selectedOrg, setSelectedOrg] = useState<string | undefined>();
  const { data: orgs } = useSWR<OrgEntry[]>("admin-orgs-participants", orgFetcher);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-muted-foreground" />
          <h1 className="text-sm font-semibold">Graph</h1>
        </div>
        <Select
          value={selectedOrg ?? "all"}
          onValueChange={(v) => setSelectedOrg(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All participants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All participants</SelectItem>
            {orgs?.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 overflow-auto">
        <GraphView source={{ type: "admin", orgId: selectedOrg }} />
      </div>
    </div>
  );
}
