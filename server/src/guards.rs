//! The failure guards, as tests over this crate's own source (fossil docs/design/failure, "The
//! guards"). Each holds a rule nobody should have to remember, says why, and says what it cannot
//! prove.

use std::path::{Path, PathBuf};

fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// `let _ = … .await` drops a failure on the floor. It is allowed only with a comment on the line
/// or one of the two above it saying why losing it is correct — a reader that left, a cleanup
/// whose own failure is not the one being reported.
///
/// Cannot prove: that the reason given is true; a failure dropped another way (`.ok();`).
#[test]
fn no_awaited_result_is_dropped_without_a_reason() {
    let mut files = Vec::new();
    sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let mut offenders = Vec::new();
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if !line.trim_start().starts_with("let _ =") {
                continue;
            }
            // The statement runs until its `;`; only one that awaits is in question.
            let statement: String = lines[i..]
                .iter()
                .take_while(|l| !l.contains(';'))
                .chain(lines[i..].iter().find(|l| l.contains(';')))
                .copied()
                .collect();
            if !statement.contains(".await") {
                continue;
            }
            let reasoned = line.contains("//")
                || lines[i.saturating_sub(2)..i]
                    .iter()
                    .any(|l| l.trim_start().starts_with("//"));
            if !reasoned {
                offenders.push(format!("{}:{}", file.display(), i + 1));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "awaited results dropped without a reason: {offenders:#?}"
    );
}
