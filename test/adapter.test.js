import { test } from "node:test";
import assert from "node:assert/strict";
import { KrayinClient } from "../src/client.js";
import { buildTools } from "../src/tools.js";

// Mock fetch capturing requests and simulating Krayin's API.
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", headers: opts.headers, body: opts.body });
    for (const r of routes) {
      if (url.includes(r.match) && (!r.method || r.method === (opts.method || "GET"))) {
        return {
          ok: r.status ? r.status < 400 : true,
          status: r.status || 200,
          json: async () => r.reply,
          text: async () => JSON.stringify(r.reply),
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "{}" };
  };
  fn.calls = calls;
  return fn;
}

const env = { baseUrl: "http://crm.local", email: "matt@test", password: "pw" };

test("logs in with Sanctum and sends Bearer token", async () => {
  const fetchImpl = mockFetch([
    { match: "/api/v1/login", method: "POST", reply: { data: { token: "TOK123" } } },
    { match: "/api/v1/leads?", reply: { data: [{ id: 1, title: "Sample roof" }] } },
    { match: "/api/v1/leads", reply: { data: [{ id: 1, title: "Sample roof" }] } },
  ]);
  const client = new KrayinClient({ ...env, fetchImpl });
  const out = await client.get("leads");
  assert.equal(out.data[0].title, "Sample roof");
  const loginCall = fetchImpl.calls[0];
  assert.ok(loginCall.url.endsWith("/api/v1/login"));
  assert.match(loginCall.body, /device_name/);
  const apiCall = fetchImpl.calls[1];
  assert.equal(apiCall.headers.Authorization, "Bearer TOK123");
});

test("uses KRAYIN_TOKEN directly without login", async () => {
  const fetchImpl = mockFetch([{ match: "/api/v1/contacts/persons/7", reply: { data: { id: 7, name: "Jane Sample" } } }]);
  const client = new KrayinClient({ ...env, token: "PRESET", fetchImpl });
  const out = await client.get("contacts/persons/7");
  assert.equal(out.data.name, "Jane Sample");
  assert.equal(fetchImpl.calls.length, 1); // no login round-trip
  assert.equal(fetchImpl.calls[0].headers.Authorization, "Bearer PRESET");
});

test("re-logins once on 401 then retries", async () => {
  let first = true;
  const fetchImpl = mockFetch([]);
  const inner = fetchImpl;
  const wrapped = async (url, opts) => {
    if (url.includes("/login")) return { ok: true, status: 200, json: async () => ({ token: "FRESH" }), text: async () => "" };
    if (first && !url.includes("/login")) { first = false; return { ok: false, status: 401, json: async () => ({}), text: async () => "{}" }; }
    return { ok: true, status: 200, json: async () => ({ data: "ok" }), text: async () => JSON.stringify({ data: "ok" }) };
  };
  const client = new KrayinClient({ ...env, token: "STALE", fetchImpl: wrapped });
  const out = await client.get("activities");
  assert.equal(out.data, "ok");
  assert.equal(client.token, "FRESH");
});

test("turns a login redirect into a clear credentials error", async () => {
  const fetchImpl = mockFetch([{ match: "/api/v1/login", method: "POST", status: 302, reply: {} }]);
  const client = new KrayinClient({ ...env, fetchImpl });
  await assert.rejects(client.get("leads"), /redirected instead of answered/);
});

test("tools hit the documented Krayin endpoints", async () => {
  const fetchImpl = mockFetch([
    { match: "/api/v1/login", method: "POST", reply: { token: "T" } },
    { match: "contacts/persons/search", reply: { data: [] } },
    { match: "leads/stage/edit/9", method: "PUT", reply: { data: { id: 9 } } },
    { match: "leads/4/tags", method: "POST", reply: { data: {} } },
    { match: "activities", method: "POST", reply: { data: { id: 55 } } },
    { match: "contacts/persons", method: "POST", reply: { data: { id: 10 } } },
  ]);
  const client = new KrayinClient({ ...env, fetchImpl });
  const tools = Object.fromEntries(buildTools(client).map((t) => [t.name, t]));

  await tools.krayin_search_persons.handler({ query: "sample" });
  assert.ok(fetchImpl.calls.some((c) => c.url.includes("/api/v1/contacts/persons/search?query=sample")));

  await tools.krayin_move_lead_stage.handler({ id: 9, lead_pipeline_stage_id: 3 });
  const stageCall = fetchImpl.calls.find((c) => c.url.includes("leads/stage/edit/9"));
  assert.equal(stageCall.method, "PUT");
  assert.match(stageCall.body, /lead_pipeline_stage_id/);

  await tools.krayin_tag_lead.handler({ id: 4, tag: { name: "adjuster-friendly" } });
  assert.ok(fetchImpl.calls.some((c) => c.url.includes("leads/4/tags") && c.method === "POST"));

  await tools.krayin_create_activity.handler({ type: "note", comment: "Talked re-roof timing", lead_id: 4 });
  const actCall = fetchImpl.calls.find((c) => c.url.endsWith("/api/v1/activities") && c.method === "POST");
  assert.match(actCall.body, /Talked re-roof timing/);

  await tools.krayin_create_person.handler({ name: "Pat Example", emails: [{ value: "b@x.com", label: "work" }], extra: { job_title: "Production" } });
  const personCall = fetchImpl.calls.find((c) => c.url.endsWith("/api/v1/contacts/persons") && c.method === "POST");
  assert.match(personCall.body, /Pat Example/);
  assert.match(personCall.body, /Production/);
});

test("raw api escape hatch passes through", async () => {
  const fetchImpl = mockFetch([
    { match: "/api/v1/login", method: "POST", reply: { token: "T" } },
    { match: "settings/pipelines", reply: { data: [{ id: 1, name: "Default" }] } },
  ]);
  const client = new KrayinClient({ ...env, fetchImpl });
  const tools = Object.fromEntries(buildTools(client).map((t) => [t.name, t]));
  const out = await tools.krayin_api.handler({ method: "GET", path: "settings/pipelines" });
  assert.equal(out.data[0].name, "Default");
});
