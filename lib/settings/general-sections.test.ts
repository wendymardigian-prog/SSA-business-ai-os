import { describe, expect, it } from "vitest";
import { AI_RUNS_HREF, GENERAL_SECTIONS } from "./general-sections";

describe("GENERAL_SECTIONS", () => {
  it("tiene las cuatro secciones en orden, sin Zona de peligro", () => {
    expect(GENERAL_SECTIONS.map((s) => s.id)).toEqual([
      "workspace",
      "conversaciones",
      "archivos",
      "ia",
    ]);
  });
});

describe("AI_RUNS_HREF", () => {
  it("apunta a la lista de agentes hasta que exista /dashboard/agents/runs", () => {
    expect(AI_RUNS_HREF).toBe("/dashboard/agents");
  });
});
