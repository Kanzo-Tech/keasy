import type { ComponentType } from "react";
import { SiGooglecloud, SiAmazons3 } from "react-icons/si";
import { VscAzure } from "react-icons/vsc";
import { Cloud } from "lucide-react";

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  azure: VscAzure,
  gcp: SiGooglecloud,
  s3: SiAmazons3,
};

export function getProviderIcon(
  icon: string
): ComponentType<{ className?: string }> {
  return iconMap[icon] ?? Cloud;
}
