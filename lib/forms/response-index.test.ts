import { describe, expect, it } from "vitest";
import {
  NO_VALUE,
  availableDimensions,
  dimensionValue,
  facetOptions,
  filterIndex,
  groupCounts,
  matchesSearch,
  phoneFieldKey,
  type IndexRow,
} from "./response-index";

const row = (name: string, phone: string | null, attribution: Record<string, string> = {}): IndexRow => ({
  answers: {
    nombre: { label: "Nombre", type: "short_text", value: name },
    ...(phone ? { whatsapp: { label: "WhatsApp", type: "phone", value: phone } } : {}),
  },
  attribution,
});

const ROWS: IndexRow[] = [
  row("Persona Uno", "+51930000001", { utm_source: "meta", utm_medium: "paid", utm_campaign: "clase", utm_content: "ad-1" }),
  row("Persona Dos", "+51930000002", { utm_source: "meta", utm_medium: "paid", utm_campaign: "clase", utm_content: "ad-2" }),
  row("Persona Tres", "+528130000003", { utm_source: "meta", utm_medium: "paid", utm_campaign: "clase", utm_content: "ad-1" }),
  row("Persona Cuatro", "+5491122334455", { utm_source: "ig" }),
  row("Canción Prueba", null),
];
const PHONE = "whatsapp";

describe("phoneFieldKey y las dimensiones", () => {
  it("el pais sale de la primera pregunta de telefono; sin ninguna no hay pais", () => {
    expect(phoneFieldKey([{ key: "nombre", type: "short_text" }, { key: "whatsapp", type: "phone" }, { key: "otro", type: "phone" }])).toBe("whatsapp");
    expect(phoneFieldKey([{ key: "nombre", type: "short_text" }])).toBeNull();
    expect(availableDimensions(null)).not.toContain("pais");
    expect(availableDimensions(PHONE)).toContain("pais");
  });

  it("lo que no tiene dato cae en el grupo sin valor", () => {
    expect(dimensionValue(ROWS[0], "pais", PHONE)).toBe("PE");
    expect(dimensionValue(ROWS[4], "pais", PHONE)).toBe(NO_VALUE);
    expect(dimensionValue(ROWS[3], "medio", PHONE)).toBe(NO_VALUE);
  });
});

describe("matchesSearch", () => {
  it("sin acentos ni mayusculas, en las respuestas y en la campaña", () => {
    expect(matchesSearch(ROWS[4], "CANCION")).toBe(true);
    expect(matchesSearch(ROWS[0], "AD-1")).toBe(true);
    expect(matchesSearch(ROWS[0], "cuatro")).toBe(false);
  });

  it("un telefono se encuentra escrito con espacios o guiones", () => {
    expect(matchesSearch(ROWS[3], "11 2233-4455")).toBe(true);
    expect(matchesSearch(ROWS[3], "9999 9999")).toBe(false);
  });
});

describe("filterIndex", () => {
  it("entre valores de una dimension, cualquiera; entre dimensiones, todas", () => {
    expect(filterIndex(ROWS, { q: "", dims: { pais: ["PE", "MX"] } }, PHONE)).toHaveLength(3);
    expect(filterIndex(ROWS, { q: "", dims: { pais: ["PE", "MX"], fuente: ["ig"] } }, PHONE)).toHaveLength(0);
    expect(filterIndex(ROWS, { q: "", dims: { contenido: ["ad-1"] } }, PHONE)).toHaveLength(2);
    expect(filterIndex(ROWS, { q: "", dims: { pais: [NO_VALUE] } }, PHONE)).toEqual([ROWS[4]]);
    expect(filterIndex(ROWS, { q: "uno", dims: { pais: ["PE"] } }, PHONE)).toEqual([ROWS[0]]);
  });

  it("sin pregunta de telefono, el filtro de pais no cuenta", () => {
    expect(filterIndex(ROWS, { q: "", dims: { pais: ["PE"] } }, null)).toHaveLength(ROWS.length);
  });
});

describe("groupCounts", () => {
  it("la suma de los grupos es el total, de mayor a menor y sin dato al final", () => {
    const groups = groupCounts(ROWS, "pais", PHONE);
    expect(groups.map((g) => g.value)).toEqual(["PE", "AR", "MX", NO_VALUE]);
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(ROWS.length);
    expect(groups[0]).toMatchObject({ label: "🇵🇪 Perú", count: 2, pct: 40 });
    expect(groups.at(-1)?.label).toBe("Sin país");
  });

  it("las UTM agrupan por su texto", () => {
    const groups = groupCounts(ROWS, "fuente", PHONE);
    expect(groups.map((g) => [g.value, g.count])).toEqual([["meta", 3], ["ig", 1], [NO_VALUE, 1]]);
    expect(groups.at(-1)?.label).toBe("Sin dato");
  });

  it("sin respuestas no hay grupos", () => {
    expect(groupCounts([], "pais", PHONE)).toEqual([]);
  });
});

describe("facetOptions", () => {
  it("solo los valores que existen, con su cantidad", () => {
    expect(facetOptions(ROWS, "medio", PHONE)).toEqual([
      { value: "paid", label: "paid (3)" },
      { value: NO_VALUE, label: "Sin dato (2)" },
    ]);
  });
});
