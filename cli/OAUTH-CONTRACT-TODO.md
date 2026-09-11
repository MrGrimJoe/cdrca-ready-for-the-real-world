# OAuth login contract — CONFIRM WITH REGISTRY TEAM BEFORE SHIPPING

`cdrca login` (see `cli/src/commands/login.rs`) currently assumes the
following contract with `GET /api/auth/github/callback`. This was a
silent assumption before and has NOT been confirmed against what the
registry team actually built — do that before relying on this.

## What the CLI currently sends (opens in the user's browser)

```
GET https://<registry-host>/api/auth/github/callback
    ?redirect_port=<local ephemeral port the CLI is listening on>
    &state=<random UUID generated per login attempt>
```

## What the CLI expects back (redirect to its local listener)

After the user completes GitHub's OAuth consent, the CLI expects the
registry to redirect the browser to:

```
GET http://127.0.0.1:<redirect_port>/callback
    ?token=<the session/API token>
    &state=<the SAME state value the CLI originally sent>
```

The CLI rejects the callback outright if `state` is missing or doesn't
match exactly — this is the fix for the token-injection risk flagged in
review (previously ANY connection to the ephemeral port, not just the
real GitHub redirect, could hand the CLI a token).

## Questions for the registry team — confirm explicitly

1. Does `/api/auth/github/callback` accept `redirect_port` as a query
   param on the INITIAL request (before the user even hits GitHub), or
   does it need to be passed some other way (e.g. as part of the GitHub
   OAuth `redirect_uri` itself)?
2. Does the registry accept and echo back an arbitrary `state` value
   the CLI supplies, or does the registry generate its own state
   internally? If the registry generates its own, the CLI's local state
   check is pointless and needs to be redesigned around whatever the
   registry actually does.
3. Is the final redirect back to the CLI's local listener a `token=`
   query param exactly as assumed here, or a different shape (e.g. a
   JSON body via a POST, a hash fragment, etc.)?
4. Confirm the exact hostname/path — `registry.cdrca.dev` in the code
   is a placeholder pending the real deployed URL.

Until these are confirmed, treat `cdrca login` as unverified against
the real registry, even though it compiles and the local logic
(state generation/verification, token storage) is correct in isolation.
