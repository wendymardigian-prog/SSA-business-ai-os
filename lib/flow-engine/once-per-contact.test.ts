/**
 * «Una sola vez por contacto»: dos envíos del mismo contacto dan una sola sesión, y el evento nunca falla por eso.
 * Corre con el motor real (solo se le puede forzar un fallo a `executeFlow`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({ audit: vi.fn(async () => null), failNext: { value: false } }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/flow-engine/engine", async (original) => {
  const real = await original<typeof import("./engine")>();
  return {
    ...real,
    executeFlow: async (...args: Parameters<typeof real.executeFlow>) => {
      if (mocks.failNext.value) {
        mocks.failNext.value = false;
        throw new Error("el flujo fallo");
      }
      return real.executeFlow(...args);
    },
  };
});

import "@/lib/flow-engine/registry";
import { getTrigger, registerNode, registerTrigger } from "@/lib/flow-engine/registry/registry";
import { processEvent, type AutomationEvent } from "./automation-events";
import { supportsOncePerContact } from "./once-per-contact";
import { TRIGGER_CATALOG } from "./trigger-catalog";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { parseFormTriggerConfig } from "@/lib/forms/automation/trigger-config"; // @plantilla-quitar(formularios)

const WS = "ws-1";
const ran: string[] = [];
registerNode({ type: "zzOnceMarker", label: "Marca", needsContact: false, execute: ({ context }) => { ran.push(String(context.contactId)); } });
registerTrigger({ type: "zz_once_trigger", label: "Prueba", scope: "event", priority: 45, eventTypes: ["zz_once_event"], dedupeKeyFor: (a) => `zz:${a.event.id}` });

function world(config: Record<string, unknown> = { oncePerContact: true }, sessions: unknown[] = []) {
  return memoryDb(
    {
      flows: [
        {
          id: "flow-1",
          workspace_id: WS,
          status: "published",
          nodes: [{ id: "t", type: "trigger", data: { triggerType: "zz_once_trigger" } }, { id: "a", type: "zzOnceMarker", data: {} }],
          edges: [{ id: "e", source: "t", target: "a" }],
        },
      ],
      triggers: [{ id: "tr-1", workspace_id: WS, flow_id: "flow-1", channel_id: null, type: "zz_once_trigger", config, priority: 45, is_active: true }],
      conversations: [],
      contacts: [{ id: "c-1", workspace_id: WS }, { id: "c-2", workspace_id: WS }],
      workspaces: [{ id: WS, name: "N" }],
      trigger_fires: [],
      bookings: [],
      flow_sessions: sessions as never[],
      analytics_events: [],
    },
    { unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } },
  );
}

const event = (id: string, contact = "c-1") =>
  ({ id, workspace_id: WS, event_type: "zz_once_event", contact_id: contact, member_user_id: null, source_type: "contact", source_id: null, payload: {} }) as unknown as AutomationEvent;

const onceSkips = (db: ReturnType<typeof world>) => db.rows("analytics_events").filter((e) => e.event_type === "flow_once_skipped");

beforeEach(() => {
  ran.length = 0;
  mocks.failNext.value = false;
  vi.clearAllMocks();
});

describe("con la opción prendida", () => {
  it("dos envíos del mismo contacto dan una sola sesión, y el segundo no falla", async () => {
    const db = world();
    expect(await processEvent(db.client as never, event("ev-1"))).toBe(1);
    expect(await processEvent(db.client as never, event("ev-2"))).toBe(0);
    expect(db.rows("flow_sessions")).toHaveLength(1);
    expect(ran).toEqual(["c-1"]);
    expect(onceSkips(db)).toHaveLength(1);
    expect(onceSkips(db)[0]).toMatchObject({ flow_id: "flow-1", contact_id: "c-1", metadata: { trigger_id: "tr-1" } });
  });

  it("otra persona sí entra", async () => {
    const db = world();
    await processEvent(db.client as never, event("ev-1", "c-1"));
    expect(await processEvent(db.client as never, event("ev-2", "c-2"))).toBe(1);
    expect(ran).toEqual(["c-1", "c-2"]);
  });

  it.each(["active", "completed", "expired"])("una sesión %s cuenta, aunque las marcas ya no estén (publicar las borra)", async (status) => {
    const db = world({ oncePerContact: true }, [{ id: "s-0", flow_id: "flow-1", contact_id: "c-1", status }]);
    expect(await processEvent(db.client as never, event("ev-1"))).toBe(0);
    expect(ran).toEqual([]);
  });

  it("una sesión cancelada no cuenta", async () => {
    const db = world({ oncePerContact: true }, [{ id: "s-0", flow_id: "flow-1", contact_id: "c-1", status: "cancelled" }]);
    expect(await processEvent(db.client as never, event("ev-1"))).toBe(1);
    expect(ran).toEqual(["c-1"]);
  });

  it("la sesión de OTRO flujo no cuenta", async () => {
    const db = world({ oncePerContact: true }, [{ id: "s-0", flow_id: "flow-2", contact_id: "c-1", status: "completed" }]);
    expect(await processEvent(db.client as never, event("ev-1"))).toBe(1);
  });

  it("dos eventos a la vez: el índice único deja pasar a uno solo", async () => {
    const db = world();
    db.rows("trigger_fires").push({ trigger_id: "tr-1", dedupe_key: "once-contact:c-1" });
    expect(await processEvent(db.client as never, event("ev-1"))).toBe(0);
    expect(ran).toEqual([]);
  });

  it("si el flujo falla, la marca se libera y la persona puede entrar después", async () => {
    const db = world();
    mocks.failNext.value = true;
    await expect(processEvent(db.client as never, event("ev-1"))).rejects.toThrow("el flujo fallo");
    expect(db.rows("trigger_fires").some((f) => f.dedupe_key === "once-contact:c-1")).toBe(false);
    expect(await processEvent(db.client as never, event("ev-2"))).toBe(1);
    expect(ran).toEqual(["c-1"]);
  });

  it("si no se puede leer si ya pasó, no corre y el evento queda con el motivo", async () => {
    const db = world();
    const failing: unknown = new Proxy(function () {}, {
      get: (_t, prop) => (prop === "then" ? (done: (r: unknown) => void) => done({ data: null, error: { message: "base caida" } }) : () => failing),
    });
    const client = { from: (table: string) => (table === "flow_sessions" ? failing : db.client.from(table as never)) };
    await expect(processEvent(client as never, event("ev-1"))).rejects.toThrow("base caida");
    expect(ran).toEqual([]);
  });
});

describe("con la opción apagada", () => {
  it.each([[{}], [{ oncePerContact: false }]])("cada envío corre, como siempre (%j)", async (config) => {
    const db = world(config);
    await processEvent(db.client as never, event("ev-1"));
    await processEvent(db.client as never, event("ev-2"));
    expect(db.rows("flow_sessions")).toHaveLength(2);
    expect(ran).toEqual(["c-1", "c-1"]);
    expect(db.rows("trigger_fires").some((f) => String(f.dedupe_key).startsWith("once-contact:"))).toBe(false);
  });
});

describe("qué disparadores la ofrecen", () => {
  it("son los que corren por eventos sobre un contacto, salvo «Contacto nuevo»", () => {
    for (const { type } of TRIGGER_CATALOG) {
      const definition = getTrigger(type);
      const byEvents = !!definition?.eventTypes?.length && (definition.subject ?? "contact") === "contact";
      expect([type, supportsOncePerContact(type)]).toEqual([type, byEvents && type !== "new_contact"]);
    }
  });

  it("los de mensaje, inactividad y webhook no, ni un tipo que no existe", () => {
    for (const type of ["keyword", "welcome", "inactivity", "email_received", "webhook_received", "eod_submitted", "nada", null]) {
      expect(supportsOncePerContact(type)).toBe(false);
    }
    expect(supportsOncePerContact("form_submitted")).toBe(true); // @plantilla-quitar(formularios)
  });
});

// @plantilla-desde(formularios)
describe("la opción viaja del disparador a la fila que lee el cron", () => {
  it("publicar la copia a triggers.config", () => {
    const [row] = buildDesiredTriggers([{ id: "t", type: "trigger", data: { triggerType: "form_submitted", form_ids: ["f-1"], oncePerContact: true } }], "flow-1");
    expect(row.config).toMatchObject({ form_ids: ["f-1"], oncePerContact: true });
  });

  it("no le molesta al validador de los disparadores de formulario", () => {
    expect(parseFormTriggerConfig("form_submitted", { form_ids: ["4d5d903e-6ed4-459a-b614-4fa7a203226d"], oncePerContact: true })).toMatchObject({ ok: true });
  });
});
// @plantilla-hasta(formularios)
