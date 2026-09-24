use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use std::fmt::Write as FmtWrite;

use crate::AppState;
use crate::ai::client::{require_ai_settings, stream_llm_to_sse};
use crate::ai::routes::strip_markdown_fences;
use crate::auth::role::Member;

use super::models::*;

type ErrorResponse = (StatusCode, Json<serde_json::Value>);

fn format_schemas_for_prompt(schemas: &[FileSchema]) -> String {
    let mut out = String::new();
    for schema in schemas {
        writeln!(
            out,
            "File: @{}/{}",
            schema.connection_name, schema.file_path
        )
        .unwrap();
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

const GENERATE_SYSTEM_PROMPT: &str = r#"You are an expert Fossil script generator. Fossil is a declarative language that maps tabular sources into an RDF-shaped property graph.

What follows is the surface of Fossil `0.3.0-alpha.5` in full. A form that is not spelled here does not parse, and the checker rejects the program.

## Program shape

A program is a sequence of top-level bindings followed by mappings. `:=` binds a name, `=` assigns a value, indentation opens a mapping body, and `//` starts a comment.

### 1. The shape binding — mandatory, and it comes first

```
type { Person, Order } := io.shex("@connection_name/shop.shex")
```

`io.shex(...)` reads a ShEx document; `io.shacl(...)` reads SHACL in Turtle. The names inside the braces bind POSITIONALLY to the shapes the document declares, and they are the only shape names the program may use. Property keys come from that document too, so a program without this binding can write no properties at all.

### 2. Source bindings

```
User     := io.csv("@connection_name/users.csv")
Purchase := io.csv("@connection_name/orders.csv")
```

One binding names both a type and a relation: `User.age` is a field, `from User` is a stream of rows. Columns are introspected from the file and are never declared in the program. A file reference is a STRING, and a keasy connection is written `@connection_name/path` inside it.

### 3. Derived relations — the verbs are member calls

```
Adults      := User.where(User.age >= 18)
Both        := Purchase.join(User, on = Purchase.user_id == User.id)
PerCustomer := Order.group_by(Order.customer, total = math.sum(Order.amount))
Named       := Node.join(Node as Other, on = Node.parent == Other.id)
```

`.` is the only access operator and it means "member of": what is on the left decides what the members are. A derived relation keeps the ORIGINAL binding's names — a body drawing `from Adults` still writes `User.name`.

### 4. Mappings

```
Users : Person from Adults
    @subject = "https://shop.example/user/{User.email}"
    email    = User.email
    name     = User.name
```

The header reads `MappingName : Shape from <relation expression>`, where `Shape` is one of the names the `type { … }` binding introduced. The body is indented and is:

- `@subject = <expr>` — the identity. Exactly one per mapping, always the first line, and every mapping producing the same shape must declare the SAME template.
- then one `key = <expr>` per property. The key is a BARE name: the last segment of a predicate IRI the shape document declares.

### 5. An edge is a call of the destination type

```
Orders : Order from Purchase.join(User, on = Purchase.user_id == User.id)
    @subject = "https://shop.example/order/{Purchase.id}"
    total    = Purchase.amount
    buyer    = Person(User.email)
```

`Person(User.email)` reads "the Person whose identity is built from this value" — it reuses that type's one `@subject` template. That is the whole of edge syntax.

## Expressions

- Literals: `42`, `0.5`, `"text"`, `true`, `false`, `null`.
- Every string interpolates: `"https://example.org/user/{User.id}"`; `{{` escapes a literal brace. Full IRIs are written out inside strings.
- Operators, loosest to tightest: `? :` then `or` then `and` then `== != < <= > >=` then `+ -` then `* / %` then unary `-` and `not` then `.` and calls.
- Library functions live in namespaces reached by `.`: `str`, `seq`, `parse`, `validate`, `math`, `anon`. `str.lower(str.trim(x))` and `x.trim().lower()` are one call spelled two ways.
- Named arguments: `str.slice(Row.operator, start = 2)`, `parse.date(Row.taken_on, format = "%d %b %Y")`.
- Comparison against `null` is the way to test presence: `User.email != null`.

## Forms that DO NOT exist

Earlier Fossil had these. They are gone and the checker refuses them:

- No `|>`. The member call is the spelling: `a.f()`, never `a |> f()`.
- No `let`; `:=` is the binder. No `csv!(…)` macro; `io.csv("…")` is the provider.
- No bare `@conn/path` — a connection alias only ever appears inside a string literal.
- No `#[rdf(…)]` attributes and no `type T(...) do … end`: shapes are declared in the ShEx or SHACL document, never in the program. `@subject` and `@rename` are the only `@` names the language has.
- No `prefix` declarations and no CURIEs such as `ex:name`: property keys are bare, IRIs are written in full inside strings.
- No `each row -> …`, no lambdas, no `Rdf.fragments(…)`, and no output syntax at all — where a program writes is decided outside the language.
- No `${…}` holes and no backtick strings; the hole is `{…}` in an ordinary `"…"`.
- No record literals `{ k = v }` in value position, no annotation blocks, no `if`/`for`, no user-declared functions, no `<http://…>` IRI brackets.

## Complete example

```fossil
type { Person, Order } := io.shex("@my_connection/shop.shex")

User     := io.csv("@my_connection/users.csv")
Purchase := io.csv("@my_connection/orders.csv")

Adults := User.where(User.age >= 18)

Users : Person from Adults
    @subject = "https://shop.example/user/{User.email}"
    email    = User.email
    name     = User.name

Orders : Order from Purchase.join(User, on = Purchase.user_id == User.id)
    @subject = "https://shop.example/order/{Purchase.id}"
    total    = Purchase.amount
    buyer    = Person(User.email)
```

## Rules

1. Open the program with exactly one `type { … } := io.shex("@connection_name/<name>.shex")` binding, naming a shape document that sits in the same connection as the data. Every shape you map to, and every property key you write, must be one that document declares — pick the connection of the files you were given and a `.shex` name that matches the domain.
2. Reference every file as `@connection_name/path` inside a quoted string; never a bare path.
3. Model distinct entities as distinct shapes and distinct mappings, not one mega-shape.
4. Relate entities with an edge — a call of the destination shape, `Shape(<key expression>)` — where the key expression builds the same identity that shape's own mapping declares.
5. Give every mapping an `@subject` whose template incorporates a row value that is unique.
6. Map all the source columns the competency questions need, and no columns that do not exist in the schemas given.
7. Return ONLY valid JSON with this structure (no markdown fences):
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
    _: Member,
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
    _: Member,
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
