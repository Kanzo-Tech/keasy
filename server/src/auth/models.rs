use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub invite_token: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}
