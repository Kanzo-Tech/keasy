"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, MoreHorizontal, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  DataTableSearch,
  DataTableToolbar,
  DataTableViewOptions,
  selectColumn,
  sortableHeader,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { AiSettings } from "@/lib/types";

export default function AiPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: providers = [], isLoading } = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: api.ai.providers,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  const { mutate: remove } = useMutation({
    mutationFn: (providerId: string) => api.ai.removeProvider(providerId),
    onSuccess: () => {
      toast.create({ title: "AI provider deleted", type: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
    },
    onError: () => toast.create({ title: "Failed to delete AI provider", type: "error" }),
  });

  const columns = useMemo<ColumnDef<AiSettings>[]>(
    () => [
      selectColumn<AiSettings>(),
      {
        accessorKey: "provider",
        header: sortableHeader("Provider"),
        cell: ({ getValue }) => {
          const id = getValue<string>();
          const option = AI_PROVIDERS.find((p) => p.id === id);
          return (
            <span className="inline-flex items-center gap-2 font-medium">
              {option && <option.icon className="size-4" />}
              {option?.label ?? id}
            </span>
          );
        },
      },
      {
        id: "model",
        header: "Model",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.model ??
              `Default: ${AI_PROVIDERS.find((p) => p.id === row.original.provider)?.defaultModel ?? "—"}`}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => row.original.api_key && <Badge variant="secondary">Connected</Badge>,
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        size: 48,
        cell: ({ row }) => (
          <div className="text-end">
            <Menu>
              <MenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${row.original.provider}`}
                  onClick={(event) => event.stopPropagation()}
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => remove(row.original.provider)} value="delete" variant="destructive">
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ),
      },
    ],
    [remove],
  );
  const table = useDataTable({ columns, data: providers });

  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            AI Providers
          </SectionTitle>
          <SectionDescription>
            Configure AI provider credentials for intelligent features.
          </SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        {isLoading ? (
          showSkeleton && <Skeleton className="h-40 w-full" />
        ) : providers.length === 0 ? (
          <Item className="mx-auto max-w-md flex-col gap-2 py-10 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <Bot />
            </ItemMedia>
            <ItemTitle className="text-base">No AI providers</ItemTitle>
            <ItemDescription>Add a provider to enable AI-powered features.</ItemDescription>
            <ItemActions>
              <Button asChild size="sm" variant="outline">
                <Link href="/settings/ai/new">Add provider</Link>
              </Button>
            </ItemActions>
          </Item>
        ) : (
          <DataTableRoot table={table}>
            <DataTableToolbar>
              <DataTableSearch column="provider" placeholder="Search providers..." />
              <div className="ms-auto flex items-center gap-2">
                <DataTableViewOptions />
                <Button asChild size="sm">
                  <Link href="/settings/ai/new">
                    <Plus />
                    Add provider
                  </Link>
                </Button>
              </div>
            </DataTableToolbar>
            <DataTableContent<AiSettings>
              empty="No providers match this filter."
              onRowClick={(provider) => router.push(`/settings/ai/${provider.provider}`)}
            />
            <DataTablePagination />
          </DataTableRoot>
        )}
      </SectionBody>
    </SectionRoot>
  );
}
