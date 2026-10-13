/**
 * El enrutado de `processEvent` para los eventos de Tareas (F25): con contacto, el camino de siempre; sin contacto y con una
 * persona del equipo, la rama de la persona (flujo sin contacto). Los demas eventos no cambian.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({ executeFlow: vi.fn(async () => undefined), audit: vi.fn(async () => null) }));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: mocks.executeFlow }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/workspace-members", () => ({ getWorkspaceMembers: async () => [{ userId: "u-owner", name: "Ana" }], memberDisplayName: (a?: string) => a ?? "" }));

import "@/lib/flow-engine/registry";
import { processEvent, type AutomationEvent } from "./automation-events";
import { taskEventPayload } from "@/lib/tasks/automation/payload";
import { makeTask, taskId } from "@/lib/tasks/fixtures";

const WS = "ws-1";
const T = makeTask({ id: taskId(1), title: "Enviar propuesta", project: "Q4", project_key: "q4", status: "completed", completed_at: "2026-10-13T18:00:00Z", owner_id: "u-owner" });

function world(triggerType = "task_completed", config: Record<string, unknown> = {}) {
  return memoryDb(
    {
      triggers: [{ id: "tr-1", workspace_id: WS, flow_id: "flow-1", channel_id: null, type: triggerType, config, priority: 45, is_active: true }],
      conversations: [{ id: "cv-1", channel_id: "ch-1", contact_id: "c-1", deleted_at: null, last_message_at: "2026-10-01T00:00:00Z" }],
      trigger_fires: [],
      tasks: [{ id: T.id, owner_id: "u-owner" }],
    },
    { unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } },
  );
}

const event = (over: Partial<AutomationEvent> = {}): AutomationEvent => ({
  id: "ev-1", workspace_id: WS, event_type: "task_completed", contact_id: null, member_user_id: "u-owner", payload: taskEventPayload(T), ...over,
}) as AutomationEvent;

beforeEach(() => vi.clearAllMocks());

describe("eventos de tareas sin contacto (F25)", () => {
  it("corre el flujo SIN contacto, sobre la persona del equipo, con las variables del evento y de la tarea", async () => {
    const db = world();
    const fired = await processEvent(db.client as never, event());
    expect(fired).toBe(1);
    expect(mocks.executeFlow).toHaveBeenCalledTimes(1);
    const arg = (mocks.executeFlow.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(arg).toMatchObject({ flowId: "flow-1", triggerId: "tr-1", contactId: null, memberUserId: "u-owner", channelId: "", conversationId: "", workspaceId: WS });
    const vars = arg.variables as Record<string, unknown>;
    expect(vars).toMatchObject({ event_type: "task_completed", event_task_id: T.id, event_title: "Enviar propuesta" });
    expect((vars.task as Record<string, string>)).toMatchObject({ title: "Enviar propuesta", project: "Q4", status: "Completada", owner: "Ana" });
  });

  it("reclama el disparo en trigger_fires: procesar el mismo evento dos veces corre el flujo una sola vez", async () => {
    const db = world();
    await processEvent(db.client as never, event());
    await processEvent(db.client as never, event());
    expect(mocks.executeFlow).toHaveBeenCalledTimes(1);
    expect(db.rows("trigger_fires")).toHaveLength(1);
    expect(db.rows("trigger_fires")[0]).toMatchObject({ contact_id: null });
  });

  it("completar, reabrir y volver a completar (otro completed_at) dispara de nuevo", async () => {
    const db = world();
    await processEvent(db.client as never, event());
    await processEvent(db.client as never, event({ id: "ev-2", payload: { ...taskEventPayload({ ...T, completed_at: "2026-10-14T09:00:00Z" }) } }));
    expect(mocks.executeFlow).toHaveBeenCalledTimes(2);
  });

  it("respeta los filtros del disparador", async () => {
    const db = world("task_completed", { projects: ["Operaciones"] });
    expect(await processEvent(db.client as never, event())).toBe(0);
    expect(mocks.executeFlow).not.toHaveBeenCalled();
    const ok = world("task_completed", { projects: ["Q4"] });
    expect(await processEvent(ok.client as never, event())).toBe(1);
  });

  it("task_overdue sin contacto tambien corre sobre la persona", async () => {
    const db = world("task_overdue");
    await processEvent(db.client as never, event({ event_type: "task_overdue" }));
    expect((mocks.executeFlow.mock.calls[0] as unknown[])[1]).toMatchObject({ contactId: null, memberUserId: "u-owner" });
  });

  it("un evento sin contacto y SIN persona no corre (y no rompe a quien lo procesa por lanzar de forma distinta)", async () => {
    const db = world();
    await expect(processEvent(db.client as never, event({ member_user_id: null }))).rejects.toThrow();
    expect(mocks.executeFlow).not.toHaveBeenCalled();
  });
});

describe("eventos de tareas CON contacto: el camino de siempre (F25)", () => {
  it("corre con el contacto y su conversacion, no por la rama de la persona", async () => {
    const db = world();
    await processEvent(db.client as never, event({ contact_id: "c-1", member_user_id: null }));
    expect(mocks.executeFlow).toHaveBeenCalledTimes(1);
    expect((mocks.executeFlow.mock.calls[0] as unknown[])[1]).toMatchObject({ contactId: "c-1", conversationId: "cv-1", channelId: "ch-1" });
    expect(db.rows("trigger_fires")[0]).toMatchObject({ contact_id: "c-1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "contact", entityId: "c-1", action: "automation_triggered" }));
  });

  it("aunque el evento traiga tambien una persona, con contacto manda el contacto", async () => {
    const db = world();
    await processEvent(db.client as never, event({ contact_id: "c-1", member_user_id: "u-owner" }));
    expect((mocks.executeFlow.mock.calls[0] as unknown[])[1]).toMatchObject({ contactId: "c-1" });
    expect((mocks.executeFlow.mock.calls[0] as unknown[])[1]).not.toHaveProperty("memberUserId");
  });
});

describe("el resto de los eventos no cambia", () => {
  it("un evento de venta sin contacto (no deberia pasar) sigue siendo un error, no se desvia a la rama de la persona", async () => {
    const db = world("sale_created");
    await expect(processEvent(db.client as never, event({ event_type: "sale_created", payload: { sale_id: "s1" } }))).rejects.toThrow(/no trae contacto/);
    expect(mocks.executeFlow).not.toHaveBeenCalled();
  });
});
