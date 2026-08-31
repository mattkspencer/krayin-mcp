# krayin-mcp

MCP server that lets AI agents (Claude) operate a Krayin CRM directly: search and create people, manage leads and pipeline stages, log notes and follow-ups, tag records, and hit any other REST endpoint through an escape hatch. Built for Matt's personal book-of-business CRM (see SPEC_PERSONAL_CRM.md in master-plans). All rights reserved - this is a proprietary Fieldbuilt component, not open source.

## Requirements

- Node 20+
- A running Krayin 2.x instance with the `krayin/rest-api` package installed
  (`composer require krayin/rest-api`, set `SANCTUM_STATEFUL_DOMAINS="${APP_URL}"`, `php artisan krayin-rest-api:install`)

## Config (env)

- `KRAYIN_URL` - base URL of the Krayin instance, e.g. `http://localhost:8000`
- `KRAYIN_EMAIL` + `KRAYIN_PASSWORD` - API user credentials (Sanctum login), or
- `KRAYIN_TOKEN` - a pre-issued Sanctum token (skips login)

## Install & test

```bash
npm install
npm test
```

## Register with Claude Code

```bash
claude mcp add krayin -e KRAYIN_URL=http://localhost:8000 -e KRAYIN_EMAIL=you@example.com -e KRAYIN_PASSWORD=secret -- node C:/dev/repos/krayin-mcp/src/server.js
```

Or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "krayin": {
      "command": "node",
      "args": ["C:/dev/repos/krayin-mcp/src/server.js"],
      "env": { "KRAYIN_URL": "http://localhost:8000", "KRAYIN_EMAIL": "you@example.com", "KRAYIN_PASSWORD": "secret" }
    }
  }
}
```

## Tools

- `krayin_search_persons`, `krayin_get_person`, `krayin_create_person`, `krayin_update_person`
- `krayin_list_organizations`, `krayin_create_organization`
- `krayin_search_leads`, `krayin_list_leads`, `krayin_get_lead`, `krayin_create_lead`, `krayin_update_lead`, `krayin_move_lead_stage`
- `krayin_create_activity`, `krayin_list_activities`, `krayin_lead_activities`, `krayin_person_activities`
- `krayin_tag_lead`, `krayin_tag_person`
- `krayin_api` - raw `GET/POST/PUT/DELETE` against any `/api/v1/...` path

## Status

- Unit-tested against mocked Krayin API responses (auth flow, 401 re-login, endpoint paths from the krayin/rest-api V1 route files).
- Live end-to-end test pending a running Krayin instance (blocked on Docker Desktop install; see SPEC_PERSONAL_CRM.md build step 1).
- Field payload shapes (person emails/contact_numbers, lead pipeline ids, activity schedule fields) follow Krayin docs but should be confirmed against the live Swagger at `/api/admin/documentation` on first run; the `extra`/`fields` passthroughs mean no code change is needed for extra attributes.
