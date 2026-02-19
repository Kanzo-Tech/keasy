import type { ComponentType } from "react";
import { SiGooglecloudstorage, SiAmazons3 } from "react-icons/si";
import { Cloud } from "lucide-react";
import { AzureIcon } from "@/components/icons/azure";

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  azure: AzureIcon,
  gcp: SiGooglecloudstorage,
  s3: SiAmazons3,
};

export function getProviderIcon(
  icon: string
): ComponentType<{ className?: string }> {
  return iconMap[icon] ?? Cloud;
}
