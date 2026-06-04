use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Keasy API",
        version = "1.0.0",
        description = "Keasy — data pipeline execution and cloud storage API",
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
        // Providers
        crate::routes::providers::list_providers,
        // Organization
        crate::routes::org::list_users,
        crate::routes::org::remove_user,
        crate::routes::org::get_org_identity,
        crate::routes::org::update_org_identity,
        crate::routes::org::create_org_invite,
        crate::routes::org::list_org_invites,
        crate::routes::org::revoke_org_invite,
        // Discovery
        crate::discovery::routes::resolve_discover_urls,
        // AI / Conversations
        crate::ai::routes::ask_discover_stream,
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
    ),
    components(schemas(
        crate::error::DataResponse<serde_json::Value>,
        // Jobs
        crate::jobs::models::Job,
        crate::jobs::models::JobStatus,
        crate::jobs::models::RunMode,
        crate::jobs::models::CreateJobRequest,
        crate::jobs::models::UpdateJobRequest,
        fossil_run_status::RunStatus,
        fossil_run_status::VertexStatus,
        fossil_run_status::EdgeStatus,
        fossil_run_status::ColumnStatus,
        crate::jobs::errors::JobRuntimeError,
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
        // Invite Tokens
        crate::db::invite_tokens::InviteToken,
        // Workspaces
        crate::db::workspaces::Workspace,
        // Org members
        crate::db::org_members::OrgMember,
        // Auth response types
        crate::auth::routes::MeResponse,
        crate::auth::routes::MeOrg,
        crate::auth::routes::WorkspaceSummary,
        crate::auth::routes::WorkspacesResponse,
        crate::auth::routes::InviteInfoResponse,
        crate::auth::routes::LogoutResponse,
        // Health
        crate::routes::health::ServiceStatusResponse,
        // Organization
        crate::routes::org::OrgInviteEntry,
        crate::routes::org::UpdateOrgIdentityPayload,
        crate::routes::org::CreateOrgInviteResponse,
        crate::routes::org::OrgIdentityResponse,
        // Jobs
        crate::jobs::runner::JobEvent,
        // Discovery
        crate::graph::types::TabularData,
        // Providers
        fossil_run_status::ProviderInfo,
        fossil_run_status::ProviderKind,
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
    ))
)]
pub struct ApiDoc;

pub async fn openapi_json() -> axum::response::Response {
    use axum::response::IntoResponse;
    let doc = ApiDoc::openapi();
    axum::Json(doc).into_response()
}
