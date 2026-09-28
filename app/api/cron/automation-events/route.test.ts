/**
 * Caracterizacion del drenado de `automation_events` ANTES de la Etapa 4.
 *
 * Fija como se comporta HOY el cron, para que sumar los triggers de agenda
 * (B7a) no mueva nada de esto sin que se note:
 *   - `contact_created` va a los triggers `new_contact`; cualquier otro
 *     evento va a `crm_event` y se filtra con `crmEventMatches`.
 *   - la clave de idempotencia es `contact:<id>` para contacto nuevo y
 *     `event:<id>` para el resto.
 *   - un contacto sin conversacion arranca el flow con `channelId: ""` (y
 *     hoy eso hace que `flow_sessions` rechace la sesion; ver
 *     engine-characterization.test.ts).
 *   - un tipo de evento que ningun trigger conoce (por ejemplo
 *     `booking_created`) no dispara nada y queda procesado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const executeFlow = vi.fn(async () => {});
const logAudit = vi.fn(async () => "audit-1");
let db: MemoryDb;

vi.mock("@/lib/cron-auth", () => ({ authorizeCronRequest: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: (...a: unknown[]) => executeFlow(...(a as [])) }));
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...(a as [])) }));

import { GET } from "./route";

const WS = "ws-1";
const request = () => new NextRequest("http://localhost/api/cron/automation-events");

function seed(events: Array<Record<string, unknown>>, triggers: Array<Record<string, unknown>>, conversations: Array<Record<string, unknown>> = []) {
  db = memoryDb(
    {
      automation_events: events.map((e, i) => ({ id: `ev-${i + 1}`, workspace_id: WS, processed_at: null, created_at: `2026-09-27T10:00:0${i}.000Z`, payload: {}, ...e })),
      triggers: triggers.map((t, i) => ({ id: `tr-${i + 1}`, workspace_id: WS, is_active: true, config: {}, flow_id: `flow-${i + 1}`, ...t })),
      conversations,
      trigger_fires: [],
    },
    { joins: { "triggers.flows": () => ({ status: "published" }) } },
  );
}

beforeEach(() => {
  executeFlow.mockClear();
  logAudit.mockClear();
});

describe("cron automation-events (caracterizacion previa a la etapa 4)", () => {
  it("contact_created dispara los triggers new_contact con dedupe contact:<id>", async () => {
    seed([{ event_type: "contact_created", contact_id: "c-1", payload: { source: "csv" } }], [{ type: "new_contact" }]);
    const res = await GET(request());
    expect(await res.json()).toEqual({ ok: true, processed: 1, fired: 1 });
    expect(db.rows("trigger_fires").map((f) => f.dedupe_key)).toEqual(["contact:c-1"]);
    expect(db.rows("automation_events")[0].processed_at).toBeTruthy();
  });

  it("los demas eventos van a crm_event, filtrados por config.event/value, con dedupe event:<id>", async () => {
    seed(
      [{ event_type: "tag_added", contact_id: "c-1", payload: { tag_name: "Interesado" } }],
      [
        { type: "crm_event", config: { event: "tag_added", value: "interesado" } },
        { type: "crm_event", config: { event: "tag_added", value: "otro" } },
        { type: "new_contact" },
      ],
    );
    const res = await GET(request());
    expect(await res.json()).toEqual({ ok: true, processed: 1, fired: 1 });
    expect(db.rows("trigger_fires").map((f) => [f.trigger_id, f.dedupe_key])).toEqual([["tr-1", "event:ev-1"]]);
  });

  it("sin conversacion, el flow arranca con channelId y conversationId vacios y las variables event_*", async () => {
    seed([{ event_type: "tag_added", contact_id: "c-1", payload: { tag_name: "vip", tag_id: "t-1" } }], [{ type: "crm_event", config: { event: "tag_added" } }]);
    await GET(request());
    expect(executeFlow).toHaveBeenCalledTimes(1);
    const [, ctx] = executeFlow.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(ctx).toMatchObject({
      triggerId: "tr-1",
      flowId: "flow-1",
      channelId: "",
      conversationId: "",
      contactId: "c-1",
      workspaceId: WS,
      incomingMessage: {},
      variables: { event_type: "tag_added", event_tag_name: "vip", event_tag_id: "t-1" },
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it("con conversacion, usa la mas reciente del contacto", async () => {
    seed(
      [{ event_type: "tag_added", contact_id: "c-1" }],
      [{ type: "crm_event", config: { event: "tag_added" } }],
      [
        { id: "conv-old", contact_id: "c-1", channel_id: "ch-1", deleted_at: null, last_message_at: "2026-09-01T00:00:00.000Z" },
        { id: "conv-new", contact_id: "c-1", channel_id: "ch-2", deleted_at: null, last_message_at: "2026-09-20T00:00:00.000Z" },
      ],
    );
    await GET(request());
    const [, ctx] = executeFlow.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(ctx).toMatchObject({ channelId: "ch-2", conversationId: "conv-new" });
  });

  it("un evento repetido no vuelve a disparar (23505 en trigger_fires)", async () => {
    seed([{ event_type: "tag_added", contact_id: "c-1" }], [{ type: "crm_event", config: { event: "tag_added" } }]);
    db.rows("trigger_fires").push({ trigger_id: "tr-1", workspace_id: WS, dedupe_key: "event:ev-1", contact_id: "c-1" });
    // El indice unico real es (trigger_id, dedupe_key); en memoria se simula.
    db = memoryDb({ ...db.tables }, { joins: { "triggers.flows": () => ({ status: "published" }) }, unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } });
    const res = await GET(request());
    expect(await res.json()).toEqual({ ok: true, processed: 1, fired: 0 });
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it("un tipo de evento que no conoce nadie (booking_created) no dispara y queda procesado", async () => {
    seed(
      [{ event_type: "booking_created", contact_id: "c-1", payload: { booking_id: "b-1" } }],
      [{ type: "crm_event", config: { event: "tag_added" } }, { type: "new_contact" }],
    );
    const res = await GET(request());
    expect(await res.json()).toEqual({ ok: true, processed: 1, fired: 0 });
    expect(executeFlow).not.toHaveBeenCalled();
    expect(db.rows("automation_events")[0].processed_at).toBeTruthy();
  });

  it("triggers inactivos no cuentan", async () => {
    seed([{ event_type: "contact_created", contact_id: "c-1" }], [{ type: "new_contact", is_active: false }]);
    const res = await GET(request());
    expect(await res.json()).toEqual({ ok: true, processed: 1, fired: 0 });
  });
});
