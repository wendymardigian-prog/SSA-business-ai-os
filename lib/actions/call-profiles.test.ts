import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), categories: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/ai-tasks/store", () => ({ loadTaskInstructions: vi.fn().mockResolvedValue({ version: null, text: "texto ventas" }), workspaceOwnStyle: vi.fn() }));
vi.mock("@/lib/scheduling/data/event-types", () => ({ listCategories: mocks.categories, toCategoryRow: (c: unknown) => c }));

import { archiveCallProfile, restoreCallProfileInstructions, saveCallProfile } from "./call-profiles";
import { DEFAULT_GENERAL_RUBRIC } from "@/lib/calls/profiles";
import { DEFAULT_RUBRIC } from "@/lib/calls/rubric";

const TYPE = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const input = (over: Record<string, unknown> = {}) => ({
  categoryId: TYPE,
  shape: "general" as const,
  mode: "manual" as const,
  rules: {},
  rubric: DEFAULT_GENERAL_RUBRIC,
  autoSummary: true,
  autoMemory: true,
  autoKnowledge: false,
  ...over,
});
const saved = (over: Record<string, unknown> = {}) => ({
  id: PROFILE,
  workspace_id: "ws1",
  category_id: TYPE,
  shape: "general",
  mode: "manual",
  rules: {},
  rubric: DEFAULT_GENERAL_RUBRIC,
  auto_summary: true,
  auto_memory: true,
  auto_knowledge: false,
  active_prompt_version: null,
  ...over,
});

let db: ReturnType<typeof fakeDb>;
function setup(tables: Parameters<typeof fakeDb>[0] = {}, allowed = true) {
  db = fakeDb({ "call_analysis_profiles:select": { data: null }, "call_analysis_profiles:insert": { data: { id: PROFILE } }, "call_analysis_profiles:update": { data: [{ id: PROFILE }] }, ...tables });
  mocks.service.mockResolvedValue(db.client);
  mocks.permission.mockResolvedValue(allowed ? { workspace: { id: "ws1" }, user: { id: "u1" } } : null);
}
const writes = (table: string) => db.writesTo(table);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.categories.mockResolvedValue([{ id: TYPE, archived_at: null }]);
});

