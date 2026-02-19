use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
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
}

fn is_false(v: &bool) -> bool {
    !v
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthMethodSchema {
    pub name: &'static str,
    pub label: &'static str,
    pub fields: &'static [FieldSchema],
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderSchema {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub common_fields: &'static [FieldSchema],
    pub auth_methods: &'static [AuthMethodSchema],
}

impl ProviderSchema {
    /// Returns common fields + the fields for the given auth method (if any).
    pub fn active_fields(&self, auth_method: Option<&str>) -> Vec<&FieldSchema> {
        let mut fields: Vec<&FieldSchema> = self.common_fields.iter().collect();
        if let Some(method) = auth_method {
            if let Some(am) = self.auth_methods.iter().find(|a| a.name == method) {
                fields.extend(am.fields.iter());
            }
        }
        fields
    }
}

pub static PROVIDER_REGISTRY: &[ProviderSchema] = &[
    ProviderSchema {
        id: "azure",
        label: "Azure Blob Storage",
        icon: "azure",
        common_fields: &[FieldSchema {
            name: "account_name",
            label: "Account Name",
            secret: false,
            optional: false,
            default_value: None,
            env_var: Some("AZURE_STORAGE_ACCOUNT_NAME"),
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
                    },
                    FieldSchema {
                        name: "client_secret",
                        label: "Client Secret",
                        secret: true,
                        optional: false,
                        default_value: None,
                        env_var: Some("AZURE_STORAGE_CLIENT_SECRET"),
                    },
                    FieldSchema {
                        name: "tenant_id",
                        label: "Tenant ID",
                        secret: false,
                        optional: false,
                        default_value: None,
                        env_var: Some("AZURE_STORAGE_TENANT_ID"),
                    },
                ],
            },
        ],
    },
    ProviderSchema {
        id: "gcp",
        label: "Google Cloud Storage",
        icon: "gcp",
        common_fields: &[],
        auth_methods: &[
            AuthMethodSchema {
                name: "service_account_key",
                label: "JSON Key",
                fields: &[FieldSchema {
                    name: "service_account_key",
                    label: "Service Account Key (JSON)",
                    secret: true,
                    optional: false,
                    default_value: None,
                    env_var: Some("GOOGLE_SERVICE_ACCOUNT_KEY"),
                }],
            },
            AuthMethodSchema {
                name: "service_account_file",
                label: "Key File Path",
                fields: &[FieldSchema {
                    name: "service_account",
                    label: "Service Account File Path",
                    secret: false,
                    optional: false,
                    default_value: None,
                    env_var: Some("GOOGLE_SERVICE_ACCOUNT"),
                }],
            },
        ],
    },
    ProviderSchema {
        id: "s3",
        label: "Amazon S3",
        icon: "s3",
        common_fields: &[
            FieldSchema {
                name: "access_key_id",
                label: "Access Key ID",
                secret: true,
                optional: false,
                default_value: None,
                env_var: Some("AWS_ACCESS_KEY_ID"),
            },
            FieldSchema {
                name: "secret_access_key",
                label: "Secret Access Key",
                secret: true,
                optional: false,
                default_value: None,
                env_var: Some("AWS_SECRET_ACCESS_KEY"),
            },
            FieldSchema {
                name: "region",
                label: "Region",
                secret: false,
                optional: false,
                default_value: Some("us-east-1"),
                env_var: Some("AWS_DEFAULT_REGION"),
            },
            FieldSchema {
                name: "endpoint_url",
                label: "Endpoint URL",
                secret: false,
                optional: true,
                default_value: None,
                env_var: Some("AWS_ENDPOINT_URL"),
            },
        ],
        auth_methods: &[],
    },
];

pub fn find_provider(id: &str) -> Option<&'static ProviderSchema> {
    PROVIDER_REGISTRY.iter().find(|p| p.id == id)
}
