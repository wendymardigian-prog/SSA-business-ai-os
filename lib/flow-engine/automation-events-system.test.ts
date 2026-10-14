/**
 * Eventos SIN contacto ni persona (Tirón 2, D1): un disparador declarado `subject: "system"` corre por su propia rama,
 * sin contacto, sin persona, sin conversación, y la sesión queda con su origen. Los demás eventos siguen su camino de
 * siempre, y ahora le dicen al motor qué los originó (agenda, formulario, persona del equipo...).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({ executeFlow: vi.fn(async () => undefined), audit: vi.fn(async () => null) }));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: mocks.executeFlow }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import "@/lib/flow-engine/registry";
import { registerTrigger } from "@/lib/flow-engine/registry/registry";
import { eventSubject } from "@/lib/flow-engine/registry/registry";
import { processEvent, type AutomationEvent } from "./automation-events";
import { taskEventPayload } from "@/lib/tasks/automation/payload";
import { makeTask, taskId } from "@/lib/tasks/fixtures";

const WS = "ws-1";

// Un disparador de sistema de mentira: todavía no hay uno real, pero el camino tiene que andar cuando llegue el primero.
registerTrigger({
  type: "test_system_trigger",
  label: "Disparador de sistema (test)",
  scope: "event",
  priority: 45,
  subject: "system",
  sourceType: "system",
  eventTypes: ["test_system_event"],
  variablesFor: () => ({ ejemplo: "dato" }),
});

function world(triggerType: string, extra: Record<string, unknown>[] = []) {
  return memoryDb(
    {
      triggers: [{ id: "tr-1", workspace_id: WS, flow_id: "flow-1", channel_id: null, type: triggerType, config: {}, priority: 45, is_active: true, ...extra[0] }],
      conversations: [{ id: "cv-1", channel_id: "ch-1", contact_id: "c-1", deleted_at: null, last_message_at: "2026-10-01T00:00:00Z" }],
      trigger_fires: [],
      bookings: [],
    },
    { unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } },
  );
}

const event = (over: Partial<AutomationEvent> = {}): AutomationEvent =>
  ({ id: "ev-1", workspace_id: WS, event_type: "test_system_event", contact_id: null, member_user_id: null, source_type: "system", source_id: null, payload: { algo: "x" }, ...over }) as AutomationEvent;

const lastContext = () => (mocks.executeFlow.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

describe("un evento de sistema (sin contacto ni persona)", () => {
  it("el registro lo reconoce como de sistema", () => {
    expect(eventSubject("test_system_event")).toBe("system");
  });

  it("corre el flujo SIN contacto, sin persona, sin canal, con su origen y las variables del evento", async () => {
    const db = world("test_system_trigger");
    const fired = await processEvent(db.client as never, event());
    expect(fired).toBe(1);
    expect(lastContext()).toMatchObject({ flowId: "flow-1", triggerId: "tr-1", contactId: null, channelId: "", conversationId: "", workspaceId: WS, source: { type: "system", id: "ev-1" } });
    expect(lastContext()).not.toHaveProperty("memberUserId");
    expect(lastContext().variables).toMatchObject({ event_type: "test_system_event", event_algo: "x", ejemplo: "dato" });
  });

  it("reclama el disparo: procesar el mismo evento dos veces corre el flujo una sola vez", async () => {
    const db = world("test_system_trigger");
    await processEvent(db.client as never, event());
    await processEvent(db.client as never, event());
    expect(mocks.executeFlow).toHaveBeenCalledTimes(1);
    expect(db.rows("trigger_fires")).toHaveLength(1);
    expect(db.rows("trigger_fires")[0]).toMatchObject({ contact_id: null });
  });

  it("sin flujos publicados que lo escuchen, no corre nada (y no lanza)", async () => {
    const db = memoryDb({ triggers: [], trigger_fires: [] });
    expect(await processEvent(db.client as never, event())).toBe(0);
    expect(mocks.executeFlow).not.toHaveBeenCalled();
  });

  it("un evento de sistema NO lo atiende un disparador de otro sujeto", async () => {
    const db = world("crm_event");
    expect(await processEvent(db.client as never, event())).toBe(0);
    expect(mocks.executeFlow).not.toHaveBeenCalled();
  });
});

describe("los demás eventos le dicen al motor qué los originó", () => {
  const T = makeTask({ id: taskId(1), title: "Enviar propuesta", project: "Q4", project_key: "q4", status: "completed", completed_at: "2026-10-13T18:00:00Z", owner_id: "u-owner" });

  it("un evento de tarea CON contacto sigue su camino (contacto y conversación) y lleva el origen `task` con el id del evento", async () => {
    const db = world("task_completed");
    await processEvent(db.client as never, event({ event_type: "task_completed", contact_id: "c-1", source_type: "contact", payload: { ...taskEventPayload(T) } }));
    expect(lastContext()).toMatchObject({ contactId: "c-1", conversationId: "cv-1", channelId: "ch-1", source: { type: "task", id: "ev-1" } });
  });

  it("un reporte de fin de día (persona del equipo) sigue su camino y lleva el origen `member`", async () => {
    const db = world("eod_submitted");
    await processEvent(db.client as never, event({ event_type: "eod_submitted", member_user_id: "u-1", source_type: "member", payload: { report_id: "r-1", form_id: "f-1" } }));
    expect(lastContext()).toMatchObject({ contactId: null, memberUserId: "u-1", source: { type: "member", id: "ev-1" } });
  });

  it("un evento de contacto (contacto nuevo) lleva el origen `contact`", async () => {
    const db = world("new_contact");
    await processEvent(db.client as never, event({ event_type: "contact_created", contact_id: "c-1", source_type: "contact", payload: {} }));
    expect(lastContext()).toMatchObject({ contactId: "c-1", source: { type: "contact", id: "ev-1" } });
  });
});
