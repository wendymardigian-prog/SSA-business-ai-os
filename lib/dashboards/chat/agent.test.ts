import { describe, expect, it } from "vitest";
import { agentRates, agentSectionMode, firstResponderSlices, weeklyRate, type AgentWeekRow } from "./agent";

describe("agentSectionMode", () => {
  it("completa con Todos y con Agente IA", () => {
    expect(agentSectionMode(null, 10)).toBe("full");
    expect(agentSectionMode("agent", 10)).toBe("full");
  });

  it("se oculta con una persona", () => {
    expect(agentSectionMode("8f1d3c2a-0000-4000-8000-000000000000", 10)).toBe("hidden-author");
  });

  it("tambien se oculta con Automatizaciones y con Fuera del sistema (el bug)", () => {
    expect(agentSectionMode("automations", 10)).toBe("hidden-author");
    expect(agentSectionMode("external", 10)).toBe("hidden-author");
  });

  it("sin conversaciones no muestra 0 %, muestra su propio aviso", () => {
    expect(agentSectionMode(null, 0)).toBe("no-runs");
  });
});

describe("weeklyRate", () => {
  const weeks: AgentWeekRow[] = [
    { week_start: "2026-08-03", new_conversations: 10, acted: 8, took_first: 5, escalated: 2 },
    { week_start: "2026-08-10", new_conversations: 0, acted: 0, took_first: 0, escalated: 0 },
    { week_start: "2026-08-17", new_conversations: 4, acted: 3, took_first: 2, escalated: 1 },
  ];

  it("una semana sin episodios es un hueco, no 0 %", () => {
    expect(weeklyRate(weeks, "acted")).toEqual([80, null, 75]);
  });
});

describe("agentRates", () => {
  const weeks: AgentWeekRow[] = [{ week_start: "2026-09-21", new_conversations: 10, acted: 9, took_first: 7, escalated: 2 }];

  it("arma las tres tarjetas con su porcentaje y cantidad", () => {
    const rates = agentRates({ new_conversations: 100, agent_acted: 86, agent_took_first: 71, agent_escalated: 17 }, weeks);
    expect(rates.map((r) => r.percent)).toEqual([86, 71, 17]);
    expect(rates[0].count).toBe(86);
    expect(rates[0].total).toBe(100);
  });

  it("en Derivó, bajar es lo bueno", () => {
    const rates = agentRates({ new_conversations: 10, agent_acted: 1, agent_took_first: 1, agent_escalated: 1 }, weeks);
    expect(rates.find((r) => r.key === "escalated")?.lessIsBetter).toBe(true);
    expect(rates.find((r) => r.key === "acted")?.lessIsBetter).toBe(false);
  });

  it("sin conversaciones los porcentajes son null, no 0", () => {
    const rates = agentRates({ new_conversations: 0, agent_acted: 0, agent_took_first: 0, agent_escalated: 0 }, []);
    expect(rates.every((r) => r.percent === null)).toBe(true);
  });

  it("sin fila (la consulta no trajo nada) no explota", () => {
    expect(agentRates(null, []).map((r) => r.percent)).toEqual([null, null, null]);
  });
});

describe("firstResponderSlices", () => {
  it("siempre las cinco tajadas, en orden, con su porcentaje", () => {
    const { slices, total } = firstResponderSlices([
      { responder: "agent", episodes: 71 },
      { responder: "automations", episodes: 12 },
      { responder: "team", episodes: 9 },
      { responder: "external", episodes: 3 },
      { responder: "unanswered", episodes: 5 },
    ]);
    expect(total).toBe(100);
    expect(slices.map((s) => s.key)).toEqual(["agent", "automations", "team", "external", "unanswered"]);
    expect(slices[0]).toMatchObject({ label: "Agente IA", percent: 71 });
  });

  it("una tajada que la consulta no trajo vale 0, y con total 0 el porcentaje es null", () => {
    const { slices } = firstResponderSlices([]);
    expect(slices).toHaveLength(5);
    expect(slices[0].episodes).toBe(0);
    expect(slices[0].percent).toBeNull();
  });
});
