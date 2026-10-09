import { describe, expect, it } from "vitest";
import {
  NO_PRODUCT_LABEL,
  NO_PILLAR_LABEL,
  PILLAR_COLORS,
  PRODUCT_STATUSES,
  archivedAtFor,
  checkName,
  checkPrice,
  formatPriceUsd,
  isProductStatus,
  countUsage,
  groupByTaxonomy,
  isValidColor,
  labelFor,
  nextColor,
  normalizeName,
  selectableItems,
  tagFor,
  type TaxonomyItem,
} from "./taxonomy";

const item = (id: string, name: string, archivedAt: string | null = null): TaxonomyItem => ({
  id,
  name,
  archivedAt,
});

describe("normalizeName", () => {
  it("recorta y junta los espacios de adentro", () => {
    expect(normalizeName("  Educativo   y   venta ")).toBe("Educativo y venta");
  });
});

describe("checkName", () => {
  const existing = [item("a", "Educativo"), item("b", "Autoridad")];

  it("acepta un nombre nuevo y lo devuelve normalizado", () => {
    expect(checkName("  Casos  de exito ", existing)).toEqual({ ok: true, name: "Casos de exito" });
  });

  it("rechaza vacio", () => {
    expect(checkName("   ", existing)).toMatchObject({ ok: false });
  });

  it("rechaza mas de 60 caracteres", () => {
    expect(checkName("x".repeat(61), existing)).toMatchObject({ ok: false });
    expect(checkName("x".repeat(60), existing)).toMatchObject({ ok: true });
  });

  it("rechaza un duplicado sin mirar mayusculas ni espacios", () => {
    const result = checkName("  educativo ", existing);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("Educativo");
  });

  it("un archivado libera el nombre: se puede volver a crear", () => {
    const withArchived = [item("a", "Educativo", "2026-10-01T00:00:00Z")];
    expect(checkName("Educativo", withArchived)).toEqual({ ok: true, name: "Educativo" });
  });

  it("renombrar uno a su mismo nombre (con otra mayuscula) no choca consigo mismo", () => {
    expect(checkName("EDUCATIVO", existing, "a")).toEqual({ ok: true, name: "EDUCATIVO" });
  });

  it("renombrar uno al nombre de OTRO si choca", () => {
    expect(checkName("Autoridad", existing, "a")).toMatchObject({ ok: false });
  });
});

describe("colores", () => {
  it("acepta #rrggbb y rechaza el resto", () => {
    expect(isValidColor("#10b981")).toBe(true);
    expect(isValidColor("#FFF")).toBe(false);
    expect(isValidColor("verde")).toBe(false);
    expect(isValidColor("")).toBe(false);
    expect(isValidColor(null)).toBe(false);
  });

  it("nextColor elige el primero de la paleta que no se usa", () => {
    expect(nextColor([])).toBe(PILLAR_COLORS[0]);
    expect(nextColor([PILLAR_COLORS[0], null, PILLAR_COLORS[1]])).toBe(PILLAR_COLORS[2]);
  });

  it("nextColor vuelve a empezar cuando se usaron todos", () => {
    expect(PILLAR_COLORS).toContain(nextColor([...PILLAR_COLORS]));
  });

  it("toda la paleta es valida", () => {
    for (const color of PILLAR_COLORS) expect(isValidColor(color)).toBe(true);
  });
});

describe("selectableItems", () => {
  const items = [item("b", "Beta"), item("a", "Alfa"), item("z", "Zeta", "2026-10-01T00:00:00Z")];

  it("ofrece los no archivados, ordenados por nombre", () => {
    expect(selectableItems(items, null).map((i) => i.name)).toEqual(["Alfa", "Beta"]);
  });

  it("si la pieza ya tiene uno archivado, lo sigue mostrando", () => {
    expect(selectableItems(items, "z").map((i) => i.name)).toEqual(["Alfa", "Beta", "Zeta"]);
  });

  it("un id que ya no existe no inventa una opcion", () => {
    expect(selectableItems(items, "no-existe").map((i) => i.name)).toEqual(["Alfa", "Beta"]);
  });
});

describe("labelFor", () => {
  const items = [item("a", "Educativo"), item("z", "Viejo", "2026-10-01T00:00:00Z")];

  it("devuelve el nombre", () => {
    expect(labelFor(items, "a", NO_PILLAR_LABEL)).toEqual({ label: "Educativo", archived: false });
  });

  it("un archivado se sigue nombrando, marcado", () => {
    expect(labelFor(items, "z", NO_PILLAR_LABEL)).toEqual({ label: "Viejo", archived: true });
  });

  it("sin id o con un id desconocido es 'Sin ...'", () => {
    expect(labelFor(items, null, NO_PILLAR_LABEL)).toEqual({ label: "Sin pilar", archived: false });
    expect(labelFor(items, "x", NO_PRODUCT_LABEL)).toEqual({ label: "Sin producto", archived: false });
  });
});

describe("countUsage", () => {
  it("cuenta cuantas veces aparece cada id y deja los null afuera", () => {
    const counts = countUsage(["a", "a", "b", null, null, null]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.has(null as never)).toBe(false);
  });
});

