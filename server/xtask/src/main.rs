//! keasy-server's automation. One command:
//!
//! `cargo xtask problems [--check]` writes `src/problems.rs` from `problems.bnf`, the server's own
//! registry, in the grammar of `@kanzo-tech/kernel`'s `problems.bnf` — read from the package as npm
//! ships it (`api/node_modules`, after `pnpm install`). The two share one `base`, and no code is in
//! both. `--check` writes nothing and fails when the file is not what it would write.

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::{env, fs, io::Write};

const KERNEL: &str = "../api/node_modules/@kanzo-tech/kernel/problems.bnf";
const OWN: &str = "problems.bnf";
const OUT: &str = "src/problems.rs";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let check = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["problems"] => false,
        ["problems", "--check"] => true,
        _ => {
            eprintln!("usage: cargo xtask problems [--check]");
            return ExitCode::FAILURE;
        }
    };
    match problems(check) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("xtask problems: {e}");
            ExitCode::FAILURE
        }
    }
}

/// The server's directory: this crate's parent.
fn server() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask lives in the server's directory")
        .to_path_buf()
}

fn read(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn problems(check: bool) -> Result<(), String> {
    let root = server();
    let kernel = parse(&read(&root.join(KERNEL)).map_err(|e| {
        format!("{e} (the kernel's registry is read from npm: `pnpm install` first)")
    })?)
    .map_err(|e| format!("{KERNEL}: {e}"))?;
    let own = parse(&read(&root.join(OWN))?).map_err(|e| format!("{OWN}: {e}"))?;
    if own.base != kernel.base {
        return Err(format!(
            "{OWN}: base {:?} is not the kernel's {:?}",
            own.base, kernel.base
        ));
    }
    for row in &own.rows {
        if kernel.rows.iter().any(|k| k.code == row.code) {
            return Err(format!(
                "{OWN}: {} is the kernel's code; a code means one thing",
                row.code
            ));
        }
    }
    let generated = rustfmt(&emit(&own))?;
    let out = root.join(OUT);
    if check {
        if read(&out).ok().as_deref() != Some(generated.as_str()) {
            return Err(format!(
                "{OUT} is not what {OWN} generates: run `cargo xtask problems`"
            ));
        }
    } else {
        fs::write(&out, generated).map_err(|e| format!("{}: {e}", out.display()))?;
    }
    Ok(())
}

/// One file of the grammar: its base and its rows.
struct Registry {
    base: String,
    rows: Vec<Row>,
}

struct Row {
    code: String,
    status: Option<u16>,
    title: String,
    /// The comment directly above the row, if any.
    doc: Option<String>,
}

/// Parse a file of the kernel's grammar (its header states it). A row is one line; a comment directly
/// above a row is kept as its doc.
fn parse(text: &str) -> Result<Registry, String> {
    let mut base = None;
    let mut rows = Vec::new();
    let mut doc: Option<String> = None;
    let mut rest = text;
    while let Some(start) = rest.find(|c: char| !c.is_whitespace()) {
        rest = &rest[start..];
        if let Some(inner) = rest.strip_prefix("(*") {
            let end = inner.find("*)").ok_or("a comment is not closed")?;
            let lines: Vec<&str> = inner[..end].lines().map(str::trim).collect();
            doc = Some(lines.join(" ").trim().to_string());
            rest = &inner[end + 2..];
            continue;
        }
        let end = rest.find('\n').unwrap_or(rest.len());
        let line = rest[..end].trim();
        rest = &rest[end..];
        let statement = line
            .strip_suffix('.')
            .ok_or_else(|| format!("{line:?} does not end with '.'"))?
            .trim();
        if let Some(value) = statement.strip_prefix("base ") {
            base = Some(string(value.trim())?);
        } else if let Some(row) = statement.strip_prefix("row ") {
            rows.push(parse_row(row, doc.take())?);
        } else {
            return Err(format!("{line:?} is neither a base nor a row"));
        }
        doc = None;
    }
    Ok(Registry {
        base: base.ok_or("no base")?,
        rows,
    })
}

fn parse_row(row: &str, doc: Option<String>) -> Result<Row, String> {
    let (code, rest) = row
        .split_once('=')
        .ok_or_else(|| format!("{row:?} has no '='"))?;
    let code = code.trim();
    if !is_code(code) {
        return Err(format!("{code:?} is not an area/kind code"));
    }
    let parts: Vec<&str> = rest.splitn(3, ';').map(str::trim).collect();
    let [status, title, data] = parts[..] else {
        return Err(format!("{code}: a row is `status ; title ; data`"));
    };
    let status = match status {
        "-" => None,
        s => match s.parse::<u16>() {
            Ok(n) if (400..=599).contains(&n) => Some(n),
            _ => return Err(format!("{code}: status {s:?} is not 400 to 599, nor '-'")),
        },
    };
    if data != "-" {
        for field in data.split(',') {
            let (name, kind) = field
                .split_once(':')
                .ok_or_else(|| format!("{code}: field {field:?} has no type"))?;
            let name = name.trim().trim_end_matches('?');
            if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphabetic()) {
                return Err(format!("{code}: {name:?} is not a field name"));
            }
            if !matches!(kind.trim(), "number" | "string") {
                return Err(format!("{code}: {name} is a number or a string"));
            }
        }
    }
    Ok(Row {
        code: code.to_string(),
        status,
        title: string(title)?,
        doc,
    })
}

