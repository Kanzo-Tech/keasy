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
        crate::jobs::routes::cancel_job,
        crate::jobs::routes::get_job_catalog,
        crate::jobs::routes::get_job_graph,
        crate::jobs::routes::get_unified_graph,
        // Connections
        crate::connections::routes::list_connections,
        crate::connections::routes::create_connection,
        crate::connections::routes::get_connection,
        crate::connections::routes::update_connection,
        crate::connections::routes::delete_connection,
        crate::connections::routes::list_connection_files,
        // Cloud Accounts
        crate::cloud::routes::list_accounts,
        crate::cloud::routes::create_account,
        crate::cloud::routes::get_account,
        crate::cloud::routes::update_account,
        crate::cloud::routes::delete_account,
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
        crate::routes::scripts::validate_script,
    ),
    components(schemas(
        crate::error::DataResponse<serde_json::Value>,
        // Jobs
        crate::jobs::models::Job,
        crate::jobs::models::JobStatus,
        crate::jobs::models::RunMode,
        crate::jobs::models::CreateJobRequest,
        crate::jobs::models::UpdateJobRequest,
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
    ))
)]
pub struct ApiDoc;

pub async fn openapi_json() -> axum::response::Response {
    use axum::response::IntoResponse;
    let doc = ApiDoc::openapi();
    axum::Json(doc).into_response()
}
