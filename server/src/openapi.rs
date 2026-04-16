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
        crate::settings::routes::get_org_settings,
        crate::settings::routes::save_org_settings,
        crate::settings::routes::get_preferences,
        crate::settings::routes::save_preferences,
        crate::settings::routes::list_ai_providers,
        crate::settings::routes::save_ai_provider,
        crate::settings::routes::delete_ai_provider,
        // Auth
        crate::auth::routes::get_me,
        crate::auth::routes::logout,
        crate::auth::routes::list_workspaces,
        // Scripts
        crate::executor::scripts::validate_script,
        // Providers
        crate::settings::providers::list_providers,
        // Admin
        crate::org::admin::list_all_orgs,
        crate::org::admin::create_org_and_invite,
        crate::org::admin::list_invites,
        crate::org::admin::create_invite,
        crate::org::admin::revoke_invite,
        crate::org::admin::list_dataspaces,
        crate::org::admin::register_dataspace,
        // Organization
        crate::org::routes::list_users,
        crate::org::routes::update_user_role,
        crate::org::routes::remove_user,
        crate::org::routes::get_org_identity,
        crate::org::routes::update_org_identity,
        crate::org::routes::create_org_invite,
        crate::org::routes::list_org_invites,
        crate::org::routes::revoke_org_invite,
        // Gaia-X Compliance
        crate::gaia_x::routes::comply,
        crate::gaia_x::routes::get_compliance_status,
        crate::gaia_x::routes::get_did_document,
        crate::gaia_x::routes::get_cert_chain,
        // Discovery
        crate::discovery::routes::resolve_discover_urls,
        // Dashboard Layout
        crate::jobs::handlers::get_dashboard_layout,
        crate::jobs::handlers::save_dashboard_layout,
        // Auth (additional)
        crate::auth::routes::get_invite_info,
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
        crate::org::organizations::Organization,
        // Scripts
        crate::executor::scripts::ValidateRequest,
        // Invite Tokens
        crate::org::invite_tokens::InviteToken,
        // Dataspaces
        crate::dataspaces::db::Dataspace,
        // Org members
        crate::org::org_members::OrgMember,
        // Gaia-X Compliance
        crate::gaia_x::routes::ComplianceCredential,
        crate::gaia_x::routes::ComplianceStatus,
        crate::gaia_x::ComplyRequest,
        crate::gaia_x::ComplyResponse,
        crate::gaia_x::ComplyEvent,
        // Auth response types
        crate::auth::routes::MeResponse,
        crate::auth::routes::MeOrg,
        crate::auth::routes::Workspace,
        crate::auth::routes::WorkspacesResponse,
        crate::auth::routes::InviteInfoResponse,
        crate::auth::routes::LogoutResponse,
        // Health
        crate::health::ServiceStatusResponse,
        // Admin
        crate::org::admin::CreateOrgAndInviteRequest,
        crate::org::admin::RegisterOidcClientRequest,
        crate::org::admin::CreateInviteRequest,
        crate::org::admin::AdminInviteEntry,
        crate::org::admin::AdminInviteResult,
        crate::org::admin::CreateOrgResponse,
        crate::org::admin::RegisterDataspaceResponse,
        // Organization
        crate::org::routes::OrgInviteEntry,
        crate::org::routes::UpdateUserRoleRequest,
        crate::org::routes::UpdateOrgIdentityPayload,
        crate::org::routes::CreateOrgInviteRequest,
        crate::org::routes::CreateOrgInviteResponse,
        crate::org::routes::OrgIdentityResponse,
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
