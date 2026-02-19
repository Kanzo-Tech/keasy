"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { fetchJobs } from "@/lib/api";
import { hasRunningJobs } from "@/lib/utils";
import { JobTable } from "@/components/job-table";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Job, JobStatus } from "@/lib/types";

const STATUS_FILTERS: Record<string, JobStatus[] | null> = {
  all: null,
  active: ["pending", "running"],
  completed: ["completed"],
  failed: ["failed", "cancelled"],
};

function countByFilter(jobs: Job[], statuses: JobStatus[] | null): number {
  if (!statuses) return jobs.length;
  return jobs.filter((j) => statuses.includes(j.status)).length;
}

function JobTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export default function JobsPage() {
  const [tab, setTab] = useState("all");
  const { data: jobs, isLoading, mutate } = useSWR("jobs", fetchJobs, {
    refreshInterval: (data) => (hasRunningJobs(data) ? 2000 : 0),
  });

  const allJobs = jobs ?? [];
  const filteredJobs =
    STATUS_FILTERS[tab] != null
      ? allJobs.filter((j) => STATUS_FILTERS[tab]!.includes(j.status))
      : allJobs;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Jobs"
        subtitle="Monitor and manage transformation jobs."
        action={
          <Button asChild size="sm">
            <Link href="/new" className="flex items-center gap-1.5">
              <Plus size={16} />
              New Job
            </Link>
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
        <TabsList variant="line">
          <TabsTrigger value="all">All ({allJobs.length})</TabsTrigger>
          <TabsTrigger value="active">
            Active ({countByFilter(allJobs, STATUS_FILTERS.active!)})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({countByFilter(allJobs, STATUS_FILTERS.completed!)})
          </TabsTrigger>
          <TabsTrigger value="failed">
            Failed ({countByFilter(allJobs, STATUS_FILTERS.failed!)})
          </TabsTrigger>
          <TabsTrigger value="graph">Knowledge Graph</TabsTrigger>
        </TabsList>

        {["all", "active", "completed", "failed"].map((key) => (
          <TabsContent key={key} value={key}>
            {isLoading ? <JobTableSkeleton /> : <JobTable jobs={filteredJobs} onDelete={() => mutate()} />}
          </TabsContent>
        ))}
        <TabsContent value="graph" className="flex-1 min-h-0 flex flex-col">
          <KnowledgeGraph />
        </TabsContent>
      </Tabs>
    </div>
  );
}
