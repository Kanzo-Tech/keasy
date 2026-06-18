//! keasy control-plane — the workspace provisioner CLI.
//!
//! A small command-line tool, separate from the tenant instances, that owns the
//! Docker socket and a Keycloak admin service account. It wraps the reference
//! [`Provisioner`] reconcile with four subcommands:
//!
//!   provision   --name --handle --owner-email → create (atomic, keyed)
//!   deprovision <id>                           → tear down (idempotent)
//!   reconcile                                  → converge the registry toward the
//!                                                manifest at `CP_DEPLOY_DIR`
//!   list                                       → the live registry, as JSON
//!
//! The durable workspace registry ([`crate::store`]) is the CLI's local state, so
//! provision/deprovision/list/reconcile all see the same map across invocations.

mod config;
mod docker;
mod manifest;
mod provisioner;
mod store;

use std::path::Path;

use clap::{Parser, Subcommand};

use crate::config::ControlPlaneConfig;
use crate::provisioner::Provisioner;

#[derive(Parser)]
#[command(name = "control-plane", about = "keasy workspace provisioner")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Provision a workspace: register its OIDC client + bring up the instance stack.
    Provision {
        /// Display label.
        #[arg(long)]
        name: String,
        /// Unique routing identity (subdomain + Keycloak org alias); slugified.
        #[arg(long)]
        handle: String,
        /// Owner's email. Keycloak invites them to the org; they register-on-accept.
        #[arg(long = "owner-email")]
        owner_email: String,
    },
    /// Tear a workspace down by id (idempotent).
    Deprovision {
        /// Workspace id (`keasy-ws-…`).
        id: String,
    },
    /// Reconcile the live registry against the manifest at `CP_DEPLOY_DIR`.
    Reconcile,
    /// List the live workspaces (durable registry snapshot).
    List,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "control_plane=info,warn".into()),
        )
        .init();

    let cli = Cli::parse();

    let config = match ControlPlaneConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("FATAL: {e}");
            std::process::exit(1);
        }
    };

    let stacks_dir = std::env::var("CP_STACKS_DIR").unwrap_or_else(|_| "/var/lib/keasy/stacks".into());
    let db_path = std::env::var("CP_DB_PATH").unwrap_or_else(|_| "/var/lib/keasy/control-plane.db".into());
    let provisioner = match Provisioner::new(config, stacks_dir, db_path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("FATAL: failed to init provisioner: {e}");
            std::process::exit(1);
        }
    };

    match cli.command {
        Command::Provision { name, handle, owner_email } => {
            match provisioner.provision(&name, &handle, &owner_email).await {
                Ok(info) => println!("{}", serde_json::to_string_pretty(&info).unwrap()),
                Err(e) => {
                    eprintln!("provision failed: {e}");
                    std::process::exit(1);
                }
            }
        }
        Command::Deprovision { id } => match provisioner.deprovision(&id).await {
            Ok(()) => println!("deprovisioned {id}"),
            Err(e) => {
                eprintln!("deprovision failed: {e}");
                std::process::exit(1);
            }
        },
        Command::Reconcile => {
            let dir = match std::env::var("CP_DEPLOY_DIR") {
                Ok(d) => d,
                Err(_) => {
                    eprintln!("FATAL: CP_DEPLOY_DIR not set");
                    std::process::exit(1);
                }
            };
            let desired = match manifest::load_environment(Path::new(&dir)) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("reconcile failed: load manifest: {e}");
                    std::process::exit(1);
                }
            };
            match provisioner.reconcile(&desired).await {
                Ok(summary) => println!("{}", serde_json::to_string_pretty(&summary).unwrap()),
                Err(e) => {
                    eprintln!("reconcile failed: {e}");
                    std::process::exit(1);
                }
            }
        }
        Command::List => match provisioner.list() {
            Ok(workspaces) => println!("{}", serde_json::to_string_pretty(&workspaces).unwrap()),
            Err(e) => {
                eprintln!("list failed: {e}");
                std::process::exit(1);
            }
        },
    }
}
