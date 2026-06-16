// server/src/catalog/secret.rs — object_store creds → DuckDB SECRET.
//
// keasy holds the sink credentials as an object_store-style config map (env-var
// keyed: `AWS_ACCESS_KEY_ID`, `AZURE_STORAGE_ACCOUNT_NAME`, …; see
// `cloud::build_storage_config`, keys mirror `settings::schema`). To register a
// job's remote Parquet by reference, the catalog's DuckDB connection must read
// those files' footers over `httpfs`/`azure`, which means translating that map
// into a scoped DuckDB `CREATE SECRET`. This is the single translation point —
// the same creds that sign the output GETs configure the catalog's reads.
//
// The translation is driven by the dataset's URL SCHEME (the provider keasy
// already chose), not by guessing from the map: `s3`/`s3a` → S3 secret,
// `az`/`azure`/`abfss`/`abfs`/`adl` → Azure secret, `gs`/`gcs` → GCS secret.

use std::collections::HashMap;

/// What the catalog must do about credentials before it can read a dataset.
pub(crate) enum SecretPlan {
    /// Local (`file://` or a bare path) — httpfs needs no secret.
    None,
    /// Run this `CREATE SECRET` to authorise reads of the dataset's prefix.
    Sql(String),
    /// Remote, but the creds keasy holds can't be expressed as a DuckDB secret
    /// (e.g. GCS service-account JSON — DuckDB's GCS path wants HMAC keys). The
    /// caller treats this as a registration miss (logged; the reconciler retries
    /// only if creds change).
    Unsupported,
}

/// Plan the secret for a dataset rooted at `base` (a scheme URL like
/// `az://container/prefix`), scoping it to that prefix so it only authorises this
/// job's reads. `name` is a caller-controlled safe identifier (`job_<id>`).
pub(crate) fn plan(name: &str, base: &str, config: &HashMap<String, String>) -> SecretPlan {
    let Some(scheme) = base.split("://").next().filter(|s| *s != base) else {
        return SecretPlan::None; // no `://` → local path
    };
    match scheme {
        "file" => SecretPlan::None,
        "s3" | "s3a" => opt(s3(name, base, config)),
        "az" | "azure" | "abfss" | "abfs" | "adl" => opt(azure(name, base, config)),
        "gs" | "gcs" => opt(gcs(name, base, config)),
        _ => SecretPlan::None, // unknown scheme: let the read attempt speak for itself
    }
}

fn opt(sql: Option<String>) -> SecretPlan {
    sql.map_or(SecretPlan::Unsupported, SecretPlan::Sql)
}

/// S3 / S3-compatible (MinIO, R2). Keys mirror `settings::schema` S3 `env_var`s.
fn s3(name: &str, scope: &str, config: &HashMap<String, String>) -> Option<String> {
    let key_id = config.get("AWS_ACCESS_KEY_ID")?;
    let secret = config.get("AWS_SECRET_ACCESS_KEY")?;

    let mut p = vec![("TYPE", "s3".to_string()), ("KEY_ID", q(key_id)), ("SECRET", q(secret))];
    if let Some(region) = config.get("AWS_DEFAULT_REGION") {
        p.push(("REGION", q(region)));
    }
    if let Some(endpoint) = config.get("AWS_ENDPOINT_URL") {
        // A custom endpoint (MinIO, R2, …) means non-AWS S3: strip the scheme
        // (DuckDB wants host[:port]), force path-style addressing, and match TLS
        // to the endpoint scheme.
        let use_ssl = !endpoint.starts_with("http://");
        let host = endpoint.trim_start_matches("https://").trim_start_matches("http://");
        p.push(("ENDPOINT", q(host)));
        p.push(("URL_STYLE", q("path")));
        p.push(("USE_SSL", use_ssl.to_string()));
    }
    p.push(("SCOPE", q(scope)));
    Some(stmt(name, &p))
}

