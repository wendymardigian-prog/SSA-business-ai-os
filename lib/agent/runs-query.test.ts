import { describe, it, expect } from "vitest";
import { countActiveRunFilters, parseRunFilters } from "./runs-query";

/**
 * Los filtros de Runs vienen de la URL: cualquiera los escribe. Lo que no
 * existe se ignora; el agente de la pestana es el default.
 */

const known = {
  currentAgentId: "agent-1",
  agentIds: ["agent-1", "agent-2"],
  channelIds: ["ch-1"],
  toolNames: ["etiquetar_contacto"],
  models: ["claude-sonnet-5"],
  allowCost: true,
};

describe("parseRunFilters", () => {
  it("sin nada en la URL: pagina 1 y el agente de la pestana", () => {
    const f = parseRunFilters({}, known);
    expect(f).toMatchObject({ page: 1, agente: "agent-1", canal: "", resultado: "", modelo: "", accion: "", costoMin: null, costoMax: null });
    expect(countActiveRunFilters(f, "agent-1")).toBe(0);
  });

  it("valores inventados se ignoran; los validos pasan", () => {
    const f = parseRunFilters(
      {
        agente: "agent-x",
        canal: "ch-9",
        resultado: "explotado",
        modelo: "gpt-99",
        accion: "borrar_todo",
        contacto: "no-es-uuid",
        c: "00000000-0000-4000-8000-000000000001",
        costo_min: "-3",
        costo_max: "0.5",
        fecha: "7d",
        page: "3",
        q: "ana, (x)",
      },
      known,
    );
    expect(f).toMatchObject({
      agente: "agent-1",
      canal: "",
      resultado: "",
      modelo: "",
      accion: "",
      contacto: "",
      conversacion: "00000000-0000-4000-8000-000000000001",
      costoMin: null,
      costoMax: 0.5,
      datePreset: "7d",
      page: 3,
      q: "ana x",
    });
  });

  it("'todos' y 'sin-agente' son valores especiales del filtro de agente", () => {
    expect(parseRunFilters({ agente: "todos" }, known).agente).toBe("todos");
    expect(parseRunFilters({ agente: "sin-agente" }, known).agente).toBe("sin-agente");
    expect(parseRunFilters({ agente: "agent-2" }, known).agente).toBe("agent-2");
  });

  it("un Member no puede filtrar por costo", () => {
    const f = parseRunFilters({ costo_min: "1" }, { ...known, allowCost: false });
    expect(f.costoMin).toBeNull();
  });

  it("cuenta los filtros activos (el agente de la pestana no cuenta)", () => {
    const f = parseRunFilters({ agente: "todos", resultado: "responded", fecha: "hoy" }, known);
    expect(countActiveRunFilters(f, "agent-1")).toBe(3);
  });
});
