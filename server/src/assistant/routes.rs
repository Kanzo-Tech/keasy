use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use std::fmt::Write as FmtWrite;

use crate::ai::client::{require_ai_settings, stream_llm_to_sse};
use crate::ai::routes::strip_markdown_fences;
use crate::middleware::tenant::{IsMember, Require};
use crate::AppState;

use super::models::*;

type ErrorResponse = (StatusCode, Json<serde_json::Value>);

fn format_schemas_for_prompt(schemas: &[FileSchema]) -> String {
    let mut out = String::new();
    for schema in schemas {
        writeln!(out, "File: @{}/{}", schema.connection_name, schema.file_path).unwrap();
        writeln!(out, "Columns:").unwrap();
        for col in &schema.columns {
            writeln!(out, "  - {} ({})", col.name, col.data_type).unwrap();
        }
        writeln!(out).unwrap();
    }
    out
}

const CQ_SYSTEM_PROMPT: &str = r#"You are an expert in knowledge graph ontology design and competency questions.

Given a domain description and file schemas (column names and types from CSV files), suggest 5-10 competency questions (CQs) that a knowledge graph built from this data should be able to answer.

Competency questions define the scope of the ontology. They should:
- Be answerable from the provided data columns
- Cover different aspects of the domain
- Range from simple lookups to cross-entity relationships
- Use natural language (not technical jargon)

Return ONLY valid JSON (no markdown fences) with this structure:
{
  "competency_questions": [
    {
      "id": "cq1",
      "question": "What is the full name and email of each person?",
      "rationale": "Maps basic person attributes from the people.csv columns"
    }
  ]
}"#;

const GENERATE_SYSTEM_PROMPT: &str = r#"You are an expert Fossil script generator. Fossil is a domain-specific language for building RDF knowledge graphs from tabular data.

## Fossil Provider System

Fossil uses **providers** (macros) to load data and extract schemas. Providers reference files via `@connection_name/path` (no quotes around the path).

### Data mode — loads rows from a file:
```
let data = csv!(@connection_name/file.csv)
```

### Schema mode — extracts types from file headers:
```
type Input = csv!(@connection_name/file.csv)
```

### Inline type definitions with RDF attributes
Define types manually with `#[rdf(...)]` attributes for ontology mapping:
```
#[rdf(type = "http://example.com/ontology/Person")]
type Person(subject: string) do
    #[rdf(uri = "http://xmlns.com/foaf/0.1/name")]
    Name: string
    #[rdf(uri = "http://example.com/ontology/age")]
    Age: int?
end
```

### Mapping rows to instances
```
data
|> each row -> Person("http://example.com/person/${row.id}") {
    Name = row.name,
    Age = row.age
}
|> Rdf.fragments(@connection_name/output/people)
```
- `each row -> ...` iterates over every row
- Constructor call: `TypeName("subject_iri") { field = value, ... }`
- `Rdf.fragments(...)` writes RDF fragments to cloud storage

### Pipe operator
```
expression |> function
```
Chains operations. `x |> f` is equivalent to `f(x)`.

### String interpolation
```
"http://example.com/${row.field_name}"
```

## Complete example

```fossil
// Define ontology types inline
#[rdf(type = "http://example.com/ontology/Person")]
type Person(subject: string) do
    #[rdf(uri = "http://xmlns.com/foaf/0.1/name")]
    Name: string
    #[rdf(uri = "http://example.com/ontology/department")]
    Department: string?
end

// Load data from CSV
let people = csv!(@my_connection/people.csv)

// Map rows to typed instances
people
|> each row -> Person("http://example.com/person/${row.id}") {
    Name = row.name,
    Department = row.dept_id
}
|> Rdf.fragments(@my_connection/output/people)
```

## Rules
1. Use `@connection_name/file_path` syntax for all file references (no quotes, never bare paths)
2. Define types inline with `#[rdf(...)]` attributes for ontology mapping
3. Always use `let` with `csv!()` for data loading
4. Choose meaningful ontology URIs based on the domain
5. Create separate types for distinct entities (not one mega-type)
6. Use string interpolation for subject IRIs that incorporate row data
7. Map ALL relevant columns from the source files
8. The script should answer the provided competency questions
9. Return ONLY valid JSON with this structure (no markdown fences):
{
  "script": "...the Fossil script..."
}"#;

#[utoipa::path(post, path = "/v1/assistant/suggest-stream", tag = "Assistant",
    request_body = SuggestRequest,
    responses(
        (status = 200, description = "SSE stream: delta events + complete with SuggestResponse"),
        (status = 400, description = "AI provider not configured"),
    )
)]
pub async fn suggest_cqs_stream(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Json(req): Json<SuggestRequest>,
) -> Result<Response, ErrorResponse> {
    let ai_settings = require_ai_settings(state.db.list_ai_providers().await.into_iter().next())?;

    let mut user_msg = format!("Domain: {}\n\n", req.domain);
    user_msg.push_str(&format_schemas_for_prompt(&req.schemas));

    Ok(stream_llm_to_sse(
        ai_settings,
        CQ_SYSTEM_PROMPT.to_string(),
        user_msg,
        None,
        |full_text| {
            let json_str = strip_markdown_fences(full_text);
            match serde_json::from_str::<SuggestResponse>(json_str) {
                Ok(parsed) => serde_json::to_value(parsed).unwrap_or_default(),
                Err(e) => {
                    tracing::warn!(raw = %full_text, "Failed to parse CQ response: {e}");
                    serde_json::json!({ "competency_questions": [] })
                }
            }
        },
    ))
}

#[utoipa::path(post, path = "/v1/assistant/generate-stream", tag = "Assistant",
    request_body = GenerateRequest,
    responses(
        (status = 200, description = "SSE stream: delta events + complete with GenerateResponse"),
        (status = 400, description = "AI provider not configured"),
    )
)]
pub async fn generate_script_stream(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Json(req): Json<GenerateRequest>,
) -> Result<Response, ErrorResponse> {
    let ai_settings = require_ai_settings(state.db.list_ai_providers().await.into_iter().next())?;

    let mut user_msg = format!("Domain: {}\n\n", req.domain);

    user_msg.push_str("Competency Questions:\n");
    for (i, cq) in req.competency_questions.iter().enumerate() {
        writeln!(user_msg, "{}. {}", i + 1, cq).unwrap();
    }
    user_msg.push('\n');

    user_msg.push_str("Data Schemas:\n");
    user_msg.push_str(&format_schemas_for_prompt(&req.schemas));

    Ok(stream_llm_to_sse(
        ai_settings,
        GENERATE_SYSTEM_PROMPT.to_string(),
        user_msg,
        None,
        |full_text| {
            let json_str = strip_markdown_fences(full_text);
            match serde_json::from_str::<GenerateResponse>(json_str) {
                Ok(parsed) => serde_json::to_value(parsed).unwrap_or_default(),
                Err(_) => {
                    // Fallback: treat the response as raw script
                    let script = json_str
                        .strip_prefix("```fossil")
                        .or_else(|| json_str.strip_prefix("```"))
                        .and_then(|s| s.strip_suffix("```"))
                        .unwrap_or(json_str)
                        .trim();
                    serde_json::json!({ "script": script })
                }
            }
        },
    ))
}