describe("groupByTaxonomy (F89: lo que no tiene pilar no queda fuera de los conteos)", () => {
  const pillars = [item("a", "Educativo"), item("b", "Autoridad"), item("z", "Viejo", "2026-10-01T00:00:00Z")];
  const rows = [
    { id: 1, pillar: "a" },
    { id: 2, pillar: "a" },
    { id: 3, pillar: null },
    { id: 4, pillar: "z" },
    { id: 5, pillar: "borrado-que-ya-no-existe" },
  ];

  const groups = groupByTaxonomy(rows, (r) => r.pillar, pillars, NO_PILLAR_LABEL);

  it("la suma de los grupos es el total: ninguna fila se pierde", () => {
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(rows.length);
  });

  it("'Sin pilar' junta los null y los ids que ya no existen, y va ultimo", () => {
    const last = groups[groups.length - 1];
    expect(last).toMatchObject({ id: null, label: "Sin pilar", archived: false });
    expect(last.rows.map((r) => r.id)).toEqual([3, 5]);
  });

  it("un pilar archivado en uso sigue siendo un grupo, marcado como archivado", () => {
    expect(groups.find((g) => g.id === "z")).toMatchObject({ label: "Viejo", archived: true });
  });

  it("no muestra los pilares sin filas", () => {
    expect(groups.find((g) => g.id === "b")).toBeUndefined();
  });

  it("includeEmpty los muestra con cero", () => {
    const all = groupByTaxonomy(rows, (r) => r.pillar, pillars, NO_PILLAR_LABEL, { includeEmpty: true });
    expect(all.find((g) => g.id === "b")?.rows).toEqual([]);
  });

  it("sin ninguna fila, no inventa un grupo 'Sin pilar' vacio", () => {
    expect(groupByTaxonomy([], () => null, pillars, NO_PILLAR_LABEL)).toEqual([]);
  });
});

describe("tagFor", () => {
  const items: TaxonomyItem[] = [
    { id: "a", name: "Educativo", archivedAt: null, color: "#10b981" },
    { id: "z", name: "Viejo", archivedAt: "2026-10-01T00:00:00Z" },
  ];

  it("devuelve nombre, color y si esta archivado", () => {
    expect(tagFor(items, "a")).toEqual({ id: "a", name: "Educativo", color: "#10b981", archived: false });
    expect(tagFor(items, "z")).toEqual({ id: "z", name: "Viejo", color: null, archived: true });
  });

  it("sin id o con un id que ya no existe es null, no un hueco", () => {
    expect(tagFor(items, null)).toBeNull();
    expect(tagFor(items, "x")).toBeNull();
  });
});

describe("productos: precio y estado (00134)", () => {
  it("los tres estados, y solo esos", () => {
    expect([...PRODUCT_STATUSES]).toEqual(["active", "inactive", "discontinued"]);
    expect(isProductStatus("inactive")).toBe(true);
    expect(isProductStatus("archived")).toBe(false);
    expect(isProductStatus(null)).toBe(false);
  });

  describe("checkPrice", () => {
    it("acepta un numero o un texto, con hasta dos decimales", () => {
      expect(checkPrice(1500)).toEqual({ ok: true, price: 1500 });
      expect(checkPrice("1500")).toEqual({ ok: true, price: 1500 });
      expect(checkPrice("1500,5")).toEqual({ ok: true, price: 1500.5 });
      expect(checkPrice("49.999")).toEqual({ ok: true, price: 50 });
      expect(checkPrice(0)).toEqual({ ok: true, price: 0 });
    });

    it("el precio es obligatorio", () => {
      expect(checkPrice(null)).toMatchObject({ ok: false, error: "Falta el precio" });
      expect(checkPrice(undefined)).toMatchObject({ ok: false });
      expect(checkPrice("   ")).toMatchObject({ ok: false });
    });

    it("rechaza lo que no es un numero, lo negativo y lo desmedido", () => {
      expect(checkPrice("mil")).toMatchObject({ ok: false });
      expect(checkPrice(Number.NaN)).toMatchObject({ ok: false });
      expect(checkPrice(-1)).toMatchObject({ ok: false });
      expect(checkPrice(10_000_001)).toMatchObject({ ok: false });
      expect(checkPrice(10_000_000)).toMatchObject({ ok: true });
    });
  });

  it("formatPriceUsd: en dolares, y 'Sin precio' para uno anterior a la 00134", () => {
    expect(formatPriceUsd(1500)).toBe("USD 1.500,00");
    expect(formatPriceUsd(0)).toBe("USD 0,00");
    expect(formatPriceUsd(null)).toBe("Sin precio");
  });

  describe("archivedAtFor: estado y archivado van juntos", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    it("activo no tiene archivado", () => {
      expect(archivedAtFor("active", "2026-09-01T00:00:00Z", now)).toBeNull();
    });
    it("inactivo y discontinuado quedan archivados desde ahora", () => {
      expect(archivedAtFor("inactive", null, now)).toBe("2026-10-09T12:00:00.000Z");
      expect(archivedAtFor("discontinued", null, now)).toBe("2026-10-09T12:00:00.000Z");
    });
    it("pasar de inactivo a discontinuado conserva cuando salio de circulacion", () => {
      expect(archivedAtFor("discontinued", "2026-09-01T00:00:00Z", now)).toBe("2026-09-01T00:00:00Z");
    });
  });
});
