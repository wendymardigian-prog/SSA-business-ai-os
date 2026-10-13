/**
 * El disparo directo de los flujos de webhook con el MOTOR REAL (`executeFlow`) y una base en
 * memoria: el reclamo en `trigger_fires`, el «Solo si…», las variables `{{webhook.*}}`, el flujo sin
 * contacto y el paso «Crear o actualizar contacto» que lo consigue a mitad de flujo.
 * Lo único simulado es `fetch` (el paso HTTP): ningún test llama afuera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { runWebhookFlows, type InboundForFlows } from "./run-flows";
import { processInbound } from "./process";

const WS = "ws-1";
type Row = Record<string, unknown>;

const trig = { id: "n-t", type: "trigger", data: { triggerType: "webhook_received" } };
const http = (id: string, url: string): Row => ({ id, type: "action", data: { actionType: "httpRequest", method: "GET", url } });
const delay: Row = { id: "n-d", type: "delay", data: { duration: 1, unit: "minutes" } };
const upsert = (map: Row[] = [{ target: "contact.email", source: { path: "email" } }, { target: "contact.display_name", source: { path: "data.name" } }]): Row => ({ id: "n-u", type: "upsert_contact", data: { map, tags: { fixed: [] }, attribution: { map: [], autoDetect: true } } });
const e = (id: string, source: string, target: string, sourceHandle?: string): Row => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

function flow(id: string, name: string, nodes: Row[], edges: Row[]): Row {
  return { id, workspace_id: WS, name, status: "published", nodes, edges };
}
const trigger = (id: string, flowId: string, endpointId: string, config: Row = {}): Row => ({ id, flow_id: flowId, workspace_id: WS, type: "webhook_received", is_active: true, priority: 0, config: { endpointId, ...config }, flows: { id: flowId, name: flowId, status: "published" } });

function world(flows: Row[], triggers: Row[]) {
  return memoryDb(
    {
      flows,
      triggers,
      trigger_fires: [],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
      channels: [],
      conversations: [],
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      custom_field_definitions: [],
      contacts: [],
      contact_custom_fields: [],
      contact_channels: [],
      contact_touches: [],
      tags: [],
      contact_tags: [],
      audit_log: [],
      webhook_endpoints: [{ id: "ep-1", workspace_id: WS, name: "Typeform", created_by: null, last_error_alert_at: null }],
      inbound_webhooks: [],
      notifications: [],
    },
    {
      unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key },
      rpc: {
        find_contact_for_form: (args, db: MemoryDb) => {
          const hit = db.tables.contacts.find((c) => c.workspace_id === args.p_workspace_id && args.p_email && c.email === args.p_email);
          return { contact_id: hit ? hit.id : null, matched_by: hit ? "email" : null, conflicts: [] };
        },
        record_contact_touch: (args, db: MemoryDb) => {
          db.tables.contact_touches.push({ contact_id: args.p_contact_id, ...(args.p_touch as Row) });
          return { inserted: true };
        },
      },
    },
  );
}

const inbound = (over: Partial<InboundForFlows> = {}): InboundForFlows => ({
  id: "in-1",
  workspace_id: WS,
  endpoint_id: "ep-1",
  payload: { email: "ana@example.com", data: { name: "Ana" }, plan: "pro" },
  query: { utm_source: "fb" },
  received_at: "2026-10-12T12:00:00Z",
  reprocess_count: 0,
  ...over,
});
const endpoint = { id: "ep-1", workspace_id: WS, name: "Typeform" };
const run = (db: MemoryDb, over: Partial<InboundForFlows> = {}) => runWebhookFlows({ db: db.client, inbound: inbound(over), endpoint });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await import("@/lib/flow-engine/registry");
  fetchMock = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("runWebhookFlows", () => {
  it("con dos flujos publicados que lo escuchan, AMBOS corren una vez", async () => {
    const db = world(
      [flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-h")]), flow("f-2", "Dos", [trig, http("n-h", "https://x.test/dos")], [e("e1", "n-t", "n-h")])],
      [trigger("tr-1", "f-1", "ep-1"), trigger("tr-2", "f-2", "ep-1")],
    );
    const results = await run(db);
    expect(Object.keys(results).sort()).toEqual(["f-1", "f-2"]);
    expect(results["f-1"].status).toBe("completed");
    expect(results["f-2"].status).toBe("completed");
    expect(fetchMock.mock.calls.map((c) => String(c[0])).sort()).toEqual(["https://x.test/dos", "https://x.test/uno"]);
  });

  it("un flujo que usa OTRO endpoint no corre", async () => {
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-h")])], [trigger("tr-1", "f-1", "ep-otro")]);
    expect(await run(db)).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el flujo corre SIN contacto: la sesión queda con contact_id null y el envío como sostén", async () => {
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno"), delay, http("n-h2", "https://x.test/dos")], [e("e1", "n-t", "n-h"), e("e2", "n-h", "n-d"), e("e3", "n-d", "n-h2")])], [trigger("tr-1", "f-1", "ep-1")]);
    const results = await run(db);
    expect(results["f-1"].status).toBe("pending");
    expect(db.rows("flow_sessions")[0]).toMatchObject({ contact_id: null, member_user_id: null, inbound_webhook_id: "in-1", status: "active" });
    expect(db.rows("scheduled_jobs")[0]).toMatchObject({ type: "resume_flow" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("«Solo si…» que no se cumple: no corre y lo dice", async () => {
    const conditions = { logic: "and", conditions: [{ field: "webhook.payload.plan", operator: "is", value: "basic", valueType: "text" }] };
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-h")])], [trigger("tr-1", "f-1", "ep-1", { conditions })]);
    const results = await run(db);
    expect(results["f-1"]).toMatchObject({ status: "skipped_condition", error: "no cumplió la condición" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.rows("flow_sessions")).toHaveLength(0);
  });

  it("«Solo si…» que se cumple: corre", async () => {
    const conditions = { logic: "and", conditions: [{ field: "webhook.payload.plan", operator: "is", value: "pro", valueType: "text" }] };
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-h")])], [trigger("tr-1", "f-1", "ep-1", { conditions })]);
    expect((await run(db))["f-1"].status).toBe("completed");
  });

  it("el mismo envío procesado dos veces sin reprocesar: cada flujo corre UNA sola vez (trigger_fires)", async () => {
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-h")])], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    const second = await run(db);
    expect(second).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("trigger_fires")[0].dedupe_key).toBe("webhook:in-1:f-1:0");
  });

  it("reprocesar (otro número de reproceso) corre de nuevo", async () => {
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-h")])], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    await run(db, { reprocess_count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.rows("trigger_fires").map((r) => r.dedupe_key)).toEqual(["webhook:in-1:f-1:0", "webhook:in-1:f-1:1"]);
  });

  it("{{webhook.payload.data.name}} se resuelve en los pasos (test con fetch simulado)", async () => {
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/hola?name={{webhook.payload.data.name}}&src={{webhook.query.utm_source}}&ep={{webhook.endpoint_name}}")], [e("e1", "n-t", "n-h")])], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://x.test/hola?name=Ana&src=fb&ep=Typeform");
  });

  it("un paso que necesita contacto ANTES del paso de contacto se sasaltea y se anota (no corta el flujo)", async () => {
    const tag: Row = { id: "n-tag", type: "action", data: { actionType: "addTag", label: "Poner VIP", tagId: "tag-vip" } };
    const db = world([flow("f-1", "Uno", [trig, tag, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-tag"), e("e2", "n-tag", "n-h")])], [trigger("tr-1", "f-1", "ep-1")]);
    const results = await run(db);
    expect(results["f-1"]).toMatchObject({ status: "completed", skipped_steps: ["Poner VIP"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("analytics_events").some((x) => x.event_type === "node_skipped")).toBe(true);
  });

  it("el paso «Crear o actualizar contacto» consigue el contacto a mitad de flujo y lo deja en la sesión", async () => {
    const db = world([flow("f-1", "Uno", [trig, upsert(), http("n-h", "https://x.test/hola?contacto={{contact_result}}")], [e("e1", "n-t", "n-u"), e("e2", "n-u", "n-h", "ok")])], [trigger("tr-1", "f-1", "ep-1")]);
    const results = await run(db);
    expect(results["f-1"]).toMatchObject({ status: "completed", contact_result: "created", contact_name: "Ana" });
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("flow_sessions")[0]).toMatchObject({ contact_id: db.rows("contacts")[0].id });
    expect(results["f-1"].contact_id).toBe(db.rows("contacts")[0].id);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://x.test/hola?contacto=created");
    expect(db.rows("contact_touches")[0]).toMatchObject({ origin: "webhook", source: "fb" });
  });

  it("sin identificador sale por «No se pudo» (no es un error) y el flujo sigue por esa salida", async () => {
    const db = world([flow("f-1", "Uno", [trig, upsert(), http("n-ok", "https://x.test/ok"), http("n-fail", "https://x.test/fail?razon={{contact_fail_reason}}")], [e("e1", "n-t", "n-u"), e("e2", "n-u", "n-ok", "ok"), e("e3", "n-u", "n-fail", "fail")])], [trigger("tr-1", "f-1", "ep-1")]);
    const results = await run(db, { payload: { data: { name: "Sin datos" } } });
    expect(results["f-1"]).toMatchObject({ status: "completed", contact_fail_reason: "no_identifier" });
    expect(db.rows("contacts")).toHaveLength(0);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["https://x.test/fail?razon=no_identifier"]);
  });

  it("un fallo interno del paso de contacto deja el flujo fallado y la sesión cancelada (no queda activa)", async () => {
    const db = world([flow("f-1", "Uno", [trig, upsert()], [e("e1", "n-t", "n-u")])], [trigger("tr-1", "f-1", "ep-1")]);
    db.client.rpc = (async () => ({ data: null, error: { message: "base caida" } })) as never;
    const results = await run(db);
    expect(results["f-1"]).toMatchObject({ status: "failed" });
    expect(results["f-1"].error).toContain("no pude buscar el contacto");
    expect(db.rows("flow_sessions")[0].status).toBe("cancelled");
  });
});

describe("processInbound con flujos reales", () => {
  it("guarda el resultado por flujo, el contacto y el estado final del envío", async () => {
    const db = world([flow("f-1", "Uno", [trig, upsert()], [e("e1", "n-t", "n-u")])], [trigger("tr-1", "f-1", "ep-1")]);
    db.tables.inbound_webhooks.push({ id: "in-1", workspace_id: WS, endpoint_id: "ep-1", status: "received", payload: { email: "ana@example.com", data: { name: "Ana" } }, query: {}, received_at: "2026-10-12T12:00:00Z", reprocess_count: 0 });
    const out = await processInbound(db.client, "in-1");
    expect(out).toEqual({ kind: "processed", status: "processed" });
    const saved = db.rows("inbound_webhooks")[0];
    expect(saved).toMatchObject({ status: "processed", contact_id: db.rows("contacts")[0].id });
    expect((saved.result as { summary: string }).summary).toBe("1 flujo corrió");
    expect((saved.result as { flows: Record<string, { contact_result: string }> }).flows["f-1"].contact_result).toBe("created");
  });
});
