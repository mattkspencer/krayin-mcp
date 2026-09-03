// Live end-to-end smoke test against a running Krayin instance.
// Usage: KRAYIN_URL=http://localhost KRAYIN_EMAIL=admin@example.com KRAYIN_PASSWORD=admin123 node test/live-smoke.js
import { KrayinClient } from "../src/client.js";
import { buildTools } from "../src/tools.js";

const client = new KrayinClient({});
const tools = Object.fromEntries(buildTools(client).map((t) => [t.name, t]));
const log = (label, v) => console.log(`\n== ${label} ==\n`, JSON.stringify(v)?.slice(0, 400));

try {
  await client.login();
  console.log("login OK, token acquired");

  const suffix = Date.now().toString().slice(-6);
  const person = await tools.krayin_create_person.handler({
    name: `Smoke Test Person ${suffix}`,
    emails: [{ value: `smoke${suffix}@test.local`, label: "work" }],
    contact_numbers: [{ value: `+1307555${suffix.slice(-4)}`, label: "work" }],
  });
  log("create_person", person);
  const personId = person?.data?.id ?? person?.id;

  const search = await tools.krayin_search_persons.handler({ query: "Smoke" });
  log("search_persons", search);

  const lead = await tools.krayin_create_lead.handler({
    title: "Smoke Test Lead - roof inspection",
    description: "Created by krayin-mcp live smoke test",
    lead_value: 12500,
    person: personId ? { id: personId } : { name: "Smoke Test Person" },
  });
  log("create_lead", lead);
  const leadId = lead?.data?.id ?? lead?.id;

  if (leadId) {
    const act = await tools.krayin_create_activity.handler({
      type: "note",
      comment: "Talked to homeowner, wants estimate next week",
      lead_id: leadId,
    });
    log("create_activity", act);

    const acts = await tools.krayin_lead_activities.handler({ id: leadId });
    log("lead_activities", acts);
  }

  const raw = await tools.krayin_api.handler({ method: "GET", path: "leads" });
  log("raw leads list", raw);

  console.log("\nSMOKE TEST PASSED");
} catch (err) {
  console.error("\nSMOKE TEST FAILED:", err.message);
  if (err.body) console.error("body:", JSON.stringify(err.body).slice(0, 600));
  process.exit(1);
}