fn string(s: &str) -> Result<String, String> {
    s.strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .filter(|s| !s.contains('"'))
        .map(str::to_string)
        .ok_or_else(|| format!("{s:?} is not a string"))
}

/// `area/kind`, each word `lower { lower | digit } { "-" ( lower | digit ) { lower | digit } }`.
fn is_code(code: &str) -> bool {
    let word = |w: &str| {
        w.starts_with(|c: char| c.is_ascii_lowercase())
            && w.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            })
    };
    matches!(code.split_once('/'), Some((area, kind)) if word(area) && word(kind))
}

/// `area/kind-x` is `AreaKindX`.
fn variant(code: &str) -> String {
    code.split(['/', '-'])
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
                .unwrap_or_default()
        })
        .collect()
}

fn emit(registry: &Registry) -> String {
    let mut out = String::from(
        "// @generated by `cargo xtask problems` from problems.bnf, in the grammar of\n\
         // @kanzo-tech/kernel's problems.bnf. Do not edit: edit problems.bnf.\n\n\
         //! The codes the server answers with, their titles and statuses.\n\n\
         use serde::{Deserialize, Serialize};\n\
         use utoipa::ToSchema;\n\n\
         /// A problem's `type` is this base followed by its code (RFC 9457 §3.1.1).\n",
    );
    out += &format!("pub const TYPE_BASE: &str = {:?};\n\n", registry.base);
    out += "/// Every code the server answers with. Closed: a code `problems.bnf` does not\n\
            /// declare cannot be sent. Each variant is its wire name spelled in Rust,\n\
            /// `area/kind-x` as `AreaKindX`.\n\
            #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]\n\
            pub enum ServerCode {\n";
    for row in &registry.rows {
        if let Some(doc) = &row.doc {
            out += &format!("/// {doc}\n");
        }
        out += &format!(
            "#[serde(rename = {:?})]\n{},\n",
            row.code,
            variant(&row.code)
        );
    }
    out += "}\n\nimpl ServerCode {\n\
            /// The code as the wire spells it.\n\
            pub const fn as_str(self) -> &'static str {\nmatch self {\n";
    for row in &registry.rows {
        out += &format!("Self::{} => {:?},\n", variant(&row.code), row.code);
    }
    out += "}\n}\n\n\
            /// What the code means, fixed per code (RFC 9457 §3.1.3): what this\n\
            /// occurrence is about goes in `detail`.\n\
            pub const fn title(self) -> &'static str {\nmatch self {\n";
    for row in &registry.rows {
        out += &format!("Self::{} => {:?},\n", variant(&row.code), row.title);
    }
    out += "}\n}\n\n\
            /// The HTTP status the code is answered with; `None` for a code that is\n\
            /// stored and never answered.\n\
            pub const fn status(self) -> Option<u16> {\nmatch self {\n";
    for row in &registry.rows {
        let status = row
            .status
            .map_or("None".to_string(), |s| format!("Some({s})"));
        out += &format!("Self::{} => {status},\n", variant(&row.code));
    }
    out += "}\n}\n}\n";
    out
}

/// The generated text as `cargo fmt` leaves it, so `--check` and the fmt gate agree.
fn rustfmt(source: &str) -> Result<String, String> {
    let mut child = Command::new("rustfmt")
        .args(["--edition", "2024", "--emit", "stdout"])
        .current_dir(server())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("rustfmt: {e}"))?;
    child
        .stdin
        .take()
        .expect("piped")
        .write_all(source.as_bytes())
        .map_err(|e| format!("rustfmt: {e}"))?;
    let output = child
        .wait_with_output()
        .map_err(|e| format!("rustfmt: {e}"))?;
    if !output.status.success() {
        return Err(format!("rustfmt refused the generated source:\n{source}"));
    }
    String::from_utf8(output.stdout).map_err(|e| format!("rustfmt: {e}"))
}
