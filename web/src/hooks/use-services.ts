import useSWR from "swr";
import { fetchServiceStatus, type ServiceStatus } from "@/lib/api";

const DEFAULTS: ServiceStatus = {
  wallet: false,
  oidc: false,
  gxdch_notary: false,
  gxdch_compliance: false,
};

export function useServices() {
  const { data, isLoading } = useSWR("service-status", fetchServiceStatus, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  return { services: data ?? DEFAULTS, isLoading };
}
