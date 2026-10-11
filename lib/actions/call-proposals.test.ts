import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("./call-task-settings", () => ({ saveCallTaskSettings: mocks.save }));

import { decideCategoryProposal, decideTypeProposal } from "./call-proposals";
import { DEFAULT_ANALYSIS, DEFAULT_CLASSIFICATION } from "@/lib/calls/task-settings";

const withAccepted = () => {
  const a = structuredClone(DEFAULT_ANALYSIS);
  a.categories.accepted.objeciones = [{ clave: "precio", nombre: "Precio" }];
  return a;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" } });
  mocks.save.mockResolvedValue({ ok: true });
  mocks.service.mockResolvedValue(fakeDb({ "workspaces:select": { data: { ai_background_settings: { call_analysis: withAccepted(), call_classification: DEFAULT_CLASSIFICATION } } } }).client);
});

describe("decideCategoryProposal", () => {
  it("pide calls.configure", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await decideCategoryProposal({ group: "objeciones", key: "x", decision: "discard" })).ok).toBe(false);
    expect(mocks.permission).toHaveBeenCalledWith("calls.configure");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("aceptar suma la categoria con su nombre, por el camino de guardar la configuracion", async () => {
    await decideCategoryProposal({ group: "objeciones", key: "Falta de confianza", decision: "accept", name: "Falta de confianza" });
    const [task, value] = mocks.save.mock.calls[0];
    expect(task).toBe("call_analysis");
    expect(value.categories.accepted.objeciones.map((c: { clave: string }) => c.clave)).toEqual(["precio", "falta_de_confianza"]);
    expect(value.mode).toBe(DEFAULT_ANALYSIS.mode); // el resto de la configuracion sigue igual
  });
  it("unir guarda la union y exige una categoria aceptada de destino", async () => {
    await decideCategoryProposal({ group: "objeciones", key: "costoso", decision: "merge", targetKey: "precio" });
    expect(mocks.save.mock.calls[0][1].categories.merged.objeciones).toEqual({ costoso: "precio" });
    mocks.save.mockClear();
    expect((await decideCategoryProposal({ group: "objeciones", key: "costoso", decision: "merge", targetKey: "no_existe" })).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("descartar la agrega a descartadas", async () => {
    await decideCategoryProposal({ group: "objeciones", key: "ruido", decision: "discard" });
    expect(mocks.save.mock.calls[0][1].categories.discarded.objeciones).toEqual(["ruido"]);
  });
  it("rechaza grupos inexistentes, claves vacias y decisiones raras", async () => {
    expect((await decideCategoryProposal({ group: "otros", key: "x", decision: "discard" })).ok).toBe(false);
    expect((await decideCategoryProposal({ group: "objeciones", key: "", decision: "discard" })).ok).toBe(false);
    expect((await decideCategoryProposal({ group: "objeciones", key: "x", decision: "borrar" as never })).ok).toBe(false);
    expect((await decideCategoryProposal({ group: "objeciones", key: "x", decision: "accept", name: "  " })).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("decideTypeProposal", () => {
  it("aceptar crea un tipo propio; descartar lo manda a descartados", async () => {
    await decideTypeProposal({ name: "Mesa redonda", decision: "accept", description: "Charla grupal" });
    expect(mocks.save.mock.calls[0][0]).toBe("call_classification");
    expect(mocks.save.mock.calls[0][1].custom_types[0]).toMatchObject({ clave: "mesa_redonda", nombre: "Mesa redonda", descripcion: "Charla grupal" });
    await decideTypeProposal({ name: "Ruido", decision: "discard" });
    expect(mocks.save.mock.calls[1][1].discarded_types).toEqual(["Ruido"]);
  });
  it("sin permiso o con nombre invalido no guarda", async () => {
    expect((await decideTypeProposal({ name: "", decision: "accept" })).ok).toBe(false);
    expect((await decideTypeProposal({ name: "x".repeat(61), decision: "accept" })).ok).toBe(false);
    mocks.permission.mockResolvedValue(null);
    expect((await decideTypeProposal({ name: "Algo", decision: "accept" })).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
