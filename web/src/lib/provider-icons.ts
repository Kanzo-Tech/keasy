import type { ComponentType } from "react";
// react-icons 5.6.0 dropped the Simple Icons Amazon/AWS brand glyphs
// (trademark cleanup); the AWS mark now lives in the Font Awesome set.
import { FaAws } from "react-icons/fa";
import { VscAzure } from "react-icons/vsc";
import { Cloud } from "lucide-react";

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  azure: VscAzure,
  s3: FaAws,
};

export function getProviderIcon(
  icon: string,
): ComponentType<{ className?: string }> {
  return iconMap[icon] ?? Cloud;
}
