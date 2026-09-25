use secrecy::SecretString;
use std::collections::HashMap;

pub struct CloudAccount {
    pub name: String,
    pub provider_id: String,
    pub auth_method: Option<String>,
    pub fields: HashMap<String, String>,
    pub secrets: HashMap<String, SecretString>,
}
