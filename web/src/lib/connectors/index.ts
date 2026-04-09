import { s3Connector } from "./s3";
import { gcsConnector } from "./gcs";
import { azureConnector } from "./azure";
import { localFsConnector } from "./local-fs";
import type { TypeDef } from "@/lib/schemas/field-def";

export const connectorRegistry: Record<string, TypeDef> = {
  s3: s3Connector,
  gcs: gcsConnector,
  azure_blob: azureConnector,
  local_fs: localFsConnector,
};
