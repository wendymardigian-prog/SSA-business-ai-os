import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const exact = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/provider", () => ({ getExactWorkspaceModel: exact }));

import { withAreaAnalyzerModel } from "./area-analyzer-models";

const TASK = { ok: true, model: {}, provider: "openai", modelId: "tarea", chosen: false } as never;

const dbWith = (agent: Record<string, unknown> | null) => fakeDb({ "agents:select": { data: agent } });

beforeEach(() => {
  vi.clearAllMocks();
  exact.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "del-agente" });
});

describe("withAreaAnalyzerModel", () => {
  it("un área sin analizador (Equipo, sin área) usa el modelo de la tarea y ni lee al agente", async () => {
    const db = dbWith({ provider: "anthropic", model: "x", is_enabled: true });
    expect(await withAreaAnalyzerModel(db.client, "ws", TASK, "equipo")).toBe(TASK);
    expect(await withAreaAnalyzerModel(db.client, "ws", TASK, null)).toBe(TASK);
    expect(db.calls).toHaveLength(0);
  });

  it("el agente del área, encendido y con modelo, aporta el suyo (estricto)", async () => {
    const db = dbWith({ provider: "anthropic", model: "del-agente", is_enabled: true });
    const out = await withAreaAnalyzerModel(db.client, "ws", TASK, "ventas");
    expect(exact).toHaveBeenCalledWith("ws", expect.objectContaining({ provider: "anthropic", modelId: "del-agente" }));
    expect(out).toMatchObject({ modelId: "del-agente", chosen: true });
    // Lee solo al agente de SU área.
    expect(db.calls[0].filters).toEqual(expect.arrayContaining([{ method: "eq", column: "type", value: "sales_analyzer" }]));
  });

  it("el de Servicio solo cuenta para su área", async () => {
    const db = dbWith({ provider: "anthropic", model: "del-agente", is_enabled: true });
    await withAreaAnalyzerModel(db.client, "ws", TASK, "servicio");
    expect(db.calls[0].filters).toEqual(expect.arrayContaining([{ method: "eq", column: "type", value: "service_analyzer" }]));
  });

  it("apagado, sin modelo o inexistente: sigue el modelo de la tarea", async () => {
    for (const agent of [{ provider: "anthropic", model: "x", is_enabled: false }, { provider: null, model: null, is_enabled: true }, null]) {
      expect(await withAreaAnalyzerModel(dbWith(agent).client, "ws", TASK, "ventas")).toBe(TASK);
    }
    expect(exact).not.toHaveBeenCalled();
  });

  it("si su proveedor ya no está conectado falla claro, no cambia de modelo en silencio", async () => {
    exact.mockResolvedValue({ ok: false, model: null, message: "El proveedor no está conectado" });
    const out = await withAreaAnalyzerModel(dbWith({ provider: "anthropic", model: "x", is_enabled: true }).client, "ws", TASK, "ventas");
    expect(out).toMatchObject({ ok: false, message: "El proveedor no está conectado", chosen: true });
  });

  it("si no se puede leer al agente, no frena el análisis", async () => {
    const db = fakeDb({ "agents:select": { error: { message: "boom" } } });
    expect(await withAreaAnalyzerModel(db.client, "ws", TASK, "ventas")).toBe(TASK);
  });
});