describe("saveCallProfile", () => {
  it("sin permiso no escribe nada", async () => {
    setup({}, false);
    expect((await saveCallProfile(input())).ok).toBe(false);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("rechaza un tipo que no es del negocio: lo mira con el workspace de la sesion", async () => {
    setup();
    mocks.categories.mockResolvedValue([]);
    expect(await saveCallProfile(input())).toEqual({ ok: false, error: "Esa área o ese tipo ya no existe." });
    expect(mocks.categories).toHaveBeenCalledWith(db.client, "ws1");
    expect(writes("call_analysis_profiles")).toHaveLength(0);
  });

  it("rechaza una rubrica que no suma 100, y al formato de ventas sin lead", async () => {
    setup();
    const bad = structuredClone(DEFAULT_GENERAL_RUBRIC);
    bad.closer[0].peso += 5;
    expect((await saveCallProfile(input({ rubric: bad }))).ok).toBe(false);
    expect(writes("call_analysis_profiles")).toHaveLength(0);
  });

  it("crea el analizador con el workspace de la sesion y en la version 1", async () => {
    setup();
    const r = await saveCallProfile(input());
    expect(r).toEqual({ ok: true, profileId: PROFILE, rubricVersion: 1 });
    const row = writes("call_analysis_profiles")[0].values as Record<string, unknown>;
    expect(row).toMatchObject({ workspace_id: "ws1", category_id: TYPE, shape: "general", mode: "manual", created_by: "u1" });
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({ action: "create", entityType: "ai_task", entityId: PROFILE });
  });

  it("el formato general guarda sin lead", async () => {
    setup();
    await saveCallProfile(input({ rubric: { ...DEFAULT_GENERAL_RUBRIC, lead: DEFAULT_RUBRIC.lead } }));
    const row = writes("call_analysis_profiles")[0].values as { rubric: { lead: unknown[] } };
    expect(row.rubric.lead).toEqual([]);
  });

  it("al crearlo, lo que esperaba este analizador queda pendiente a mano: nada se gasta solo", async () => {
    setup();
    await saveCallProfile(input());
    const update = writes("calls")[0];
    expect(update.values).toEqual({ analysis_status: "pending", analysis_status_reason: "manual" });
    expect(update.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "workspace_id", value: "ws1" }), expect.objectContaining({ column: "analysis_status_reason", value: "no_profile" })]));
  });

  it("la version de la rubrica solo sube si cambian los puntajes", async () => {
    setup({ "call_analysis_profiles:select": { data: saved() } });
    expect(await saveCallProfile(input({ mode: "auto" }))).toMatchObject({ rubricVersion: 1 });
    const heavier = structuredClone(DEFAULT_GENERAL_RUBRIC);
    heavier.closer[0].peso += 5;
    heavier.closer[1].peso -= 5;
    expect(await saveCallProfile(input({ rubric: heavier }))).toMatchObject({ rubricVersion: 2 });
  });

  it("instrucciones iguales a las vigentes no crean una version", async () => {
    setup({ "call_analysis_profiles:select": { data: saved({ shape: "sales", rubric: DEFAULT_RUBRIC }) } });
    await saveCallProfile(input({ shape: "sales", rubric: DEFAULT_RUBRIC, instructions: "texto ventas" }));
    expect(writes("ai_task_prompt_versions")).toHaveLength(0);
  });

  it("instrucciones nuevas crean la version siguiente de ESE analizador y la activan", async () => {
    setup({ "ai_task_prompt_versions:select": { data: { version: 3 } } });
    await saveCallProfile(input({ instructions: "  Mirá la atención.  " }));
    expect(writes("ai_task_prompt_versions")[0].values).toMatchObject({ task: "call_analysis", variant: PROFILE, version: 4, instructions: "Mirá la atención." });
    expect(writes("call_analysis_profiles").some((w) => (w.values as { active_prompt_version?: number }).active_prompt_version === 4)).toBe(true);
  });

  it("instrucciones vacias o gigantes se rechazan", async () => {
    setup();
    expect((await saveCallProfile(input({ instructions: "   " }))).ok).toBe(false);
    expect((await saveCallProfile(input({ instructions: "x".repeat(32_001) }))).ok).toBe(false);
  });
});

describe("restoreCallProfileInstructions", () => {
  it("una version que no existe se rechaza", async () => {
    setup({ "call_analysis_profiles:select": { data: { id: PROFILE, active_prompt_version: 2 } }, "ai_task_prompt_versions:select": { data: null } });
    expect((await restoreCallProfileInstructions({ profileId: PROFILE, version: 9 })).ok).toBe(false);
  });
  it("sin version vuelve al texto por defecto", async () => {
    setup({ "call_analysis_profiles:select": { data: { id: PROFILE, active_prompt_version: 2 } } });
    expect(await restoreCallProfileInstructions({ profileId: PROFILE, version: null })).toEqual({ ok: true });
    expect(writes("call_analysis_profiles")[0].values).toMatchObject({ active_prompt_version: null });
  });
});

describe("archiveCallProfile", () => {
  it("se archiva: no hay borrado, y filtra por el workspace de la sesion", async () => {
    setup();
    expect(await archiveCallProfile({ profileId: PROFILE })).toEqual({ ok: true });
    const w = writes("call_analysis_profiles")[0];
    expect(w.op).toBe("update");
    expect(w.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "workspace_id", value: "ws1" })]));
  });
  it("sin permiso no hace nada", async () => {
    setup({}, false);
    expect((await archiveCallProfile({ profileId: PROFILE })).ok).toBe(false);
  });
});
