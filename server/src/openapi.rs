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
        crate::routes::health::liveness,
        crate::routes::health::readiness,
        crate::routes::health::service_status,
        // Jobs
        crate::jobs::routes::list_jobs,
        crate::jobs::routes::create_job,
        crate::jobs::routes::get_job,
        crate::jobs::routes::update_job,
        crate::jobs::routes::delete_job,
        crate::jobs::routes::stream_job,
        // Settings
        crate::settings::routes::get_org_settings,
        crate::settings::routes::save_org_settings,
        crate::settings::routes::get_preferences,
        crate::settings::routes::save_preferences,
        crate::settings::routes::get_catalog_storage,
        crate::settings::routes::save_catalog_storage,
        crate::settings::routes::list_ai_providers,
        crate::settings::routes::save_ai_provider,
        crate::settings::routes::delete_ai_provider,
        // Auth
        crate::auth::routes::get_me,
        crate::auth::routes::logout,
        crate::auth::routes::list_workspaces,
        // Scripts
        crate::routes::scripts::validate_script,
        // Providers
        crate::routes::providers::list_providers,
        // Admin
        crate::routes::admin::list_all_orgs,
        crate::routes::admin::create_org_and_invite,
        crate::routes::admin::list_invites,
        crate::routes::admin::create_invite,
        crate::routes::admin::revoke_invite,
        crate::routes::admin::list_dataspaces,
        crate::routes::admin::register_dataspace,
        // Organization
        crate::routes::org::list_users,
        crate::routes::org::update_user_role,
        crate::routes::org::remove_user,
        crate::routes::org::get_org_identity,
        crate::routes::org::update_org_identity,
        crate::routes::org::create_org_invite,
        crate::routes::org::list_org_invites,
        crate::routes::org::revoke_org_invite,
        // Gaia-X Compliance
        crate::gaia_x::routes::comply,
        crate::gaia_x::routes::get_compliance_status,
        crate::gaia_x::routes::get_did_document,
        crate::gaia_x::routes::get_cert_chain,
        // Discovery
        crate::discovery::routes::resolve_discover_urls,
        // Dashboard Layout
        crate::jobs::routes::get_dashboard_layout,
        crate::jobs::routes::save_dashboard_layout,
        // Auth (additional)
        crate::auth::routes::get_invite_info,
        // Fossil Analysis
        crate::routes::fossil_analysis::analyze,
        // Connectors
        crate::connectors::routes::list_connectors,
        crate::connectors::routes::create_connector,
        crate::connectors::routes::get_connector,
        crate::connectors::routes::update_connector,
        crate::connectors::routes::delete_connector,
        crate::connectors::routes::list_connector_files,
        crate::connectors::routes::list_connector_types,
        crate::connectors::routes::test_connector,
        crate::connectors::routes::post_connector_schema,
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
        crate::connectors::models::CreateConnectorRequest,
        crate::connectors::models::UpdateConnectorRequest,
        crate::connectors::types::ConnectorTypeInfo,
        crate::connectors::storage::FileEntry,
        crate::connectors::schema::SchemaRequest,
        crate::connectors::schema::SchemaEntry,
        crate::connectors::schema::ColumnInfo,
        // Settings
        crate::settings::org::OrgSettings,
        crate::settings::preferences::Preferences,
        crate::settings::ai::AiSettingsPayload,
        // Organizations
        crate::db::organizations::Organization,
        // Scripts
        crate::routes::scripts::ValidateRequest,
        // Invite Tokens
        crate::db::invite_tokens::InviteToken,
        // Dataspaces
        crate::db::dataspaces::Dataspace,
        // Org members
        crate::db::org_members::OrgMember,
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
        crate::routes::health::ServiceStatusResponse,
        // Admin
        crate::routes::admin::CreateOrgAndInviteRequest,
        crate::routes::admin::RegisterOidcClientRequest,
        crate::routes::admin::CreateInviteRequest,
        crate::routes::admin::AdminInviteEntry,
        crate::routes::admin::AdminInviteResult,
        crate::routes::admin::CreateOrgResponse,
        crate::routes::admin::RegisterDataspaceResponse,
        // Organization
        crate::routes::org::OrgInviteEntry,
        crate::routes::org::UpdateUserRoleRequest,
        crate::routes::org::UpdateOrgIdentityPayload,
        crate::routes::org::CreateOrgInviteRequest,
        crate::routes::org::CreateOrgInviteResponse,
        crate::routes::org::OrgIdentityResponse,
        // Jobs
        crate::jobs::runner::JobEvent,
        // Discovery
        crate::graph::types::TabularData,
        // Providers
        crate::routes::providers::ProviderEntry,
        // Fossil Analysis
        crate::routes::fossil_analysis::AnalyzeRequest,
        crate::routes::fossil_analysis::AnalyzeResponse,
        crate::routes::fossil_analysis::CompletionItem,
        crate::routes::fossil_analysis::DiagnosticItem,
    ))
)]
pub struct ApiDoc;

pub async fn openapi_json() -> axum::response::Response {
    use axum::response::IntoResponse;
    let doc = ApiDoc::openapi();
    axum::Json(doc).into_response()
}
