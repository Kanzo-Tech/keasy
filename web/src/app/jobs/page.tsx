"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Briefcase, Plus, Share2 } from "lucide-react";
import { fetchJobs } from "@/lib/api";
import { hasRunningJobs } from "@/lib/utils";
import { JobTable } from "@/components/job-table";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JobStatus } from "@/lib/types";

export default function JobsPage() {
  const [tab, setTab] = useState("jobs");
  const [statusFilter, setStatusFilter] = useState<Set<JobStatus>>(new Set());
  const { data: jobs, isLoading, mutate } = useSWR("jobs", fetchJobs, {
    refreshInterval: (data) => (hasRunningJobs(data) ? 2000 : 0),
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Jobs"
        subtitle="Monitor and manage transformation jobs."
        action={
          <Button asChild size="sm">
            <Link href="/jobs/new" className="flex items-center gap-1.5">
              <Plus size={16} />
              New Job
            </Link>
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0">
        <TabsList className="mb-4">
          <TabsTrigger value="jobs" className="gap-1.5">
            <Briefcase size={14} />
            Jobs
          </TabsTrigger>
          <TabsTrigger value="graph" className="gap-1.5">
            <Share2 size={14} />
            Graph
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs">
          <ScrollArea className="flex-1 min-h-0">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <JobTable
                jobs={jobs ?? []}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                onDelete={() => mutate()}
              />
            )}
          </ScrollArea>
        </TabsContent>
        <TabsContent value="graph">
          <KnowledgeGraph />
        </TabsContent>
      </Tabs>
    </div>
  );
}
