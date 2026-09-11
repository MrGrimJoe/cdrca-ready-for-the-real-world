use anyhow::{bail, Context, Result};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use uuid::Uuid;

/// `cdrca login` — opens the browser to the registry's GitHub OAuth entry
/// point with a redirect back to a local ephemeral port, then reads the
/// token off that callback and stores it via Windows Credential Manager.
///
/// Uses a random `state` value to protect against token injection: without
/// this, ANY connection to the ephemeral port (not just the real GitHub
/// OAuth redirect for this specific login attempt) could hand the CLI an
/// attacker-supplied token. The state is generated before the browser opens,
/// sent as part of the auth URL, and checked for an EXACT match on the
/// callback before a token is ever accepted or stored.
///
/// NOTE — registry interop not yet confirmed: this assumes the registry's
/// GET /api/auth/github/callback accepts `redirect_port` AND `state` in the
/// initial request, and that its redirect back to the local listener
/// includes BOTH `token` and the same `state` value. This has not been
/// confirmed against what the registry team actually implements — coordinate
/// exact param names/shape with them before relying on this in production.
/// If the registry's actual contract differs, update `auth_url` and the
/// query-parsing below to match.
pub fn run() -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").context("binding local callback listener")?;
    let port = listener.local_addr()?.port();
    let state = Uuid::new_v4().to_string();

    let auth_url = format!(
        "https://registry.cdrca.dev/api/auth/github/callback?redirect_port={port}&state={state}"
    );
    println!("Opening browser to log in via GitHub...");
    println!("If it doesn't open automatically, visit:\n  {auth_url}\n");
    let _ = open_browser(&auth_url);

    println!("Waiting for login to complete...");
    let (mut stream, _) = listener.accept().context("waiting for OAuth callback")?;
    let mut reader = BufReader::new(&stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;

    // Expect: GET /callback?token=XYZ&state=ABC HTTP/1.1
    let path = request_line
        .split_whitespace()
        .nth(1)
        .context("malformed callback request line")?;

    let query = path.splitn(2, '?').nth(1).unwrap_or("");
    let params = parse_query(query);

    let received_state = params.get("state").cloned();
    if received_state.as_deref() != Some(state.as_str()) {
        // Respond with an error page before bailing so the browser tab
        // doesn't hang, then refuse to accept/store anything.
        respond(&mut stream, "Login failed: state mismatch. Please try again.");
        bail!(
            "OAuth state mismatch (expected '{state}', got {:?}) — refusing to accept token; \
             this callback was not verified as the response to this login attempt",
            received_state
        );
    }

    let token = params
        .get("token")
        .cloned()
        .context("callback did not include a token — login failed")?;

    respond(&mut stream, "Logged in to CDRCA. You can close this tab.");

    crate::auth::store_token(&token).context("storing login token")?;
    println!("Logged in successfully.");
    Ok(())
}

fn respond(stream: &mut std::net::TcpStream, message: &str) {
    let body = format!("<html><body>{message}</body></html>");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?;
            let value = parts.next().unwrap_or("");
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

pub fn logout() -> Result<()> {
    crate::auth::clear_token()?;
    println!("Logged out.");
    Ok(())
}

fn open_browser(url: &str) -> Result<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn()?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn().ok();
    }
    Ok(())
}