/// Azure Blob. DuckDB's azure secret takes a connection string (account-key /
/// SAS) or a service-principal triple. keasy's three Azure auth methods map 1:1.
fn azure(name: &str, scope: &str, config: &HashMap<String, String>) -> Option<String> {
    let account = config.get("AZURE_STORAGE_ACCOUNT_NAME")?;

    let mut p = vec![("TYPE", "azure".to_string())];
    if let Some(key) = config.get("AZURE_STORAGE_ACCOUNT_KEY") {
        let conn = format!(
            "DefaultEndpointsProtocol=https;AccountName={account};AccountKey={key};EndpointSuffix=core.windows.net"
        );
        p.push(("CONNECTION_STRING", q(&conn)));
    } else if let Some(sas) = config.get("AZURE_STORAGE_SAS_KEY") {
        let conn = format!(
            "BlobEndpoint=https://{account}.blob.core.windows.net;SharedAccessSignature={}",
            sas.trim_start_matches('?'),
        );
        p.push(("CONNECTION_STRING", q(&conn)));
    } else if let (Some(tenant), Some(client), Some(secret)) = (
        config.get("AZURE_STORAGE_TENANT_ID"),
        config.get("AZURE_STORAGE_CLIENT_ID"),
        config.get("AZURE_STORAGE_CLIENT_SECRET"),
    ) {
        p.push(("PROVIDER", "service_principal".to_string()));
        p.push(("TENANT_ID", q(tenant)));
        p.push(("CLIENT_ID", q(client)));
        p.push(("CLIENT_SECRET", q(secret)));
        p.push(("ACCOUNT_NAME", q(account)));
    } else {
        return None; // account name but no usable auth material
    }
    p.push(("SCOPE", q(scope)));
    Some(stmt(name, &p))
}

/// Google Cloud Storage. DuckDB reads GCS through an S3-compatible secret keyed
/// by HMAC (`TYPE gcs`). keasy's GCS provider stores a service-account JSON, NOT
/// HMAC keys — DuckDB can't use that for reads — so unless HMAC keys are present
/// this is `None` → `Unsupported`.
fn gcs(name: &str, scope: &str, config: &HashMap<String, String>) -> Option<String> {
    let key_id = config.get("GCS_KEY_ID").or_else(|| config.get("AWS_ACCESS_KEY_ID"))?;
    let secret = config.get("GCS_SECRET").or_else(|| config.get("AWS_SECRET_ACCESS_KEY"))?;
    let p = vec![
        ("TYPE", "gcs".to_string()),
        ("KEY_ID", q(key_id)),
        ("SECRET", q(secret)),
        ("SCOPE", q(scope)),
    ];
    Some(stmt(name, &p))
}

fn stmt(name: &str, params: &[(&str, String)]) -> String {
    let body = params.iter().map(|(k, v)| format!("{k} {v}")).collect::<Vec<_>>().join(", ");
    format!("CREATE OR REPLACE SECRET \"{name}\" ({body});")
}

