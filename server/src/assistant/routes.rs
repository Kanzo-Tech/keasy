use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use secrecy::ExposeSecret;
use std::fmt::Write as FmtWrite;

use crate::ai::client::ask_llm;
use crate::ai::routes::strip_markdown_fences;
use crate::error::data_response;
use crate::middleware::tenant::{IsParticipant, Require};
use crate::AppState;

use super::models::*;

type ErrorResponse = (StatusCode, Json<serde_json::Value>);

fn ai_error(e: impl std::fmt::Display) -> ErrorResponse {
    (
        StatusCode::BAD_REQUEST,
        Json(crate::error::error_body("ai_failed", &e.to_string())),
    )
}

fn load_ai_settings(
    ai_settings: Option<crate::settings::ai::AiSettings>,
) -> Result<crate::settings::ai::AiSettings, ErrorResponse> {
    match ai_settings {
        Some(s) if !s.api_key.expose_secret().is_empty() => Ok(s),
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(crate::error::error_body(
                "ai_not_configured",
                "AI settings are not configured. Go to Settings > AI to add an API key.",
            )),
        )),
    }
}

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

### Two invocation modes

1. **Data mode** — loads rows from a file:
```
let data = csv!(@connection_name/file.csv)
```

2. **Schema mode** — extracts types only (no data loaded):
```
type Input = csv!(@connection_name/file.csv)
type { Person, Department } = shex!(@connection_name/shapes.shex)
```

### shex!() provider

`shex!()` is a **schema-only** provider. It reads ShEx shapes and auto-generates Fossil types with `#[rdf(...)]` and `#[validate(...)]` attributes. It can ONLY be used with `type`, never with `let`.

Destructured names (`{ Person, Department }`) must match the number and order of shapes in the .shex file.

### Mapping rows to instances
```
data
|> each row -> Person("http://example.com/person/${row.id}") {
    name = row.name,
    age = row.age
}
|> Rdf.serialize(@connection_name/output/people.nq)
```
- `each row -> ...` iterates over every row
- Constructor call: `TypeName("subject_iri") { field = value, ... }`
- Constructor args come from the CSV data rows, not from ShEx
- `Rdf.serialize(...)` writes the RDF graph

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
// Types from ShEx shapes (schema only — auto-generates #[rdf(...)] and #[validate(...)])
type { Person, Department } = shex!(@my_connection/shapes.shex)

// Data from CSV
let people = csv!(@my_connection/people.csv)

// Map rows to typed instances
people
|> each row -> Person("http://example.com/person/${row.id}") {
    name = row.name,
    department = row.dept_id
}
|> Rdf.serialize(@my_connection/output/people.nq)
```

## ShEx Compact Syntax (ShExC)

You must also generate the ShEx shapes file content. Use ShExC compact syntax:

```
PREFIX ex: <http://example.com/ontology/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

ex:PersonShape {
  a [ex:Person] ;
  rdfs:label xsd:string ;
  ex:name xsd:string ;
  ex:age xsd:integer ?
}
```

### ShEx rules
- Every shape MUST include `rdfs:label xsd:string` — always
- Include proper PREFIX declarations
- Mark optional fields with `?`, repeatable with `*` or `+`
- Use `xsd:string`, `xsd:integer`, `xsd:decimal`, `xsd:boolean` for literals
- Use shape references (e.g., `@ex:DepartmentShape`) for object properties

## Rules
1. Use `@connection_name/file_path` syntax for all file references (no quotes, never bare paths)
2. Always use `shex!()` for types — never write manual `#[rdf(...)]` attributes
3. Always use `let` with `csv!()` for data loading, `type` with `shex!()` for schema
4. Choose meaningful ontology URIs based on the domain
5. Create separate types for distinct entities (not one mega-type)
6. Use string interpolation for subject IRIs that incorporate row data
7. Map ALL relevant columns from the source files
8. The script should answer the provided competency questions
9. The .shex file is saved as `shapes.shex` on the first selected connection
10. Return ONLY valid JSON with this structure (no markdown fences):
{
  "script": "...the Fossil script using shex!() for types...",
  "shex": "...the ShExC shapes content..."
}
The ShEx shapes must define types that the script references via shex!()."#;

#[utoipa::path(post, path = "/v1/assistant/suggest", tag = "Assistant",
    request_body = SuggestRequest,
    responses(
        (status = 200, description = "Suggested competency questions", body = SuggestResponse),
        (status = 400, description = "AI provider not configured"),
    )
)]
pub async fn suggest_cqs(
    _ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(req): Json<SuggestRequest>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let ai_settings = load_ai_settings(state.db.list_ai_providers().await.into_iter().next())?;

    let mut user_msg = format!("Domain: {}\n\n", req.domain);
    user_msg.push_str(&format_schemas_for_prompt(&req.schemas));

    let response = ask_llm(&ai_settings, CQ_SYSTEM_PROMPT, &user_msg)
        .await
        .map_err(ai_error)?;

    let json_str = strip_markdown_fences(&response);

    let parsed: SuggestResponse = serde_json::from_str(json_str).map_err(|e| {
        tracing::warn!(raw = %response, "Failed to parse CQ response: {e}");
        (
            StatusCode::BAD_REQUEST,
            Json(crate::error::error_body(
                "ai_parse_failed",
                &format!("Failed to parse AI response: {e}"),
            )),
        )
    })?;

    Ok(data_response(parsed))
}

#[utoipa::path(post, path = "/v1/assistant/generate", tag = "Assistant",
    request_body = GenerateRequest,
    responses(
        (status = 200, description = "Generated Fossil script", body = GenerateResponse),
        (status = 400, description = "AI provider not configured"),
    )
)]
pub async fn generate_script(
    _ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(req): Json<GenerateRequest>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let ai_settings = load_ai_settings(state.db.list_ai_providers().await.into_iter().next())?;

    let mut user_msg = format!("Domain: {}\n\n", req.domain);

    user_msg.push_str("Competency Questions:\n");
    for (i, cq) in req.competency_questions.iter().enumerate() {
        writeln!(user_msg, "{}. {}", i + 1, cq).unwrap();
    }
    user_msg.push('\n');

    user_msg.push_str("Data Schemas:\n");
    user_msg.push_str(&format_schemas_for_prompt(&req.schemas));

    let response = ask_llm(&ai_settings, GENERATE_SYSTEM_PROMPT, &user_msg)
        .await
        .map_err(ai_error)?;

    let json_str = strip_markdown_fences(&response);

    let parsed: GenerateResponse = serde_json::from_str(json_str).unwrap_or_else(|_| {
        // Fallback: treat the whole response as a script (backwards compat with models that ignore JSON instruction)
        let script = json_str
            .strip_prefix("```fossil")
            .or_else(|| json_str.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .unwrap_or(json_str)
            .trim()
            .to_string();
        GenerateResponse {
            script,
            shex: String::new(),
        }
    });

    Ok(data_response(parsed))
}
