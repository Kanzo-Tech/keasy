import type { ComponentType } from "react";
import { SiAmazons3 } from "react-icons/si";
import { SiGooglecloud } from "@icons-pack/react-simple-icons";
import { Cloud } from "lucide-react";
import { AzureIcon } from "@/components/icons/azure";

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  azure: AzureIcon,
  gcp: SiGooglecloud,
  s3: SiAmazons3,
};

export function getProviderIcon(
  icon: string
): ComponentType<{ className?: string }> {
  return iconMap[icon] ?? Cloud;
}
