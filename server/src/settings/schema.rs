use serde::Serialize;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct FieldSchema {
    pub name: &'static str,
    pub label: &'static str,
    pub secret: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub optional: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_var: Option<&'static str>,
    /// object_store config key this field projects to (for cloud URL signing —
    /// the HOST concern keasy keeps). Backend-only; not serialized to the UI.
    #[serde(skip)]
    pub store_config_key: Option<&'static str>,
}

fn is_false(v: &bool) -> bool {
    !v
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct AuthMethodSchema {
    pub name: &'static str,
    pub label: &'static str,
    pub fields: &'static [FieldSchema],
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ProviderSchema {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    #[serde(skip)]
    pub schemes: &'static [&'static str],
    pub common_fields: &'static [FieldSchema],
    pub auth_methods: &'static [AuthMethodSchema],
}

impl ProviderSchema {
    pub fn active_fields(&self, auth_method: Option<&str>) -> Vec<&FieldSchema> {
        let mut fields: Vec<&FieldSchema> = self.common_fields.iter().collect();
        if let Some(method) = auth_method
            && let Some(am) = self.auth_methods.iter().find(|a| a.name == method)
        {
            fields.extend(am.fields.iter());
        }
        fields
    }

    pub fn all_fields(&self) -> Vec<&FieldSchema> {
        let mut fields: Vec<&FieldSchema> = self.common_fields.iter().collect();
        for am in self.auth_methods {
            fields.extend(am.fields.iter());
        }
        fields
    }
}

pub static PROVIDER_REGISTRY: &[ProviderSchema] = &[
    ProviderSchema {
        id: "azure",
        label: "Azure Blob Storage",
        icon: "azure",
        schemes: &["az", "azure", "abfss", "abfs", "adl"],
        common_fields: &[FieldSchema {
            name: "account_name",
            label: "Account Name",
            secret: false,
            optional: false,
            default_value: None,
            env_var: Some("AZURE_STORAGE_ACCOUNT_NAME"),
            store_config_key: Some("account_name"),
        }],
        auth_methods: &[
            AuthMethodSchema {
                name: "account_key",
                label: "Account Key",
                fields: &[FieldSchema {
                    name: "account_key",
                    label: "Account Key",
                    secret: true,
                    optional: false,
                    default_value: None,
                    env_var: Some("AZURE_STORAGE_ACCOUNT_KEY"),
                    store_config_key: Some("access_key"),
                }],
            },
            AuthMethodSchema {
                name: "sas_token",
                label: "SAS Token",
                fields: &[FieldSchema {
                    name: "sas_token",
                    label: "SAS Token",
                    secret: true,
                    optional: false,
                    default_value: None,
                    env_var: Some("AZURE_STORAGE_SAS_KEY"),
                    store_config_key: Some("sas_key"),
                }],
            },
            AuthMethodSchema {
                name: "service_principal",
                label: "Service Principal",
                fields: &[
                    FieldSchema {
                        name: "client_id",
                        label: "Client ID",
                        secret: false,
                        optional: false,
                        default_value: None,
                        env_var: Some("AZURE_STORAGE_CLIENT_ID"),
                        store_config_key: Some("client_id"),
                    },
                    FieldSchema {
                        name: "client_secret",
                        label: "Client Secret",
                        secret: true,
                        optional: false,
                        default_value: None,
                        env_var: Some("AZURE_STORAGE_CLIENT_SECRET"),
                        store_config_key: Some("client_secret"),
                    },
                    FieldSchema {
                        name: "tenant_id",
                        label: "Tenant ID",
                        secret: false,
                        optional: false,
                        default_value: None,
                        env_var: Some("AZURE_STORAGE_TENANT_ID"),
                        store_config_key: Some("tenant_id"),
                    },
                ],
            },
        ],
    },
    ProviderSchema {
        id: "s3",
        label: "Amazon S3",
        icon: "s3",
        schemes: &["s3", "s3a"],
        common_fields: &[
            FieldSchema {
                name: "access_key_id",
                label: "Access Key ID",
                secret: true,
                optional: false,
                default_value: None,
                env_var: Some("AWS_ACCESS_KEY_ID"),
                store_config_key: Some("access_key_id"),
            },
            FieldSchema {
                name: "secret_access_key",
                label: "Secret Access Key",
                secret: true,
                optional: false,
                default_value: None,
                env_var: Some("AWS_SECRET_ACCESS_KEY"),
                store_config_key: Some("secret_access_key"),
            },
            FieldSchema {
                name: "region",
                label: "Region",
                secret: false,
                optional: false,
                default_value: Some("us-east-1"),
                env_var: Some("AWS_DEFAULT_REGION"),
                store_config_key: Some("region"),
            },
            FieldSchema {
                name: "endpoint_url",
                label: "Endpoint URL",
                secret: false,
                optional: true,
                default_value: None,
                env_var: Some("AWS_ENDPOINT_URL"),
                store_config_key: Some("endpoint"),
            },
        ],
        auth_methods: &[],
    },
];

pub fn find_provider(id: &str) -> Option<&'static ProviderSchema> {
    PROVIDER_REGISTRY.iter().find(|p| p.id == id)
}

pub fn all_cloud_schemes() -> impl Iterator<Item = &'static str> {
    PROVIDER_REGISTRY
        .iter()
        .flat_map(|p| p.schemes.iter().copied())
}

pub fn find_provider_by_scheme(scheme: &str) -> Option<&'static ProviderSchema> {
    PROVIDER_REGISTRY
        .iter()
        .find(|p| p.schemes.contains(&scheme))
}
