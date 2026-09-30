mod auth;
mod cdrca_bundle;
mod commands;
mod fulltranspiler_patch;
mod js_block_semicolon_patch;
mod library_stage;
mod lockfile;
mod manifest;
mod mrmib;
mod npm;
mod package_stage;
mod parser_spacing_patch;
mod patch;
mod plugin_frontend_patch;
mod plugin_stage;
mod project_layout;
mod project_server;
mod project_state;
mod quark_libscan;
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
    /// Package the current project (or a named installed plugin/library/
    /// package) into a distributable .mrmib archive
    Pack {
        /// Output path (default: <name>-<version>.mrmib in the project root)
        #[arg(long)]
        out: Option<String>,
    },
    /// Export a plugin/library/package to .mrmib. With no name, exports
    /// everything this project has (its own package plus every staged
    /// plugin/library/package) automatically, into ./exports/
    Export {
        /// Name of the specific plugin/library/package to export. Omit to
        /// export everything.
        name: Option<String>,
        /// Output path: a directory for "everything", or the exact file
        /// path when a name is given (default: <name>-<version>.mrmib in
        /// the project root)
        #[arg(long)]
        out: Option<String>,
    },
    /// Compile a custom grammar-plugin workspace (see PLUGIN-DEVELOPMENT
    /// docs) into a shippable grammar package, or scaffold a new workspace
    Compile {
        #[command(subcommand)]
        what: CompileTarget,
    },
}

#[derive(Subcommand)]
enum CompileTarget {
    /// Validate and package everything added in a grammar workspace
    /// (default location: ./grammar-workspace) into dist/<name>.grammar.json
    Custom {
        /// Workspace directory (default: ./grammar-workspace)
        #[arg(long)]
        workspace: Option<String>,
        /// Scaffold a fresh workspace for a new plugin instead of compiling
        #[arg(long)]
        init: Option<String>,
    },
}

#[derive(Subcommand)]
enum CreateTarget {
    /// Scaffold a full CDRCA app project
    App { name: String },
    /// Scaffold a new transpiler plugin package
    Plugin {
        name: String,
        /// Also scaffold a stub opt-in library bundle under this name
        /// (e.g. --library icons scaffolds <name>-icons.js and a matching
        /// `libraries` manifest entry) — see docs/PLUGIN-LIBRARIES.md.
        #[arg(long)]
        library: Option<String>,
    },
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
        Command::Info { package } => {
            if package.ends_with(".mrmib") {
                commands::pack::inspect(std::path::Path::new(&package))?
            } else {
                commands::misc::info(&package).await?
            }
        }
        Command::Install { spec } => commands::install::run(&spec, &cwd).await?,
        Command::Update { package } => commands::misc::update(&cwd, package.as_deref()).await?,
        Command::Remove { package } => commands::misc::remove(&cwd, &package)?,
        Command::List { json } => commands::misc::list(json)?,
        Command::Outdated { json } => commands::misc::outdated(&cwd, json).await?,
        Command::Publish => commands::publish::run(&cwd).await?,
        Command::Create { what } => match what {
            CreateTarget::App { name } => commands::create::run(&name)?,
            CreateTarget::Plugin { name, library } => {
                commands::create::run_plugin(&name, library.as_deref())?
            }
        },
        Command::Build { what } => match what {
            BuildTarget::App => commands::build::run(&cwd)?,
        },
        Command::Run => commands::run::run(&cwd)?,
        Command::Doctor => commands::doctor::run(&cwd).await?,
        Command::Pack { out } => commands::pack::run(&cwd, out.as_deref())?,
        Command::Export { name, out } => match name {
            Some(n) => commands::export::run_named(&cwd, &n, out.as_deref())?,
            None => commands::export::run_all(&cwd, out.as_deref())?,
        },
        Command::Compile { what } => match what {
            CompileTarget::Custom { workspace, init } => match init {
                Some(plugin_name) => {
                    commands::compile::init(&cwd, &plugin_name, workspace.as_deref())?
                }
                None => commands::compile::run(&cwd, workspace.as_deref())?,
            },
        },
    }

    Ok(())
}
