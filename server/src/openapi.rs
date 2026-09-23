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
        crate::routes::health::version,
        // Jobs
        crate::jobs::routes::list_jobs,
        crate::jobs::routes::create_job,
        crate::jobs::routes::get_job,
        crate::jobs::routes::update_job,
        crate::jobs::routes::complete_job,
        crate::jobs::routes::delete_job,
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
        crate::auth::routes::list_workspaces,
        // Workspace legal identity
        crate::routes::org::get_org_identity,
        crate::routes::org::update_org_identity,
        // Discovery
        crate::discovery::routes::resolve_output_urls,
        crate::discovery::routes::resolve_source_refs,
        crate::discovery::routes::resolve_source_urls,
        crate::discovery::routes::resolve_discover_urls,
        crate::jobs::routes::publish_relations,
        crate::catalog::routes::list_catalog_datasets,
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
    ),
    components(schemas(
        crate::error::DataResponse<serde_json::Value>,
        // Jobs
        crate::jobs::models::Job,
        crate::jobs::models::JobStatus,
        crate::jobs::models::RunMode,
        crate::jobs::models::CreateJobRequest,
        crate::jobs::models::UpdateJobRequest,
        crate::jobs::models::CompleteJobRequest,
        crate::jobs::models::PublishRelationsRequest,
        crate::jobs::models::OutputRelation,
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
        // Auth response types
        crate::auth::routes::WorkspacesResponse,
        // Health
        crate::routes::health::VersionResponse,
        // Workspace legal identity
        crate::routes::org::UpdateOrgIdentityPayload,
        crate::routes::org::OrgIdentityResponse,
        // Catalog (governance)
        crate::catalog::routes::DatasetsResponse,
        crate::catalog::view::CatalogDataset,
        crate::catalog::view::CatalogTable,
        crate::catalog::view::CatalogColumn,
        // AI / Conversations
        crate::ai::models::TabularData,
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
