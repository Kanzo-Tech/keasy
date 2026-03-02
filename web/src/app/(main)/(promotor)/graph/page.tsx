"use client";

import { useState } from "react";
import useSWR from "swr";
import { GraphView } from "@/components/discovery/graph-view";
import { PageContent, PageHeader } from "@/components/layout/page-content";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrgEntry } from "@/lib/types";
import { api } from "@/lib/api";

const orgFetcher = async () => {
  const data = await api.admin.orgs();
  return data.filter((o) => o.role !== "promotor");
};

export default function GraphPage() {
  const [selectedOrg, setSelectedOrg] = useState<string | undefined>();
  const { data: orgs } = useSWR<OrgEntry[]>("admin-orgs-participants", orgFetcher);

  return (
    <PageContent className="flex flex-col p-0">
      <div className="px-4 pt-4">
        <PageHeader
          title="Graph"
          actions={
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
          }
        />
      </div>
      <div className="flex-1 overflow-auto">
        <GraphView source={{ type: "admin", orgId: selectedOrg }} />
      </div>
    </PageContent>
  );
}
