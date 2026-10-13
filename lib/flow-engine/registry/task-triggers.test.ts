import { describe, expect, it } from "vitest";
import { eventAllowsNoContact, getTrigger, listTriggers, triggerTypesForEvent } from "./index";
import { taskEventPayload } from "@/lib/tasks/automation/payload";
import { makeTask, taskId } from "@/lib/tasks/fixtures";
import type { TriggerEventArgs } from "./types";

const T = makeTask({ id: taskId(1), title: "Enviar propuesta", project: "Q4", project_key: "q4", status: "completed", source: "manual", completed_at: "2026-10-13T18:00:00Z" });
const args = (config: Record<string, unknown>, payload = taskEventPayload(T)): TriggerEventArgs =>
  ({ supabase: {} as never, event: { id: "e1", workspace_id: "ws", event_type: "task_completed", contact_id: null, member_user_id: "u1", payload } as never, config, trigger: {} as never, booking: null }) as TriggerEventArgs;

describe("disparadores de Tareas (F25)", () => {
  it("estan registrados, de evento y prioridad 45, con su tipo de evento y atienden tambien eventos sin contacto", () => {
    for (const type of ["task_completed", "task_overdue"]) {
      const t = getTrigger(type);
      expect(t, type).toBeDefined();
      expect(t?.scope).toBe("event");
      expect(t?.priority).toBe(45);
      expect(t?.eventTypes).toEqual([type]);
      expect(t?.contactOptional).toBe(true);
      // No son `subject: "member"`: con contacto siguen el camino de siempre.
      expect(t?.subject).toBeUndefined();
      expect(eventAllowsNoContact(type)).toBe(true);
    }
  });

  it("ningun otro disparador atiende eventos sin contacto salvo el de fin de dia (que es `member`)", () => {
    const optional = listTriggers().filter((t) => t.contactOptional).map((t) => t.type).sort();
    expect(optional).toEqual(["task_completed", "task_overdue"]);
    expect(eventAllowsNoContact("sale_created")).toBe(false);
    expect(eventAllowsNoContact("booking_created")).toBe(false);
    expect(eventAllowsNoContact("eod_submitted")).toBe(false);
  });

  it("un evento de tarea lo atienden sus disparadores, no el comodin crm_event", () => {
    expect(triggerTypesForEvent("task_completed")).toEqual(["task_completed"]);
    expect(triggerTypesForEvent("task_overdue")).toEqual(["task_overdue"]);
  });

  it("task_completed: con y sin filtros (eventMatches)", async () => {
    const t = getTrigger("task_completed")!;
    expect(await t.eventMatches!(args({}))).toBe(true);
    expect(await t.eventMatches!(args({ projects: ["Q4"] }))).toBe(true);
    expect(await t.eventMatches!(args({ projects: ["Otro"] }))).toBe(false);
    expect(await t.eventMatches!(args({ sources: ["flow"] }))).toBe(false);
    expect(await t.eventMatches!(args({ projects: 7 } as never))).toBe(false);
  });

  it("task_overdue: la clave de idempotencia es por tarea y vencimiento", () => {
    const t = getTrigger("task_overdue")!;
    const a = taskEventPayload(makeTask({ id: taskId(1), due_date: "2026-10-10" }));
    expect(t.dedupeKeyFor!(args({}, a))).toBe(`task:overdue:${taskId(1)}:2026-10-10`);
  });

  it("aporta lo comparable en condiciones (solo texto) y las variables {{task.*}}", async () => {
    const t = getTrigger("task_completed")!;
    const fields = await t.variableSchema!({}, { supabase: {} as never, workspaceId: "ws" });
    expect(fields.every((f) => f.type === "text" && f.path.startsWith("task."))).toBe(true);
    const fake = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: null } }) }) }) }) };
    const vars = (await t.variablesFor!({ ...args({}), supabase: fake as never })) as { task: Record<string, string> };
    expect(vars.task).toMatchObject({ title: "Enviar propuesta", project: "Q4", status: "Completada", owner: "" });
    expect(vars.task.url).toContain(`/dashboard/tareas?task=${T.id}`);
  });
});
