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
        crate::jobs::routes::get_job_catalog,
        // Connections
        crate::connections::routes::list_connections,
        crate::connections::routes::create_connection,
        crate::connections::routes::get_connection,
        crate::connections::routes::update_connection,
        crate::connections::routes::delete_connection,
        crate::connections::routes::list_connection_files,
        crate::connections::routes::upload_file,
        crate::connections::routes::get_file_schema,
        // Cloud Accounts
        crate::cloud::routes::list_accounts,
        crate::cloud::routes::create_account,
        crate::cloud::routes::get_account,
        crate::cloud::routes::update_account,
        crate::cloud::routes::delete_account,
        // Settings
        crate::settings::routes::get_schema,
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
        // AI / Conversations
        crate::ai::routes::ask_discover,
        crate::ai::routes::create_conversation,
        crate::ai::routes::list_conversations,
        crate::ai::routes::get_conversation_messages,
        crate::ai::routes::rename_conversation,
        crate::ai::routes::delete_conversation,
        // Assistant
        crate::assistant::routes::suggest_cqs_stream,
        crate::assistant::routes::generate_script_stream,
        // Dashboard Layout
        crate::jobs::routes::get_dashboard_layout,
        crate::jobs::routes::save_dashboard_layout,
        // Auth (additional)
        crate::auth::routes::get_invite_info,
        // Fossil Analysis
        crate::routes::fossil_analysis::analyze,
    ),
    components(schemas(
        crate::error::DataResponse<serde_json::Value>,
        // Jobs
        crate::jobs::models::Job,
        crate::jobs::models::JobStatus,
        crate::jobs::models::RunMode,
        crate::jobs::models::CreateJobRequest,
        crate::jobs::models::UpdateJobRequest,
        fossil_lang::runtime::executor::DataManifest,
        fossil_lang::runtime::executor::TypeManifest,
        fossil_lang::runtime::executor::EdgeManifest,
        fossil_lang::runtime::executor::ColumnStat,
        crate::jobs::errors::JobRuntimeError,
        crate::jobs::pipeline_types::PipelineSummary,
        crate::jobs::pipeline_types::PipelineInput,
        crate::jobs::pipeline_types::PipelineOutput,
        crate::jobs::pipeline_types::PipelineOperation,
        crate::jobs::pipeline_types::OperationInput,
        crate::jobs::pipeline_types::Field,
        crate::jobs::pipeline_types::FieldMapping,
        crate::jobs::pipeline_types::ValidationResult,
        // Connections
        crate::connections::models::Connection,
        crate::connections::models::ConnectionKind,
        crate::connections::models::LocationType,
        crate::connections::models::CreateConnectionRequest,
        crate::connections::models::UpdateConnectionRequest,
        crate::connections::models::UploadFileRequest,
        crate::connections::models::ColumnInfo,
        crate::connections::models::FileSchemaResponse,
        // Cloud Accounts
        crate::cloud::models::CloudAccountSummary,
        crate::cloud::models::CreateCloudAccountRequest,
        crate::cloud::models::UpdateCloudAccountRequest,
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
        crate::jobs::routes::CatalogResponse,
        crate::jobs::runner::JobEvent,
        // Discovery
        crate::graph::types::TabularData,
        // Providers
        crate::routes::providers::ProviderEntry,
        // AI / Conversations
        crate::ai::routes::AskRequest,
        crate::ai::routes::AskResponse,
        crate::ai::routes::CreateConversationRequest,
        crate::ai::routes::RenameConversationRequest,
        crate::ai::models::Conversation,
        crate::ai::models::ConversationMessage,
        // Assistant
        crate::assistant::models::FileSchema,
        crate::assistant::models::SuggestRequest,
        crate::assistant::models::SuggestResponse,
        crate::assistant::models::CompetencyQuestion,
        crate::assistant::models::GenerateRequest,
        crate::assistant::models::GenerateResponse,
        // Cloud files
        crate::cloud::reader::FileEntry,
        // Settings schema
        crate::settings::schema::ProviderSchema,
        crate::settings::schema::FieldSchema,
        crate::settings::schema::AuthMethodSchema,
        // Fossil Analysis
        crate::routes::fossil_analysis::AnalyzeRequest,
        crate::routes::fossil_analysis::AnalyzeResponse,
        fossil_lsp::CompletionItem,
        fossil_lsp::DiagnosticItem,
    ))
)]
pub struct ApiDoc;

pub async fn openapi_json() -> axum::response::Response {
    use axum::response::IntoResponse;
    let doc = ApiDoc::openapi();
    axum::Json(doc).into_response()
}
