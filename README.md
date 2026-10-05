# krayin-mcp

An MCP server that lets Claude operate a [Krayin](https://krayincrm.com) CRM directly: search and create people, manage leads and pipeline stages, log notes and follow-ups, tag records, and reach any other REST endpoint through an escape hatch.

I built it to run my own book-of-business CRM from Claude Code. I self-host Krayin in Docker, and this server is the only way Claude touches it.

## What was hard

- **Hidden auth errors.** With `APP_DEBUG=false`, Krayin answers bad credentials with a 302 redirect to its admin login page instead of a 401. The client sends every request with `redirect: "manual"` and turns that redirect into a clear "check KRAYIN_EMAIL/KRAYIN_PASSWORD" error instead of a confusing HTML response.
- **Token expiry.** A 401 mid-session triggers one re-login and a retry, so a long Claude session does not die when the Sanctum token expires.
- **Three upstream bugs in `krayin/rest-api`.** Creating a contact with no phone number returns a 500, a contact with a null emails column crashes the lead view, and a partial lead update without the pipeline stage returns a 500. The tools work around all three: they always send the arrays (empty when blank), and `krayin_update_lead` carries the lead's current stage forward unless the caller is moving it. Phone-only contacts are normal in roofing, so this is the common path, not an edge case.

## Tools (20)

- People: `krayin_search_persons`, `krayin_get_person`, `krayin_create_person`, `krayin_update_person`
- Organizations: `krayin_list_organizations`, `krayin_create_organization`
- Leads: `krayin_search_leads`, `krayin_list_leads`, `krayin_get_lead`, `krayin_create_lead`, `krayin_update_lead`, `krayin_move_lead_stage`, `krayin_list_pipelines`
- Activities: `krayin_create_activity`, `krayin_list_activities`, `krayin_lead_activities`, `krayin_person_activities`
- Tags: `krayin_tag_lead`, `krayin_tag_person`
- Escape hatch: `krayin_api`, raw `GET/POST/PUT/DELETE` against any `/api/v1/...` path

## Requirements

- Node 20+
- A Krayin 2.x instance with the `krayin/rest-api` package installed
  (`composer require krayin/rest-api`, set `SANCTUM_STATEFUL_DOMAINS="${APP_URL}"`, `php artisan krayin-rest-api:install`)

## Config (env)

- `KRAYIN_URL`: base URL of the Krayin instance, e.g. `http://localhost:8000`
- `KRAYIN_EMAIL` + `KRAYIN_PASSWORD`: API user credentials (Sanctum login), or
- `KRAYIN_TOKEN`: a pre-issued Sanctum token (skips login)

## Install and test

```bash
npm install
npm test                 # unit tests against a mocked Krayin API
node test/live-smoke.js  # end-to-end against a running instance (env vars above)
```

The unit tests cover the login flow, 401 re-login, the redirect-as-auth-error case, and the endpoint paths taken from the rest-api V1 route files. The smoke test creates a person, a lead and an activity on a live instance and reads them back.

## Register with Claude Code

```bash
claude mcp add krayin -e KRAYIN_URL=http://localhost:8000 -e KRAYIN_TOKEN=<token> -- node /path/to/krayin-mcp/src/server.js
```

Or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "krayin": {
      "command": "node",
      "args": ["/path/to/krayin-mcp/src/server.js"],
      "env": { "KRAYIN_URL": "http://localhost:8000", "KRAYIN_TOKEN": "<token>" }
    }
  }
}
```

## Status

Live-tested against a self-hosted Krayin 2.x instance and in daily use. Lead defaults (source "Not Recorded", type "Insurance Claim") match my pipeline; change them in `src/tools.js` for yours.
