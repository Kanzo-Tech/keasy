use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Keasy API",
        version = "1.0.0",
        description = "Keasy — data pipeline execution, cloud storage, and Gaia-X compliance API",
    ),
    paths(
        // Health
        crate::health::liveness,
        crate::health::readiness,
        crate::health::service_status,
        // Jobs
        crate::jobs::handlers::list_jobs,
        crate::jobs::handlers::create_job,
        crate::jobs::handlers::get_job,
        crate::jobs::handlers::update_job,
        crate::jobs::handlers::delete_job,
        // Settings
        crate::settings::handlers::get_org_settings,
        crate::settings::handlers::save_org_settings,
        crate::settings::handlers::get_preferences,
        crate::settings::handlers::save_preferences,
        crate::settings::handlers::list_ai_providers,
        crate::settings::handlers::save_ai_provider,
        crate::settings::handlers::delete_ai_provider,
        // Auth
        crate::auth::handlers::get_me,
        crate::auth::handlers::logout,
        crate::auth::handlers::list_workspaces,
        // Scripts
        crate::executor::scripts::validate_script,
        // Providers
        crate::settings::providers::list_providers,
        // Admin
        crate::org::admin_handlers::list_all_orgs,
        crate::org::admin_handlers::create_org_and_invite,
        crate::org::admin_handlers::list_invites,
        crate::org::admin_handlers::create_invite,
        crate::org::admin_handlers::revoke_invite,
        crate::org::admin_handlers::list_dataspaces,
        crate::org::admin_handlers::register_dataspace,
        // Organization
        crate::org::handlers::list_users,
        crate::org::handlers::update_user_role,
        crate::org::handlers::remove_user,
        crate::org::handlers::get_org_identity,
        crate::org::handlers::update_org_identity,
        crate::org::handlers::create_org_invite,
        crate::org::handlers::list_org_invites,
        crate::org::handlers::revoke_org_invite,
        // Gaia-X Compliance
        crate::gaia_x::handlers::comply,
        crate::gaia_x::handlers::get_compliance_status,
        crate::gaia_x::handlers::get_did_document,
        crate::gaia_x::handlers::get_cert_chain,
        // Discovery
        crate::discovery::handlers::resolve_discover_urls,
        // Dashboard Layout
        crate::jobs::handlers::get_dashboard_layout,
        crate::jobs::handlers::save_dashboard_layout,
        // Auth (additional)
        crate::auth::handlers::get_invite_info,
        // Fossil Analysis
        crate::executor::fossil_analysis::analyze,
        // Connectors
        crate::connectors::handlers::list_connectors,
        crate::connectors::handlers::create_connector,
        crate::connectors::handlers::get_connector,
        crate::connectors::handlers::update_connector,
        crate::connectors::handlers::delete_connector,
        crate::connectors::handlers::list_connector_kinds,
        crate::connectors::handlers::test_connector,
    ),
    components(schemas(
        crate::error::DataResponse<serde_json::Value>,
        // Jobs
        crate::jobs::models::Job,
        crate::jobs::models::JobStatus,
        crate::jobs::models::RunMode,
        crate::jobs::models::CreateJobRequest,
        crate::jobs::models::UpdateJobRequest,
        crate::graph::manifest::DataManifest,
        crate::graph::manifest::TypeManifest,
        crate::graph::manifest::EdgeManifest,
        crate::graph::manifest::ColumnStat,
        crate::jobs::errors::JobRuntimeError,
        crate::jobs::pipeline_types::PipelineSummary,
        crate::jobs::pipeline_types::PipelineInput,
        crate::jobs::pipeline_types::PipelineOutput,
        crate::jobs::pipeline_types::PipelineOperation,
        crate::jobs::pipeline_types::OperationInput,
        crate::jobs::pipeline_types::Field,
        crate::jobs::pipeline_types::FieldMapping,
        crate::jobs::pipeline_types::ValidationResult,
        // Connectors
        crate::connectors::models::Connector,
        crate::connectors::models::ConnectorDirection,
        crate::connectors::models::ConnectorResponse,
        crate::connectors::models::CreateConnectorRequest,
        crate::connectors::models::UpdateConnectorRequest,
        crate::connectors::config::ConnectorConfig,
        crate::connectors::config::ConnectorKindInfo,
        // Settings
        crate::settings::org::OrgSettings,
        crate::settings::preferences::Preferences,
        crate::settings::ai::AiSettingsPayload,
        // Organizations
        crate::org::models::Organization,
        // Scripts
        crate::executor::scripts::ValidateRequest,
        // Invite Tokens
        crate::org::models::InviteToken,
        // Dataspaces
        crate::dataspaces::db::Dataspace,
        // Org members
        crate::org::models::OrgMember,
        // Gaia-X Compliance
        crate::gaia_x::handlers::ComplianceCredential,
        crate::gaia_x::handlers::ComplianceStatus,
        crate::gaia_x::ComplyRequest,
        crate::gaia_x::ComplyResponse,
        crate::gaia_x::ComplyEvent,
        // Auth response types
        crate::auth::handlers::MeResponse,
        crate::auth::handlers::MeOrg,
        crate::auth::handlers::Workspace,
        crate::auth::handlers::WorkspacesResponse,
        crate::auth::handlers::InviteInfoResponse,
        crate::auth::handlers::LogoutResponse,
        // Health
        crate::health::ServiceStatusResponse,
        // Admin
        crate::org::admin_handlers::CreateOrgAndInviteRequest,
        crate::org::admin_handlers::RegisterOidcClientRequest,
        crate::org::admin_handlers::CreateInviteRequest,
        crate::org::admin_handlers::AdminInviteEntry,
        crate::org::admin_handlers::AdminInviteResult,
        crate::org::admin_handlers::CreateOrgResponse,
        crate::org::admin_handlers::RegisterDataspaceResponse,
        // Organization
        crate::org::handlers::OrgInviteEntry,
        crate::org::handlers::UpdateUserRoleRequest,
        crate::org::handlers::UpdateOrgIdentityPayload,
        crate::org::handlers::CreateOrgInviteRequest,
        crate::org::handlers::CreateOrgInviteResponse,
        crate::org::handlers::OrgIdentityResponse,
        // Jobs
        // Discovery
        crate::graph::types::TabularData,
        // Providers
        crate::settings::providers::ProviderEntry,
        // Fossil Analysis
        crate::executor::fossil_analysis::AnalyzeRequest,
        crate::executor::fossil_analysis::AnalyzeResponse,
        crate::executor::fossil_analysis::CompletionItem,
        crate::executor::fossil_analysis::DiagnosticItem,
    ))
)]
pub struct ApiDoc;

pub async fn openapi_json() -> axum::response::Response {
    use axum::response::IntoResponse;
    let doc = ApiDoc::openapi();
    axum::Json(doc).into_response()
}
