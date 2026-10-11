import { describe, expect, it } from "vitest";
import { AI_RUNS_HREF, GENERAL_SECTIONS } from "./general-sections";

describe("GENERAL_SECTIONS", () => {
  it("tiene las secciones en orden (Ventas se suma con la Etapa 5), sin Zona de peligro", () => {
    expect(GENERAL_SECTIONS.map((s) => s.id)).toEqual([
      "workspace",
      "conversaciones",
      "archivos",
      "ventas",
      "ia",
    ]);
  });
});

describe("AI_RUNS_HREF", () => {
  it("apunta a la pantalla global de Corridas (Bloque A+R)", () => {
    expect(AI_RUNS_HREF).toBe("/dashboard/agents/runs");
  });
});
