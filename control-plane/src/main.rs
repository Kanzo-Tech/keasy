//! keasy control-plane — the workspace provisioner CLI.
//!
//! A small command-line tool, separate from the tenant instances, that owns the
//! Docker socket and a Keycloak admin service account. It wraps the reference
//! [`Provisioner`] reconcile with four subcommands:
//!
//!   provision   --name --handle --owner-email → create (atomic, idempotent)
//!   deprovision <slug>                         → tear down (idempotent)
//!   reconcile                                  → re-ensure every tenant's stack at
//!                                                its pinned image (drift + rollout)
//!   list                                       → the live tenants, as JSON
//!
//! There is no local state: the Keycloak Organizations are the source of truth, so
//! provision/deprovision/list/reconcile all read the same fleet across invocations.

mod config;
mod docker;
mod provisioner;

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
    /// Tear a workspace down by slug (idempotent). Accepts the bare slug or the
    /// full `keasy-ws-{slug}` id.
    Deprovision {
        /// Workspace slug (org alias) or `keasy-ws-{slug}` id.
        slug: String,
    },
    /// Re-ensure every tenant's stack at its pinned image (heals drift + rolls out
    /// version bumps). The Keycloak Organizations are the desired set.
    Reconcile,
    /// List the live workspaces (projected from the Keycloak Organizations).
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

    // Rendered stack files are transient — `docker stack deploy` reads them only at
    // deploy time — so this can be an ephemeral path inside the container.
    let stacks_dir = std::env::var("CP_STACKS_DIR").unwrap_or_else(|_| "/tmp/keasy-stacks".into());
    let provisioner = match Provisioner::new(config, stacks_dir) {
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
        Command::Deprovision { slug } => match provisioner.deprovision(&slug).await {
            Ok(()) => println!("deprovisioned {slug}"),
            Err(e) => {
                eprintln!("deprovision failed: {e}");
                std::process::exit(1);
            }
        },
        Command::Reconcile => match provisioner.reconcile().await {
            Ok(summary) => println!("{}", serde_json::to_string_pretty(&summary).unwrap()),
            Err(e) => {
                eprintln!("reconcile failed: {e}");
                std::process::exit(1);
            }
        },
        Command::List => match provisioner.list().await {
            Ok(workspaces) => println!("{}", serde_json::to_string_pretty(&workspaces).unwrap()),
            Err(e) => {
                eprintln!("list failed: {e}");
                std::process::exit(1);
            }
        },
    }
}
