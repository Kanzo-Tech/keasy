import type { ComponentType } from "react";
import { Cloud } from "lucide-react";
import { connectorRegistry } from "@/lib/connectors";

export function getProviderIcon(
  id: string,
): ComponentType<{ className?: string }> {
  return connectorRegistry[id]?.icon ?? Cloud;
}
