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
        crate::settings::routes::get_schema,
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
        // Providers
        crate::routes::providers::list_providers,
        // Admin
        crate::routes::admin::list_all_orgs,
        crate::routes::admin::create_org_and_invite,
        crate::routes::admin::list_invites,
        crate::routes::admin::create_invite,
        crate::routes::admin::revoke_invite,
        crate::routes::admin::list_oidc_clients,
        crate::routes::admin::register_oidc_client,
        // Organization
        crate::routes::org::list_users,
        crate::routes::org::update_user_role,
        crate::routes::org::remove_user,
        crate::routes::org::get_org_identity,
        crate::routes::org::update_org_identity,
        crate::routes::org::create_org_invite,
        crate::routes::org::list_org_invites,
        crate::routes::org::revoke_org_invite,
        // Gaia-X Compliance Wizard
        crate::gaia_x::routes::get_wizard_state,
        crate::gaia_x::routes::generate_keys,
        crate::gaia_x::routes::validate_certificate,
        crate::gaia_x::routes::request_lrn,
        crate::gaia_x::routes::sign_legal_participant,
        crate::gaia_x::routes::sign_terms_conditions,
        crate::gaia_x::routes::submit_gxdch,
        crate::gaia_x::routes::get_compliance_status,
        crate::gaia_x::routes::rerun_compliance,
        crate::gaia_x::routes::get_did_document,
        crate::gaia_x::routes::get_cert_chain,
        // Gaia-X Wallet
        crate::gaia_x::wallet_routes::init_wallet_session,
        crate::gaia_x::wallet_routes::wallet_verify_status,
        crate::gaia_x::wallet_routes::get_wallet,
        crate::gaia_x::wallet_routes::save_wallet_connection,
        crate::gaia_x::wallet_routes::disconnect_wallet,
        // Gaia-X Credentials
        crate::gaia_x::issuer_routes::create_credential_offer,
        // Discovery
        crate::discovery::routes::search_nodes,
        crate::discovery::routes::expand_node,
        crate::discovery::routes::query_discover,
        crate::discovery::routes::chart_discover,
        crate::discovery::routes::load_discover,
        crate::discovery::routes::export_discover,
        // Validation
        crate::discovery::validation_routes::validate_job,
        // AI / Conversations
        crate::ai::routes::ask_discover,
        crate::ai::routes::create_conversation,
        crate::ai::routes::list_conversations,
        crate::ai::routes::get_conversation_messages,
        crate::ai::routes::rename_conversation,
        crate::ai::routes::delete_conversation,
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
        // Invite Tokens
        crate::db::invite_tokens::InviteToken,
        // OIDC Clients
        crate::db::oidc_clients::OidcClient,
        // Users
        crate::db::users::UserWithRole,
        // Gaia-X Wizard
        crate::gaia_x::WizardState,
        crate::gaia_x::routes::CertUploadPayload,
        crate::gaia_x::routes::LrnPayload,
        crate::gaia_x::routes::LpPayload,
        crate::gaia_x::routes::TcPayload,
        // Gaia-X Wallet
        crate::gaia_x::wallet_routes::ConnectPayload,
        // Admin
        crate::routes::admin::CreateOrgAndInviteRequest,
        crate::routes::admin::RegisterOidcClientRequest,
        crate::routes::admin::CreateInviteRequest,
        // Organization
        crate::routes::org::UpdateUserRoleRequest,
        crate::routes::org::UpdateOrgIdentityPayload,
        crate::routes::org::CreateOrgInviteRequest,
        // Discovery
        crate::discovery::routes::SearchRequest,
        crate::discovery::routes::ExpandRequest,
        crate::discovery::routes::QueryRequest,
        crate::discovery::routes::ChartRequest,
        crate::discovery::routes::LoadDiscoverResponse,
        // AI / Conversations
        crate::ai::routes::AskRequest,
        crate::ai::routes::AskResponse,
        crate::ai::routes::CreateConversationRequest,
        crate::ai::routes::RenameConversationRequest,
    ))
)]
pub struct ApiDoc;

pub async fn openapi_json() -> axum::response::Response {
    use axum::response::IntoResponse;
    let doc = ApiDoc::openapi();
    axum::Json(doc).into_response()
}
