// Tool definitions for the Krayin MCP server. Each tool maps to Krayin REST
// endpoints (krayin/rest-api V1 routes). Kept as data + handler pairs so they
// can be unit-tested without an MCP transport.
import { z } from "zod";

const qs = (params) => {
  const clean = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : "";
};

export function buildTools(client) {
  return [
    {
      name: "krayin_search_persons",
      description:
        "Search people in the CRM by name/email/phone fragment. Returns matching person records with ids.",
      schema: { query: z.string().describe("Name, email, or phone fragment to search for") },
      handler: ({ query }) => client.get(`contacts/persons/search${qs({ query })}`),
    },
    {
      name: "krayin_get_person",
      description: "Fetch one person by id, including contact info and organization.",
      schema: { id: z.number().int().describe("Person id") },
      handler: ({ id }) => client.get(`contacts/persons/${id}`),
    },
    {
      name: "krayin_create_person",
      description:
        "Create a person. emails/contact_numbers are arrays of {value, label} where label is usually 'work' or 'home'.",
      schema: {
        name: z.string(),
        emails: z.array(z.object({ value: z.string(), label: z.string().default("work") })).optional(),
        contact_numbers: z.array(z.object({ value: z.string(), label: z.string().default("work") })).optional(),
        job_title: z.string().optional(),
        organization_id: z.number().int().optional(),
        extra: z.record(z.any()).optional().describe("Any additional Krayin person attributes, passed through"),
      },
      // emails and contact_numbers must always be sent, even empty. Two
      // separate breakages otherwise: rest-api's
      // PersonController::sanitizeRequestedPersonData() reads contact_numbers
      // unguarded (500 on create), and a person stored with a null emails
      // column crashes the lead view blade, which foreach-es it without a
      // guard. Empty arrays keep both happy.
      handler: ({ extra, ...fields }) =>
        client.post("contacts/persons", {
          emails: [],
          contact_numbers: [],
          ...fields,
          ...(extra || {}),
        }),
    },
    {
      name: "krayin_update_person",
      description: "Update fields on an existing person (same shape as create).",
      schema: { id: z.number().int(), fields: z.record(z.any()).describe("Fields to update") },
      handler: ({ id, fields }) =>
        client.put(`contacts/persons/${id}`, {
          contact_numbers: [],
          ...fields,
        }),
    },
    {
      name: "krayin_list_organizations",
      description: "List organizations (companies).",
      schema: {},
      handler: () => client.get("contacts/organizations"),
    },
    {
      name: "krayin_create_organization",
      description: "Create an organization (company).",
      schema: { name: z.string(), extra: z.record(z.any()).optional() },
      handler: ({ name, extra }) => client.post("contacts/organizations", { name, ...(extra || {}) }),
    },
    {
      name: "krayin_search_leads",
      description: "Search leads by title/person fragment.",
      schema: { query: z.string() },
      handler: ({ query }) => client.get(`leads/search${qs({ query })}`),
    },
    {
      name: "krayin_list_leads",
      description:
        "List leads, optionally filtered. Supports Krayin index params like pipeline/stage pagination passed through as-is.",
      schema: { params: z.record(z.any()).optional().describe("Query params, e.g. {page: 1}") },
      handler: ({ params }) => client.get(`leads${qs(params)}`),
    },
    {
      name: "krayin_get_lead",
      description: "Fetch one lead by id.",
      schema: { id: z.number().int() },
      handler: ({ id }) => client.get(`leads/${id}`),
    },
    {
      name: "krayin_create_lead",
      description:
        "Create a lead (a roof job). Minimal: title. Pipeline/stage/source/type ids are auto-filled from the instance defaults (default pipeline's first stage, 'Not Recorded' source, 'Insurance Claim' type) unless provided. Common fields: description, lead_value, person (object with id, or name/emails to create inline), expected_close_date (YYYY-MM-DD). Roofing attributes go in extra: property_address, jurisdiction, storm_date, carrier, claim_number, deductible, rcv_policy, code_upgrade_coverage, squares, roof_manufacturer, roof_product, install_date, reroof_due, employer_at_time, commission_notes.",
      schema: {
        title: z.string(),
        description: z.string().optional(),
        lead_value: z.number().optional(),
        person: z.record(z.any()).optional(),
        extra: z.record(z.any()).optional(),
      },
      handler: async ({ extra, ...fields }) => {
        const payload = { ...fields, ...(extra || {}) };
        if (!payload.lead_pipeline_stage_id || !payload.lead_pipeline_id) {
          const pipes = await client.get("settings/pipelines");
          const pipe = (pipes?.data || []).find((p) => p.is_default) || pipes?.data?.[0];
          if (pipe) {
            payload.lead_pipeline_id ??= pipe.id;
            payload.lead_pipeline_stage_id ??= pipe.stages?.[0]?.id;
          }
        }
        if (!payload.lead_source_id) {
          const src = await client.get("settings/sources");
          const s = (src?.data || []).find((x) => x.name === "Not Recorded") || src?.data?.[0];
          if (s) payload.lead_source_id = s.id;
        }
        if (!payload.lead_type_id) {
          const types = await client.get("settings/types");
          const t = (types?.data || []).find((x) => x.name === "Insurance Claim") || types?.data?.[0];
          if (t) payload.lead_type_id = t.id;
        }
        payload.lead_value ??= 0;
        payload.expected_close_date ??= null;
        return client.post("leads", payload);
      },
    },
    {
      name: "krayin_list_pipelines",
      description: "List pipelines with their stages (ids needed for stage moves), plus lead sources and types.",
      schema: {},
      handler: async () => ({
        pipelines: await client.get("settings/pipelines"),
        sources: await client.get("settings/sources"),
        types: await client.get("settings/types"),
      }),
    },
    {
      name: "krayin_update_lead",
      description:
        "Update fields on a lead. Select attributes (jurisdiction, carrier, roof_manufacturer, employer_at_time) take the attribute OPTION ID, not the label.",
      schema: { id: z.number().int(), fields: z.record(z.any()) },
      // krayin/rest-api's LeadController::update reads lead_pipeline_stage_id
      // unguarded, so a partial update without it 500s. Carry the lead's
      // current stage forward unless the caller is deliberately moving it.
      handler: async ({ id, fields }) => {
        const payload = { ...fields };
        if (payload.lead_pipeline_stage_id === undefined) {
          const current = await client.get(`leads/${id}`);
          const stageId =
            current?.data?.lead_pipeline_stage_id ?? current?.data?.stage?.id;
          if (stageId) payload.lead_pipeline_stage_id = stageId;
        }
        return client.put(`leads/${id}`, payload);
      },
    },
    {
      name: "krayin_move_lead_stage",
      description: "Move a lead to another pipeline stage.",
      schema: { id: z.number().int(), lead_pipeline_stage_id: z.number().int() },
      handler: ({ id, lead_pipeline_stage_id }) =>
        client.put(`leads/stage/edit/${id}`, { lead_pipeline_stage_id }),
    },
    {
      name: "krayin_lead_activities",
      description: "List activities attached to a lead.",
      schema: { id: z.number().int() },
      handler: ({ id }) => client.get(`leads/${id}/activities`),
    },
    {
      name: "krayin_person_activities",
      description: "List activities attached to a person.",
      schema: { id: z.number().int() },
      handler: ({ id }) => client.get(`contacts/persons/${id}/activities`),
    },
    {
      name: "krayin_create_activity",
      description:
        "Create an activity (note, call, meeting, task/follow-up). type is one of note|call|meeting|lunch|task. schedule_from/schedule_to are 'YYYY-MM-DD HH:MM:SS'. Link with lead_id and/or participants.",
      schema: {
        type: z.string(),
        title: z.string().optional(),
        comment: z.string().optional(),
        schedule_from: z.string().optional(),
        schedule_to: z.string().optional(),
        lead_id: z.number().int().optional(),
        extra: z.record(z.any()).optional(),
      },
      handler: ({ extra, ...fields }) => client.post("activities", { ...fields, ...(extra || {}) }),
    },
    {
      name: "krayin_list_activities",
      description: "List activities (follow-ups, notes, meetings). Pass params for filtering/pagination.",
      schema: { params: z.record(z.any()).optional() },
      handler: ({ params }) => client.get(`activities${qs(params)}`),
    },
    {
      name: "krayin_tag_lead",
      description: "Attach a tag to a lead. Provide existing tag id, or name to create/attach.",
      schema: { id: z.number().int(), tag: z.record(z.any()).describe("{id} or {name, color?}") },
      handler: ({ id, tag }) => client.post(`leads/${id}/tags`, tag),
    },
    {
      name: "krayin_tag_person",
      description: "Attach a tag to a person. Provide existing tag id, or name to create/attach.",
      schema: { id: z.number().int(), tag: z.record(z.any()) },
      handler: ({ id, tag }) => client.post(`contacts/persons/${id}/tags`, tag),
    },
    {
      name: "krayin_api",
      description:
        "Escape hatch: call any Krayin REST API v1 endpoint directly. path is relative to /api/v1/ (e.g. 'quotes' or 'settings/pipelines'). Use for anything the named tools do not cover.",
      schema: {
        method: z.enum(["GET", "POST", "PUT", "DELETE"]),
        path: z.string(),
        body: z.record(z.any()).optional(),
      },
      handler: ({ method, path, body }) => client.request(method, path, body),
    },
  ];
}
