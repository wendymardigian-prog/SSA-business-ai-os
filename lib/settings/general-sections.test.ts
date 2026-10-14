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

import { canOpenGeneral, generalSectionsFor } from "./general-sections";

describe("General partido por permiso (F16)", () => {
  const can = (...keys: string[]) => (key: string) => keys.includes(key);

  it("con settings.general ve General (sin Ventas y cobranza)", () => {
    expect(generalSectionsFor(can("settings.general")).map((s) => s.id)).toEqual(["workspace", "conversaciones", "archivos", "ia"]);
  });

  it("con solo sales.settings ve únicamente «Ventas y cobranza»", () => {
    const sections = generalSectionsFor(can("sales.settings"));
    expect(sections.map((s) => s.id)).toEqual(["ventas"]);
    expect(sections[0].label).toBe("Ventas y cobranza");
  });

  it("Owner y Admin (todas las claves) ven las cinco; quien no tiene ninguna no ve nada", () => {
    expect(generalSectionsFor(can("settings.general", "sales.settings"))).toHaveLength(5);
    expect(generalSectionsFor(can("products.manage"))).toEqual([]);
    expect(canOpenGeneral(can("products.manage"))).toBe(false);
    expect(canOpenGeneral(can("sales.settings"))).toBe(true);
  });
});
