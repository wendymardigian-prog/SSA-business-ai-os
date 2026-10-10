/**
 * Las acciones de las tareas de IA dejan registro en la auditoria.
 *
 * Regresion: `audit_log.entity_id` es un uuid y se le pasaba el id de la tarea
 * ("ads_analysis"): el insert fallaba en silencio y no quedaba ningun registro
 * de quien cambio una instruccion o un modelo.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const logAudit = vi.fn(async (_input: unknown) => "audit-1");
vi.mock("@/lib/audit", () => ({ logAudit: (input: unknown) => logAudit(input) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const updates: unknown[] = [];

function fakeSupabase() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { version: 2 } }) }) }),
            eq: () => ({ maybeSingle: async () => ({ data: { version: 1 } }) }),
          }),
        }),
      }),
      insert: async () => ({ error: null }),
      update: (payload: unknown) => {
        updates.push({ table, payload });
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
}

vi.mock("@/lib/auth/guards", () => ({
  getAdminContext: async () => ({
    workspace: { id: WORKSPACE_ID, ai_task_prompt_active: {}, ai_task_models: {} },
    supabase: fakeSupabase(),
    user: { id: "user-1" },
  }),
}));

vi.mock("@/lib/ai/provider", () => ({
  listConnectedAiProviders: async () => [{ provider: "anthropic", label: "Anthropic", defaultModel: "m", models: ["m"] }],
}));

import { restoreTaskInstructions, saveTaskInstructions, saveTaskModel } from "./ai-tasks";

beforeEach(() => {
  logAudit.mockClear();
  updates.length = 0;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("auditoria de las tareas de IA", () => {
  it("guardar instrucciones audita con un uuid y deja la tarea en metadata", async () => {
    const result = await saveTaskInstructions("ads_analysis", "Resumí en tres puntos.", "nota");
    expect(result).toEqual({ ok: true });
    const call = logAudit.mock.calls[0][0] as { entityId: string; metadata: { task: string } };
    expect(call.entityId).toMatch(UUID);
    expect(call.metadata.task).toBe("ads_analysis");
  });

  it("volver a una version audita con un uuid", async () => {
    const result = await restoreTaskInstructions("ads_analysis", 1);
    expect(result).toEqual({ ok: true });
    const call = logAudit.mock.calls[0][0] as { entityId: string; metadata: { task: string } };
    expect(call.entityId).toMatch(UUID);
    expect(call.metadata.task).toBe("ads_analysis");
  });

  it("elegir un modelo guarda la eleccion y audita con un uuid", async () => {
    const result = await saveTaskModel("ads_analysis", "anthropic", "claude-haiku-4-5");
    expect(result).toEqual({ ok: true });
    expect(updates).toContainEqual({
      table: "workspaces",
      payload: { ai_task_models: { ads_analysis: { provider: "anthropic", model: "claude-haiku-4-5" } } },
    });
    const call = logAudit.mock.calls[0][0] as { entityId: string; action: string; metadata: { task: string } };
    expect(call.entityId).toMatch(UUID);
    expect(call.action).toBe("model_changed");
  });
});

describe("saveTaskModel — validaciones", () => {
  it("null y null: vuelve al modelo del negocio (saca la entrada)", async () => {
    const result = await saveTaskModel("ads_analysis", null, null);
    expect(result).toEqual({ ok: true });
    expect(updates).toContainEqual({ table: "workspaces", payload: { ai_task_models: {} } });
  });

  it("un proveedor que no esta conectado no se guarda", async () => {
    const result = await saveTaskModel("ads_analysis", "openai", "gpt-5");
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("proveedor sin modelo (o al reves) no se guarda", async () => {
    expect((await saveTaskModel("ads_analysis", "anthropic", "")).ok).toBe(false);
    expect((await saveTaskModel("ads_analysis", "", "claude-haiku-4-5")).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("una tarea sin selector de modelo no lo admite", async () => {
    const result = await saveTaskModel("media_description", "anthropic", "claude-haiku-4-5");
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("una tarea que no existe no lo admite", async () => {
    expect((await saveTaskModel("no_existe", "anthropic", "m")).ok).toBe(false);
  });
});
