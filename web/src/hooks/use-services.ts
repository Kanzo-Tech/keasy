import { useQuery } from "@tanstack/react-query";
import { api, type ServiceStatus } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const DEFAULTS: ServiceStatus = {
  oidc: false,
};

export function useServices() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.services,
    queryFn: api.status.services,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return { services: data ?? DEFAULTS, isLoading };
}
