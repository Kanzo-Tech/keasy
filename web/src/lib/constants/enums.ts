// Single source of truth for enum-like constants. Most are derived from
// the OpenAPI-generated `Schemas` namespace; a few backend types aren't
// yet exposed via #[derive(utoipa::ToSchema)] on the Rust side and are
// declared explicitly here — TODO migrate them to the schema.

import type { Schemas } from "@/lib/api/client";

export type ConnectorDirection = Schemas["ConnectorDirection"];
export const CONNECTOR_DIRECTIONS: readonly ConnectorDirection[] = [
  "source",
  "destination",
  "both",
] as const;

export type RunMode = Schemas["RunMode"];
export const RUN_MODES: readonly RunMode[] = ["integrated", "scheduled"] as const;

export type JobStatus = Schemas["JobStatus"];
export const JOB_STATUSES: readonly JobStatus[] = [
  "draft",
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

// Mirror of server/src/org/models.rs::MemberRole. Not yet in OpenAPI schema.
export type MemberRole = "admin" | "user";
export const MEMBER_ROLES: readonly MemberRole[] = ["admin", "user"] as const;

// Mirror of GaiaX organization registration_number_type values.
// Not in OpenAPI schema — backend stores as `Option<String>`.
export type RegistrationNumberType = "vatID" | "leiCode" | "EORI";
export const REGISTRATION_NUMBER_TYPES: readonly RegistrationNumberType[] = [
  "vatID",
  "leiCode",
  "EORI",
] as const;
export const REGISTRATION_NUMBER_TYPE_LABELS: Record<RegistrationNumberType, string> = {
  vatID: "VAT ID",
  leiCode: "LEI Code",
  EORI: "EORI",
};
