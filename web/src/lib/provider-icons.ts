import type { ComponentType } from "react";
import { getConnectorIcon } from "@/lib/connectors/connector-icons";

export function getProviderIcon(
  id: string,
): ComponentType<{ className?: string }> {
  return getConnectorIcon(id);
}
