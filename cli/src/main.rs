mod auth;
mod commands;
mod lockfile;
mod manifest;
mod npm;
mod patch;
mod project_state;
mod quark_patch;
mod registry;
mod resolve;
mod store;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "cdrca", version, about = "CLI, package manager, and build tool for CDRCA")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Log in via GitHub OAuth (stores token in Windows Credential Manager)
    Login,
    /// Log out and clear the stored token
    Logout,
    /// Search the registry
    Search { query: String },
    /// Show package details (permissions/uses prominently shown for plugins)
    Info { package: String },
    /// Install a package: cdrca install <name>[@version]
    Install { spec: String },
    /// Update one package, or all installed packages if none given
    Update { package: Option<String> },
    /// Remove an installed package
    Remove { package: String },
    /// List installed packages
    List {
        /// Print machine-readable JSON instead of plain text
        #[arg(long)]
        json: bool,
    },
    /// Show installed vs. latest available versions
    Outdated {
        /// Print machine-readable JSON instead of plain text
        #[arg(long)]
        json: bool,
    },
    /// Validate cdrca.json and publish a new release
    Publish,
    /// Scaffold a new project
    Create {
        #[command(subcommand)]
        what: CreateTarget,
    },
    /// Build the current project into a distributable .exe (apps only)
    Build {
        #[command(subcommand)]
        what: BuildTarget,
    },
    /// Launch the current project's CDRCA server on an OS-assigned port
    Run,
    /// Diagnose your local CDRCA environment: toolchain, login, registry
    /// reachability, local package store health, and VS Code setup
    Doctor,
}

#[derive(Subcommand)]
enum CreateTarget {
    /// Scaffold a full CDRCA app project
    App { name: String },
}

#[derive(Subcommand)]
enum BuildTarget {
    /// Package the current project into a distributable Windows .exe via Tauri
    App,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let cwd = std::env::current_dir()?;

    match cli.command {
        Command::Login => commands::login::run()?,
        Command::Logout => commands::login::logout()?,
        Command::Search { query } => commands::misc::search(&query).await?,
        Command::Info { package } => commands::misc::info(&package).await?,
        Command::Install { spec } => commands::install::run(&spec, &cwd).await?,
        Command::Update { package } => commands::misc::update(&cwd, package.as_deref()).await?,
        Command::Remove { package } => commands::misc::remove(&cwd, &package)?,
        Command::List { json } => commands::misc::list(json)?,
        Command::Outdated { json } => commands::misc::outdated(&cwd, json).await?,
        Command::Publish => commands::publish::run(&cwd).await?,
        Command::Create { what } => match what {
            CreateTarget::App { name } => commands::create::run(&name)?,
        },
        Command::Build { what } => match what {
            BuildTarget::App => commands::build::run(&cwd)?,
        },
        Command::Run => commands::run::run(&cwd)?,
        Command::Doctor => commands::doctor::run(&cwd).await?,
    }

    Ok(())
}
