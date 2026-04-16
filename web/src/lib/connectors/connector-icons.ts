import type { ComponentType } from "react";
import { Cloud } from "lucide-react";
import { AwsIcon, GoogleCloudIcon, AzureIcon } from "@/components/icons/brand-icons";

const icons: Record<string, ComponentType<{ className?: string }>> = {
  s3: AwsIcon,
  gcs: GoogleCloudIcon,
  azure_blob: AzureIcon,
};

export function getConnectorIcon(
  kind: string,
): ComponentType<{ className?: string }> {
  return icons[kind] ?? Cloud;
}
