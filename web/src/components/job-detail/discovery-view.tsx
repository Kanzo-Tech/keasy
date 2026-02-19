"use client";

import { useState } from "react";
import { BarChart3, MessageCircle, Search } from "lucide-react";
import { DashboardBuilder } from "@/components/dashboard-builder";
import { DiscoveryAsk } from "@/components/discovery-ask";
import { DiscoveryExplorer } from "@/components/discovery-explorer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface DiscoveryViewProps {
  jobId: string;
}

export function DiscoveryView({ jobId }: DiscoveryViewProps) {
  const [viewMode, setViewMode] = useState<"explorer" | "dashboard" | "ask">("explorer");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3 h-7">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={viewMode}
          onValueChange={(v) => { if (v) setViewMode(v as "explorer" | "dashboard" | "ask"); }}
        >
          <ToggleGroupItem value="explorer" className="h-7 px-2">
            <Search size={14} />
          </ToggleGroupItem>
          <ToggleGroupItem value="dashboard" className="h-7 px-2">
            <BarChart3 size={14} />
          </ToggleGroupItem>
          <ToggleGroupItem value="ask" className="h-7 px-2">
            <MessageCircle size={14} />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {viewMode === "explorer" ? (
        <DiscoveryExplorer jobId={jobId} />
      ) : viewMode === "dashboard" ? (
        <DashboardBuilder jobId={jobId} />
      ) : (
        <DiscoveryAsk jobId={jobId} />
      )}
    </div>
  );
}
