import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { saveCallTaskSettings } from "./call-task-settings";
import { DEFAULT_ANALYSIS, DEFAULT_CLASSIFICATION } from "@/lib/calls/task-settings";

const ctx = { workspace: { id: "ws1" }, user: { id: "u1" } };

function db(stored: Record<string, unknown> = {}, previous: unknown = null, rpcError: string | null = null) {
  const d = fakeDb(
    { "workspaces:select": { data: { ai_background_settings: stored } } },
    { set_ai_background_task_settings: rpcError ? { error: { message: rpcError } } : { data: previous } },
  );
  mocks.service.mockResolvedValue(d.client);
  return d;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(ctx);
});

describe("saveCallTaskSettings", () => {
  it("pide calls.configure, no ser Admin", async () => {
    db();
    await saveCallTaskSettings("call_classification", DEFAULT_CLASSIFICATION);
    expect(mocks.permission).toHaveBeenCalledWith("calls.configure");
  });

  it("sin permiso no escribe nada", async () => {
    mocks.permission.mockResolvedValue(null);
    const d = db();
    const r = await saveCallTaskSettings("call_classification", DEFAULT_CLASSIFICATION);
    expect(r.ok).toBe(false);
    expect(d.rpcCalls).toHaveLength(0);
  });

  it("una tarea que no es de llamadas se rechaza", async () => {
    const d = db();
    expect((await saveCallTaskSettings("message_classification", {})).ok).toBe(false);
    expect(d.rpcCalls).toHaveLength(0);
  });

  it("una configuracion invalida se rechaza con el motivo y no llega a la base", async () => {
    const d = db();
    const r = await saveCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, rules: [{ id: "x", on: true, cond: "duration_lt", value: 5, type: "no_existe" }] });
    expect(r).toMatchObject({ ok: false });
    expect(d.rpcCalls).toHaveLength(0);
  });

  it("guarda UNA clave con la funcion de la base, para el workspace de la sesion", async () => {
    const d = db();
    const r = await saveCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, confidence_threshold: 0.8 });
    expect(r.ok).toBe(true);
    expect(d.rpcCalls).toHaveLength(1);
    expect(d.rpcCalls[0]).toMatchObject({ name: "set_ai_background_task_settings", args: { p_workspace_id: "ws1", p_task: "call_classification" } });
    expect((d.rpcCalls[0].args as { p_value: { confidence_threshold: number } }).p_value.confidence_threshold).toBe(0.8);
  });

  it("audita sobre el workspace con el antes y el despues de esa clave, y la tarea en metadata", async () => {
    db({}, { mode: "off" });
    await saveCallTaskSettings("call_classification", DEFAULT_CLASSIFICATION);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "workspace",
        entityId: "ws1",
        action: "update",
        performedBy: "u1",
        metadata: expect.objectContaining({ task: "call_classification" }),
        changes: { "ai_background_settings.call_classification": { old: { mode: "off" }, new: expect.any(Object) } },
      }),
    );
  });

  it("sube la version de la rubrica solo si cambia lo que afecta los puntajes, y la informa", async () => {
    const stored = { call_analysis: DEFAULT_ANALYSIS };
    const heavier = structuredClone(DEFAULT_ANALYSIS);
    heavier.rubric.closer[0].peso += 5;
    heavier.rubric.closer[1].peso -= 5;
    db(stored, DEFAULT_ANALYSIS);
    const r = await saveCallTaskSettings("call_analysis", heavier);
    expect(r).toEqual({ ok: true, rubricVersion: DEFAULT_ANALYSIS.rubric.version + 1 });
    expect(mocks.audit.mock.calls[0][0].metadata).toMatchObject({ rubric_version: DEFAULT_ANALYSIS.rubric.version + 1, rubric_scoring_changed: true });

    vi.clearAllMocks();
    mocks.permission.mockResolvedValue(ctx);
    db(stored, DEFAULT_ANALYSIS);
    const same = await saveCallTaskSettings("call_analysis", { ...DEFAULT_ANALYSIS, company_context: "Somos una agencia" });
    expect(same).toEqual({ ok: true, rubricVersion: DEFAULT_ANALYSIS.rubric.version });
  });

  it("una rubrica que no suma 100 se rechaza", async () => {
    const bad = structuredClone(DEFAULT_ANALYSIS);
    bad.rubric.closer[0].peso += 10;
    const d = db({ call_analysis: DEFAULT_ANALYSIS });
    const r = await saveCallTaskSettings("call_analysis", bad);
    expect(r.ok).toBe(false);
    expect(d.rpcCalls).toHaveLength(0);
  });

  it("si la base falla devuelve un error claro, sin detalles tecnicos, y no audita", async () => {
    db({}, null, "boom interno");
    const r = await saveCallTaskSettings("call_classification", DEFAULT_CLASSIFICATION);
    expect(r).toEqual({ ok: false, error: "No pude guardar el cambio." });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refresca las pantallas de Agentes IA y de Llamadas", async () => {
    db();
    await saveCallTaskSettings("call_analysis", DEFAULT_ANALYSIS);
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/agents/tareas/call_analysis");
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/llamadas");
  });
});
