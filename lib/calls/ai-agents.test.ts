import { describe, expect, it } from "vitest";
import { callsAiAgents } from "./ai-agents";
import { areaAnalyzerPayload, areaAnalyzersMissing } from "./area-analyzer-agents";

const base = { classification: { mode: "now" as const, activeRules: 11 }, analyzers: [] };

describe("calls/ai-agents", () => {
  it("el clasificador dice si usa IA y cuántas reglas tiene", () => {
    expect(callsAiAgents(base)[0]).toMatchObject({ name: "Clasificador de grabaciones", status: "Automático · 11 reglas sin IA, después IA", tone: "on" });
    expect(callsAiAgents({ ...base, classification: { mode: "off", activeRules: 1 } })[0]).toMatchObject({ status: "Solo reglas · 1 regla (sin IA)", tone: "manual" });
  });

  it("cada analizador de área dice cuántos tipos corren solos y enlaza a su agente", () => {
    const list = callsAiAgents({
      ...base,
      analyzers: [
        { areaKey: "servicio", areaName: "Servicio", agentId: "a1", agentName: "Analizador de reuniones de Servicio", profiles: { auto: 0, manual: 7 } },
        { areaKey: "ventas", areaName: "Ventas", agentId: null, agentName: null, profiles: { auto: 1, manual: 0 } },
        { areaKey: "otros", areaName: "Otros", agentId: null, agentName: null, profiles: { auto: 0, manual: 0 } },
        { areaKey: "mixto", areaName: "Mixto", agentId: "a2", agentName: null, profiles: { auto: 2, manual: 3 } },
      ],
    });
    expect(list[1]).toMatchObject({ name: "Analizador de reuniones de Servicio", status: "7 tipos · a mano", tone: "manual", href: "/dashboard/agents/a1" });
    expect(list[2]).toMatchObject({ name: "Analizador de reuniones de Ventas", status: "1 tipo · en automático", tone: "on", href: "/dashboard/agents/tareas/call_analysis?tab=config" });
    expect(list[3]).toMatchObject({ status: "Sin analizadores: no analiza nada", tone: "off" });
    expect(list[4]).toMatchObject({ status: "2 en automático, 3 a mano", tone: "on" });
    expect(list.at(-1)?.key).toBe("summary");
  });
});

describe("calls/area-analyzer-agents", () => {
  it("dice cuáles faltan, en el orden de la pantalla", () => {
    expect(areaAnalyzersMissing([])).toEqual(["sales_analyzer", "service_analyzer"]);
    expect(areaAnalyzersMissing([{ type: "chat" }, { type: "sales_analyzer" }])).toEqual(["service_analyzer"]);
    expect(areaAnalyzersMissing([{ type: "sales_analyzer" }, { type: "service_analyzer" }])).toEqual([]);
  });
  it("el pedido lleva el modelo de arranque solo si hay una IA conectada, y siempre junto", () => {
    expect(areaAnalyzerPayload(["service_analyzer"], [{ provider: "anthropic", defaultModel: "m1" }])).toEqual([
      { type: "service_analyzer", name: "Analizador de reuniones de Servicio", provider: "anthropic", model: "m1" },
    ]);
    expect(areaAnalyzerPayload(["sales_analyzer"], [])).toEqual([{ type: "sales_analyzer", name: "Analizador de reuniones de Ventas", provider: null, model: null }]);
    expect(areaAnalyzerPayload(["sales_analyzer"], [{ provider: "openai", defaultModel: "" }])).toEqual([{ type: "sales_analyzer", name: "Analizador de reuniones de Ventas", provider: null, model: null }]);
  });
});
