/**
 * El disparo directo de los flujos de webhook con el MOTOR REAL (`executeFlow`) y una base en
 * memoria: el reclamo en `trigger_fires`, el «Solo si…», las variables `{{webhook.*}}`, el flujo sin
 * contacto y el paso «Crear o actualizar contacto» que lo consigue a mitad de flujo.
 * Lo único simulado es `fetch` (el paso HTTP): ningún test llama afuera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { memoryCentralRpc } from "@/lib/contacts/testing/memory-central";
import { runWebhookFlows, type InboundForFlows } from "./run-flows";
import { processInbound, reprocessInbound } from "./process";
import { ALREADY_PASSED_NOTE } from "@/lib/flow-engine/nodes/upsert-contact";

// La «Llamada HTTP» resuelve el nombre antes de llamar (no deja pedir direcciones internas). En el test no hay DNS:
// cualquier nombre resuelve a una IP pública de ejemplo.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

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
        find_or_create_contact: memoryCentralRpc,
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
const run = (db: MemoryDb, over: Partial<InboundForFlows> = {}, rerunCompleted = false) => runWebhookFlows({ db: db.client, inbound: inbound(over), endpoint, rerunCompleted });

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
    // La clave es por (envío, flujo): sin el número de reproceso (Tirón 2, C2).
    expect(db.rows("trigger_fires")[0].dedupe_key).toBe("webhook:in-1:f-1");
  });

  it("reprocesar NO vuelve a correr el flujo que ya corrió (ni una ni dos veces)", async () => {
    const db = world([flow("f-1", "Uno", [trig, http("n-h", "https://x.test/uno")], [e("e1", "n-t", "n-h")])], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    await run(db, { reprocess_count: 1 });
    await run(db, { reprocess_count: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("trigger_fires").map((r) => r.dedupe_key)).toEqual(["webhook:in-1:f-1"]);
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
    expect(results["f-1"].error).toContain("no pude buscar o crear el contacto");
    expect(db.rows("flow_sessions")[0].status).toBe("cancelled");
  });
});

describe("un envío nunca dispara dos veces el mismo flujo (Tirón 2, C2)", () => {
  const sendFlow = () => flow("f-1", "Bienvenida", [trig, upsert(), http("n-h", "https://x.test/bienvenida")], [e("e1", "n-t", "n-u"), e("e2", "n-u", "n-h", "ok")]);

  it("dos procesamientos SIMULTÁNEOS del mismo envío: el flujo corre una sola vez", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1")]);
    await Promise.all([run(db), run(db), run(db)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("flow_sessions")).toHaveLength(1);
  });

  it("un reintento (el reaper o el cron procesando otra vez el mismo envío) no repite nada", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    const again = await run(db);
    expect(again).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reprocesar dos veces SIN la casilla: el flujo corrió una vez", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1")]);
    db.tables.inbound_webhooks.push({ id: "in-1", workspace_id: WS, endpoint_id: "ep-1", status: "received", payload: { email: "ana@example.com", data: { name: "Ana" } }, query: {}, received_at: "2026-10-12T12:00:00Z", reprocess_count: 0 });
    await processInbound(db.client, "in-1");
    await reprocessInbound(db.client, "in-1", 0);
    await reprocessInbound(db.client, "in-1", 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ reprocess_count: 2, status: "processed" });
    // Lo que ya se sabía del flujo NO se pierde al reprocesar.
    const saved = db.rows("inbound_webhooks")[0].result as { flows: Record<string, { status: string; contact_result: string }> };
    expect(saved.flows["f-1"]).toMatchObject({ status: "completed" });
  });

  it("reprocesar CON la casilla vuelve a correr el flujo", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    await run(db, { reprocess_count: 1 }, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.rows("trigger_fires").map((r) => r.dedupe_key)).toEqual(["webhook:in-1:f-1"]);
  });

  it("con la casilla se cancela la sesión que seguía esperando, para que no despierten dos corridas", async () => {
    const waiting = flow("f-1", "Con espera", [trig, delay, http("n-h", "https://x.test/despues")], [e("e1", "n-t", "n-d"), e("e2", "n-d", "n-h")]);
    const db = world([waiting], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    expect(db.rows("flow_sessions").map((x) => x.status)).toEqual(["active"]);
    await run(db, { reprocess_count: 1 }, true);
    expect(db.rows("flow_sessions").map((x) => x.status)).toEqual(["cancelled", "active"]);
  });

  it("un flujo que FALLÓ no cuenta como corrido: se libera la clave y reprocesar lo reintenta", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1")]);
    const rpc = db.client.rpc;
    db.client.rpc = (async () => ({ data: null, error: { message: "base caida" } })) as never;
    const first = await run(db);
    expect(first["f-1"]).toMatchObject({ status: "failed" });
    expect(db.rows("trigger_fires")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();

    db.client.rpc = rpc;
    const retry = await run(db, { reprocess_count: 1 });
    expect(retry["f-1"]).toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reprocesar vuelve a MAPEAR el contacto sin repetir el flujo (arreglar el mapeo y reprocesar)", async () => {
    // El mapeo apuntaba a un campo que no existe: «No se pudo». El flujo corrió (por la salida de error).
    const broken = flow("f-1", "Mapeo roto", [trig, upsert([{ target: "contact.email", source: { path: "mail" } }]), http("n-fail", "https://x.test/fail")], [e("e1", "n-t", "n-u"), e("e2", "n-u", "n-fail", "fail")]);
    const db = world([broken], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    expect(db.rows("contacts")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Se corrige el mapeo y se reprocesa (sin la casilla).
    const fixed = [trig, upsert([{ target: "contact.email", source: { path: "email" } }]), http("n-fail", "https://x.test/fail")];
    db.tables.flows[0].nodes = fixed;
    // El `join` de PostgREST trae los nodos actuales del flujo; en memoria el join es la propia fila del trigger.
    (db.tables.triggers[0].flows as Row).nodes = fixed;
    const results = await run(db, { reprocess_count: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1); // el flujo NO se repitió
    expect(db.rows("contacts")).toHaveLength(1);
    expect(results["f-1"]).toMatchObject({ contact_remapped: true, contact_result: "created", contact_id: db.rows("contacts")[0].id });
  });

  it("con dos pasos de contacto (ramas distintas) no se adivina cuál corrió: no se vuelve a mapear", async () => {
    const two = flow("f-1", "Dos", [trig, upsert(), { ...upsert(), id: "n-u2" }], [e("e1", "n-t", "n-u"), e("e2", "n-u", "n-u2", "ok")]);
    const db = world([two], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    const before = db.rows("contacts").length;
    const results = await run(db, { reprocess_count: 1 });
    expect(results).toEqual({});
    expect(db.rows("contacts")).toHaveLength(before);
  });
});

describe("«Correr una sola vez por contacto» (Tirón 2, C2)", () => {
  const sendFlow = () => flow("f-1", "Bienvenida", [trig, upsert(), http("n-h", "https://x.test/bienvenida")], [e("e1", "n-t", "n-u"), e("e2", "n-u", "n-h", "ok")]);
  const second = { id: "in-2", received_at: "2026-10-12T13:00:00Z" };

  it("apagado (por defecto): la misma persona en dos envíos distintos entra las dos veces", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1")]);
    await run(db);
    await run(db, second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("encendido: la misma persona en un segundo envío NO vuelve a entrar, pero su contacto se actualiza", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1", { oncePerContact: true })]);
    await run(db);
    const out = await run(db, { ...second, payload: { email: "ana@example.com", data: { name: "Ana María" } } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("contacts")).toHaveLength(1);
    expect(out["f-1"]).toMatchObject({ status: "completed", contact_id: db.rows("contacts")[0].id });
    expect(out["f-1"].notes).toContain(ALREADY_PASSED_NOTE);
    // La sesión del segundo envío terminó: no queda activa esperando nada.
    expect(db.rows("flow_sessions").map((x) => x.status)).toEqual(["completed", "completed"]);
  });

  it("encendido: otra PERSONA sí entra", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1", { oncePerContact: true })]);
    await run(db);
    await run(db, { ...second, payload: { email: "bruno@example.com", data: { name: "Bruno" } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("encendido: «volver a correr también los flujos que ya corrieron» lo deja entrar otra vez", async () => {
    const db = world([sendFlow()], [trigger("tr-1", "f-1", "ep-1", { oncePerContact: true })]);
    const first = await run(db);
    // `result` es lo que quedó guardado en el envío después de la primera corrida.
    await run(db, { reprocess_count: 1, result: { flows: first } }, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("si falla guardar el contacto en la sesión del flujo (Tirón 2, C3)", () => {
  /** La base se cae SOLO al guardar el contacto en `flow_sessions`; todo lo demás anda. */
  function failSessionContactUpdate(db: MemoryDb) {
    const realFrom = db.client.from.bind(db.client);
    db.client.from = ((table: string) => {
      const query = realFrom(table as never) as unknown as Record<string, unknown>;
      if (table !== "flow_sessions") return query;
      return new Proxy(query, {
        get(target, prop) {
          if (prop === "update") {
            return (values: Row) => (values && "contact_id" in values ? { eq: async () => ({ error: { message: "base caida" } }) } : (target.update as (v: Row) => unknown)(values));
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as never;
  }

  it("el paso lanza, el flujo queda fallado con el motivo y la sesión cancelada", async () => {
    const db = world([flow("f-1", "Uno", [trig, upsert()], [e("e1", "n-t", "n-u")])], [trigger("tr-1", "f-1", "ep-1")]);
    failSessionContactUpdate(db);
    const results = await run(db);
    expect(results["f-1"]).toMatchObject({ status: "failed" });
    expect(results["f-1"].error).toContain("no pude guardar el contacto en la sesión del flujo");
    expect(db.rows("flow_sessions")[0].status).toBe("cancelled");
  });

  it("en el historial del envío queda el estado de error y el motivo legible", async () => {
    const db = world([flow("f-1", "Uno", [trig, upsert()], [e("e1", "n-t", "n-u")])], [trigger("tr-1", "f-1", "ep-1")]);
    failSessionContactUpdate(db);
    db.tables.inbound_webhooks.push({ id: "in-1", workspace_id: WS, endpoint_id: "ep-1", status: "received", payload: { email: "ana@example.com" }, query: {}, received_at: "2026-10-12T12:00:00Z", reprocess_count: 0 });
    const out = await processInbound(db.client, "in-1");
    expect(out).toEqual({ kind: "processed", status: "error" });
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "error" });
    expect(String(db.rows("inbound_webhooks")[0].error_message)).toContain("no pude guardar el contacto en la sesión del flujo");
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
