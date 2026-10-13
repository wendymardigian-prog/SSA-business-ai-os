import { describe, it, expect } from "vitest";
import { cleanProjectName, listProjects, normalizeProjectKey, shouldOfferCreate } from "./project";

describe("normalizeProjectKey (F9)", () => {
  it("minusculas, espacios colapsados y recortados", () => {
    expect(normalizeProjectKey("  Lanzamiento   Q4 ")).toBe("lanzamiento q4");
  });
  it("ignora acentos y mayusculas", () => {
    expect(normalizeProjectKey("Diseño")).toBe("diseno");
    expect(normalizeProjectKey("DISEÑO")).toBe(normalizeProjectKey("diseno"));
  });
  it("vacio -> null", () => {
    expect(normalizeProjectKey("   ")).toBeNull();
    expect(normalizeProjectKey("")).toBeNull();
    expect(normalizeProjectKey(null)).toBeNull();
    expect(normalizeProjectKey(undefined)).toBeNull();
  });
});

describe("cleanProjectName", () => {
  it("guarda el texto con los espacios colapsados", () => {
    expect(cleanProjectName("  Lanzamiento   Q4 ")).toEqual({ ok: true, project: "Lanzamiento Q4", key: "lanzamiento q4" });
  });
  it("mas de 80 caracteres se rechaza (no se recorta)", () => {
    const r = cleanProjectName("x".repeat(81));
    expect(r.ok).toBe(false);
    expect(cleanProjectName("x".repeat(80)).ok).toBe(true);
  });
  it("vacio queda sin proyecto", () => {
    expect(cleanProjectName("  ")).toEqual({ ok: true, project: null, key: null });
  });
});

describe("listProjects", () => {
  const tasks = [
    { project: "Lanzamiento Q4", project_key: "lanzamiento q4", status: "pending", created_at: "2026-10-02" },
    { project: "lanzamiento q4", project_key: "lanzamiento q4", status: "completed", created_at: "2026-10-03" },
    { project: "Lanzamiento Q4", project_key: "lanzamiento q4", status: "in_progress", created_at: "2026-10-04" },
    { project: "Diseño", project_key: "diseno", status: "pending", created_at: "2026-10-01" },
    { project: null, project_key: null, status: "pending" },
  ];
  it("agrupa por clave, muestra la variante mas usada y cuenta las abiertas", () => {
    expect(listProjects(tasks)).toEqual([
      { key: "diseno", name: "Diseño", openCount: 1 },
      { key: "lanzamiento q4", name: "Lanzamiento Q4", openCount: 2 },
    ]);
  });
  it("en empate gana la variante mas antigua", () => {
    const r = listProjects([
      { project: "Beta", project_key: "beta", status: "pending", created_at: "2026-10-05" },
      { project: "BETA", project_key: "beta", status: "pending", created_at: "2026-10-01" },
    ]);
    expect(r[0].name).toBe("BETA");
  });
  it("ordena alfabeticamente, con acentos en su lugar", () => {
    const r = listProjects([
      { project: "Zeta", project_key: "zeta", status: "pending" },
      { project: "Árbol", project_key: "arbol", status: "pending" },
    ]);
    expect(r.map((p) => p.name)).toEqual(["Árbol", "Zeta"]);
  });
});

describe("shouldOfferCreate", () => {
  const projects = [{ key: "lanzamiento q4" }];
  it("solo si la clave normalizada no existe", () => {
    expect(shouldOfferCreate("Lanzamiento  Q4", projects)).toBe(false);
    expect(shouldOfferCreate("lanzamiento q4", projects)).toBe(false);
    expect(shouldOfferCreate("Otro", projects)).toBe(true);
  });
  it("lo vacio nunca ofrece crear", () => {
    expect(shouldOfferCreate("   ", projects)).toBe(false);
  });
});