/// Single-quote a SQL string literal (double interior quotes).
fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn sql(base: &str, pairs: &[(&str, &str)]) -> Option<String> {
        match plan("job_x", base, &map(pairs)) {
            SecretPlan::Sql(s) => Some(s),
            _ => None,
        }
    }

    #[test]
    fn local_paths_need_no_secret() {
        assert!(matches!(plan("j", "/tmp/x", &HashMap::new()), SecretPlan::None));
        assert!(matches!(plan("j", "file:///tmp/x", &HashMap::new()), SecretPlan::None));
    }

    #[test]
    fn s3_has_key_region_scope_no_endpoint() {
        let s = sql("s3://bucket/abc", &[
            ("AWS_ACCESS_KEY_ID", "AKIA"),
            ("AWS_SECRET_ACCESS_KEY", "shh"),
            ("AWS_DEFAULT_REGION", "eu-west-1"),
        ]).expect("S3 creds present");
        assert!(s.contains("TYPE s3") && s.contains("KEY_ID 'AKIA'") && s.contains("SECRET 'shh'"));
        assert!(s.contains("REGION 'eu-west-1'") && s.contains("SCOPE 's3://bucket/abc'"));
        assert!(!s.contains("ENDPOINT"), "AWS-native → no path-style");
    }

    #[test]
    fn s3_custom_endpoint_forces_path_style_and_matches_tls() {
        let https = sql("s3://b", &[
            ("AWS_ACCESS_KEY_ID", "k"), ("AWS_SECRET_ACCESS_KEY", "s"),
            ("AWS_ENDPOINT_URL", "https://minio.example.com:9000"),
        ]).unwrap();
        assert!(https.contains("ENDPOINT 'minio.example.com:9000'") && https.contains("URL_STYLE 'path'"));
        assert!(https.contains("USE_SSL true"));
        let http = sql("s3://b", &[
            ("AWS_ACCESS_KEY_ID", "k"), ("AWS_SECRET_ACCESS_KEY", "s"),
            ("AWS_ENDPOINT_URL", "http://localhost:9000"),
        ]).unwrap();
        assert!(http.contains("USE_SSL false"));
    }

    #[test]
    fn azure_account_key_builds_connection_string() {
        let s = sql("az://c/prefix", &[
            ("AZURE_STORAGE_ACCOUNT_NAME", "acc"),
            ("AZURE_STORAGE_ACCOUNT_KEY", "a2V5"),
        ]).expect("azure account-key");
        assert!(s.contains("TYPE azure"));
        assert!(s.contains("AccountName=acc") && s.contains("AccountKey=a2V5"));
        assert!(s.contains("SCOPE 'az://c/prefix'"));
    }

    #[test]
    fn azure_sas_strips_leading_question_mark() {
        let s = sql("abfss://c", &[
            ("AZURE_STORAGE_ACCOUNT_NAME", "acc"),
            ("AZURE_STORAGE_SAS_KEY", "?sv=x&sig=y"),
        ]).unwrap();
        assert!(s.contains("SharedAccessSignature=sv=x&sig=y"), "leading ? stripped");
        assert!(s.contains("BlobEndpoint=https://acc.blob.core.windows.net"));
    }

    #[test]
    fn azure_service_principal_maps_triple() {
        let s = sql("azure://c", &[
            ("AZURE_STORAGE_ACCOUNT_NAME", "acc"),
            ("AZURE_STORAGE_TENANT_ID", "t"),
            ("AZURE_STORAGE_CLIENT_ID", "ci"),
            ("AZURE_STORAGE_CLIENT_SECRET", "cs"),
        ]).unwrap();
        assert!(s.contains("PROVIDER service_principal"));
        assert!(s.contains("TENANT_ID 't'") && s.contains("CLIENT_ID 'ci'") && s.contains("CLIENT_SECRET 'cs'"));
        assert!(s.contains("ACCOUNT_NAME 'acc'"));
    }

    #[test]
    fn gcs_service_account_json_is_unsupported() {
        // keasy's GCS provider stores JSON, not HMAC — DuckDB can't read with it.
        assert!(matches!(
            plan("j", "gs://b", &map(&[("GOOGLE_SERVICE_ACCOUNT_KEY", "{...}")])),
            SecretPlan::Unsupported,
        ));
    }

    #[test]
    fn remote_with_no_creds_is_unsupported() {
        assert!(matches!(plan("j", "s3://b", &HashMap::new()), SecretPlan::Unsupported));
        assert!(matches!(plan("j", "az://c", &HashMap::new()), SecretPlan::Unsupported));
    }

    #[test]
    fn value_with_quote_is_escaped() {
        let s = sql("s3://b", &[("AWS_ACCESS_KEY_ID", "a'b"), ("AWS_SECRET_ACCESS_KEY", "s")]).unwrap();
        assert!(s.contains("KEY_ID 'a''b'"));
    }
}
