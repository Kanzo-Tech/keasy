// @generated automatically by Diesel CLI.
// Primary keys manually corrected from Nullable<Text> to Text (SQLite TEXT PRIMARY KEY quirk).

diesel::table! {
    connectors (id) {
        id -> Text,
        organization_id -> Text,
        name -> Text,
        connector_type -> Text,
        direction -> Text,
        config -> Text,
        created_at -> Text,
        updated_at -> Text,
    }
}

diesel::table! {
    dataspaces (id) {
        id -> Text,
        client_id -> Text,
        name -> Text,
        url -> Text,
        description -> Nullable<Text>,
        logo -> Nullable<Text>,
        created_at -> Text,
        updated_at -> Text,
    }
}

diesel::table! {
    invite_tokens (token) {
        token -> Text,
        org_id -> Text,
        role -> Text,
        created_by -> Text,
        expires_at -> Text,
        created_at -> Text,
    }
}

diesel::table! {
    jobs (id) {
        id -> Text,
        organization_id -> Text,
        name -> Nullable<Text>,
        status -> Text,
        mode -> Text,
        created_at -> Text,
        started_at -> Nullable<Text>,
        completed_at -> Nullable<Text>,
        error -> Nullable<Text>,
        pipeline -> Text,
        connector_ids -> Text,
        script -> Nullable<Text>,
        rdf_base -> Nullable<Text>,
        manifest -> Nullable<Text>,
    }
}

diesel::table! {
    org_gaiax (org_id) {
        org_id -> Text,
        domain -> Nullable<Text>,
        public_key_jwk -> Nullable<Text>,
        cert_chain_pem -> Nullable<Text>,
        root_ca_pem -> Nullable<Text>,
        lrn_type -> Nullable<Text>,
        lrn_value -> Nullable<Text>,
        lrn_vc -> Nullable<Text>,
        lp_vc -> Nullable<Text>,
        tandc_vc -> Nullable<Text>,
        compliance_vc -> Nullable<Text>,
        wizard_step -> Integer,
        updated_at -> Text,
    }
}

diesel::table! {
    org_members (user_id, org_id) {
        user_id -> Text,
        org_id -> Text,
        role -> Text,
        email -> Text,
        first_name -> Text,
        last_name -> Text,
        joined_at -> Text,
    }
}

diesel::table! {
    organizations (id) {
        id -> Text,
        name -> Text,
        slug -> Text,
        legal_name -> Text,
        registration_number -> Nullable<Text>,
        country_subdivision_code -> Nullable<Text>,
        registration_number_type -> Nullable<Text>,
        country -> Text,
        role -> Text,
        created_at -> Text,
        updated_at -> Text,
    }
}

diesel::table! {
    secrets (key) {
        key -> Text,
        value -> Binary,
    }
}

diesel::table! {
    settings (key) {
        key -> Text,
        value -> Text,
    }
}

diesel::table! {
    user_sessions (user_id) {
        user_id -> Text,
        session_id -> Text,
        created_at -> Text,
    }
}

diesel::table! {
    tower_sessions (id) {
        id -> Text,
        data -> Binary,
        expiry_date -> BigInt,
    }
}

diesel::joinable!(connectors -> organizations (organization_id));
diesel::joinable!(invite_tokens -> organizations (org_id));
diesel::joinable!(jobs -> organizations (organization_id));
diesel::joinable!(org_gaiax -> organizations (org_id));
diesel::joinable!(org_members -> organizations (org_id));

diesel::allow_tables_to_appear_in_same_query!(
    connectors,
    dataspaces,
    invite_tokens,
    jobs,
    org_gaiax,
    org_members,
    organizations,
    secrets,
    settings,
    user_sessions,
);
