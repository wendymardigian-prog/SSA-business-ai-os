import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ create: vi.fn(), once: vi.fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: mocks.create, createNotificationOnce: mocks.once }));

import { CHANGE_THROTTLE_MINUTES, planCompleted, planCreated, planUpdated, sendTaskNotifications } from "./notifications";
import { NOTIFICATION_DEFINITIONS, linkFor } from "@/lib/notifications/types";

const ME = "me";
const actor = { id: ME, name: "María" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const base = { id: "t1", title: "Enviar propuesta", status: "pending" as const, due_date: "2026-10-20", owner_id: null as string | null, follower_ids: [] as string[] };
const TODAY = "2026-10-13";

beforeEach(() => vi.clearAllMocks());

describe("avisos de Tareas (F17)", () => {
  it("los siete tipos existen con entidad `task` y llevan a la tarea", () => {
    for (const t of ["task_assigned", "task_follow_added", "task_changed", "task_unblocked", "task_date_moved", "task_due_today", "task_overdue"] as const) {
      expect(NOTIFICATION_DEFINITIONS[t].entity).toBe("task");
    }
    expect(linkFor("task", "abc")).toBe("/dashboard/tareas?task=abc");
    expect(linkFor("task", null)).toBe("/dashboard/tareas");
  });

  describe("crear", () => {
    it("avisa al responsable y a cada seguidor, nunca a quien la crea", () => {
      const notices = planCreated({ ...base, owner_id: A, follower_ids: [B, ME] }, actor);
      expect(notices.map((n) => [n.type, n.recipientId])).toEqual([["task_assigned", A], ["task_follow_added", B]]);
      expect(notices[0].title).toBe("María te asignó «Enviar propuesta»");
    });
    it("si se la asigna a si misma, no hay aviso", () => {
      expect(planCreated({ ...base, owner_id: ME }, actor)).toEqual([]);
    });
    it("sin responsable ni seguidores no avisa a nadie (no hay atajo a Owner/Admin)", () => {
      expect(planCreated(base, actor)).toEqual([]);
    });
  });

  describe("editar", () => {
    it("asignar a otra persona: task_assigned para ella; no para quien actua", () => {
      const n = planUpdated({ ...base, owner_id: A }, { ...base, owner_id: B }, actor, TODAY);
      expect(n.find((x) => x.type === "task_assigned")?.recipientId).toBe(B);
      expect(planUpdated({ ...base, owner_id: A }, { ...base, owner_id: ME }, actor, TODAY).some((x) => x.type === "task_assigned")).toBe(false);
    });
    it("seguidores nuevos: task_follow_added solo a los nuevos", () => {
      const n = planUpdated({ ...base, follower_ids: [A] }, { ...base, follower_ids: [A, B, C] }, actor, TODAY);
      expect(n.filter((x) => x.type === "task_follow_added").map((x) => x.recipientId)).toEqual([B, C]);
    });
    it("un cambio de estado o fecha avisa (task_changed) a responsable y seguidores, con tope de 10 minutos", () => {
      const n = planUpdated({ ...base, owner_id: A, follower_ids: [B] }, { ...base, owner_id: A, follower_ids: [B], status: "in_progress" }, actor, TODAY);
      expect(n.map((x) => [x.type, x.recipientId])).toEqual([["task_changed", A], ["task_changed", B]]);
      expect(n.every((x) => x.throttleMinutes === CHANGE_THROTTLE_MINUTES)).toBe(true);
      expect(n[0].body).toBe("Estado: En progreso");
    });
    it("el actor nunca recibe el aviso aunque sea responsable o seguidor", () => {
      const n = planUpdated({ ...base, owner_id: ME, follower_ids: [A] }, { ...base, owner_id: ME, follower_ids: [A], due_date: "2026-10-25" }, actor, TODAY);
      expect(n.map((x) => x.recipientId)).toEqual([A]);
      expect(n[0].body).toBe("Vence el 25/10");
    });
    it("quien ya recibe «te asignaron» no recibe ademas «cambio»", () => {
      const n = planUpdated({ ...base, owner_id: A }, { ...base, owner_id: B, status: "in_progress" }, actor, TODAY);
      expect(n.filter((x) => x.recipientId === B).map((x) => x.type)).toEqual(["task_assigned"]);
    });
    it("un cambio que no es de estado, fecha ni responsable no avisa", () => {
      expect(planUpdated({ ...base, owner_id: A }, { ...base, owner_id: A, title: "Otro titulo" }, actor, TODAY)).toEqual([]);
    });
    it("sacar la fecha se dice", () => {
      const n = planUpdated({ ...base, owner_id: A }, { ...base, owner_id: A, due_date: null }, actor, TODAY);
      expect(n[0].body).toBe("Sin fecha de vencimiento");
    });
  });

  describe("completar", () => {
    const facts = {
      task: { ...base, owner_id: A, follower_ids: [B] },
      moved: [{ row: { ...base, id: "t2", title: "Contrato", owner_id: C, follower_ids: [A] }, toDue: "2026-10-14" }],
      unblocked: [{ task_id: "t2", title: "Contrato", owner_id: C }, { task_id: "t3", title: "Sin dueño", owner_id: null }],
    };
    it("avisa a quien sigue la tarea, a quien queda libre y a quien le movieron la fecha", () => {
      const n = planCompleted(facts, actor, TODAY);
      expect(n.map((x) => `${x.type}:${x.recipientId}:${x.taskId}`).sort()).toEqual(
        ["task_changed:" + A + ":t1", "task_changed:" + B + ":t1", "task_unblocked:" + C + ":t2", "task_date_moved:" + C + ":t2", "task_date_moved:" + A + ":t2"].sort(),
      );
    });
    it("el texto de la fecha movida lleva la fecha nueva y queda en la metadata", () => {
      const moved = planCompleted(facts, actor, TODAY).find((x) => x.type === "task_date_moved");
      expect(moved?.title).toBe("Se movió la fecha de «Contrato» al 14/10");
      expect(moved?.metadata).toEqual({ due_date: "2026-10-14" });
    });
    it("nunca al actor, y una tarea libre sin responsable no avisa a nadie", () => {
      const n = planCompleted({ ...facts, task: { ...base, owner_id: ME } }, actor, TODAY);
      expect(n.some((x) => x.recipientId === ME)).toBe(false);
      expect(n.some((x) => x.taskId === "t3")).toBe(false);
    });
  });

  describe("enviar", () => {
    it("siempre con destinatario concreto y apuntando a la tarea; el tope usa createNotificationOnce por persona", async () => {
      const db = fakeDb().client;
      await sendTaskNotifications(db, "ws1", [
        { type: "task_assigned", recipientId: A, taskId: "t1", title: "x" },
        { type: "task_changed", recipientId: B, taskId: "t1", title: "y", throttleMinutes: 10 },
      ]);
      expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ type: "task_assigned", recipientId: A, entityType: "task", entityId: "t1", workspaceId: "ws1" }));
      expect(mocks.once).toHaveBeenCalledWith(expect.objectContaining({ type: "task_changed", recipientId: B, withinMinutes: 10, perRecipient: true }));
      for (const call of [...mocks.create.mock.calls, ...mocks.once.mock.calls]) expect(call[0].recipientId).toBeTruthy();
    });
    it("un fallo al avisar no lanza", async () => {
      mocks.create.mockRejectedValueOnce(new Error("boom"));
      await expect(sendTaskNotifications(fakeDb().client, "ws1", [{ type: "task_assigned", recipientId: A, taskId: "t1", title: "x" }])).resolves.toBeUndefined();
    });
  });
});
