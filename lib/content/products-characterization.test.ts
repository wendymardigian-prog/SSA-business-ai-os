/**
 * Caracterizacion de Productos y de la clasificacion por producto, ANTES de que
 * Ventas (00160) los pase de `content_offers` a `products`.
 *
 * Fija lo que el usuario ve y lo que Contenido da por hecho:
 *  - los tres estados, su orden y sus etiquetas;
 *  - la pantalla: guarda `settings.manage`, contador de piezas, desplegable de
 *    estado por fila, "Mostrar discontinuados (N)", "Sin piezas";
 *  - que clasificar acepta un producto activo y rechaza uno archivado salvo que
 *    la fila ya lo tuviera.
 *
 * Despues del cambio la fuente de datos pasa a `products`, pero TODO esto tiene
 * que seguir igual: si este test se pone rojo, Contenido o la pantalla cambiaron
 * de comportamiento sin que nadie lo decidiera.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABEL,
  archivedAtFor,
  checkName,
  checkPrice,
  countUsage,
  selectableItems,
} from "./taxonomy";

const PAGE_DIR = join(process.cwd(), "app/(dashboard)/dashboard/settings/productos");
const read = (file: string) => readFileSync(join(PAGE_DIR, file), "utf8");

describe("estados del producto (no cambian)", () => {
  it("son tres, en este orden y con estas etiquetas", () => {
    expect([...PRODUCT_STATUSES]).toEqual(["active", "inactive", "discontinued"]);
    expect(PRODUCT_STATUS_LABEL).toEqual({ active: "Activo", inactive: "Inactivo", discontinued: "Discontinuado" });
  });

  it("estado y archivado van juntos: activo = sin archivar", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(archivedAtFor("active", "2026-10-01T00:00:00Z", now)).toBeNull();
    expect(archivedAtFor("inactive", null, now)).toBe(now.toISOString());
    // Pasar de inactivo a discontinuado no mueve la fecha en que se archivo.
    expect(archivedAtFor("discontinued", "2026-10-01T00:00:00Z", now)).toBe("2026-10-01T00:00:00Z");
  });
});

describe("selector de Contenido", () => {
  const items = [
    { id: "a", name: "Activo", archivedAt: null },
    { id: "b", name: "Inactivo", archivedAt: "2026-10-01T00:00:00Z" },
  ];
  it("ofrece solo los activos, pero conserva el que la fila ya tiene", () => {
    expect(selectableItems(items, null).map((i) => i.id)).toEqual(["a"]);
    expect(selectableItems(items, "b").map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("el nombre es unico entre los activos, sin mirar mayusculas ni espacios", () => {
    expect(checkName("  ACTIVO ", items)).toMatchObject({ ok: false });
    expect(checkName("Inactivo", items)).toMatchObject({ ok: true });
  });

  it("el precio es obligatorio, no negativo y en USD", () => {
    expect(checkPrice("3000")).toEqual({ ok: true, price: 3000 });
    expect(checkPrice("")).toMatchObject({ ok: false });
    expect(checkPrice("-1")).toMatchObject({ ok: false });
  });

  it("cuenta cuantas piezas usan cada producto", () => {
    const uses = countUsage(["a", "a", null, "b"]);
    expect(uses.get("a")).toBe(2);
    expect(uses.get("b")).toBe(1);
    expect(uses.get("zzz") ?? 0).toBe(0);
  });
});

describe("pantalla Ajustes > Productos (lo que se conserva)", () => {
  it("la pagina pide settings.manage y cuenta las piezas que usan cada producto (ahora en el cargador del catalogo)", () => {
    const page = read("page.tsx");
    expect(page).toContain('requirePermission("settings.manage")');
    expect(page).toContain("loadProductList");
    const loader = readFileSync(join(process.cwd(), "lib/sales/catalog/load.ts"), "utf8");
    expect(loader).toContain("pieceClassification");
    expect(loader).toContain("countUsage");
  });

  it("la vista muestra el desplegable de estado por fila, el contador y el filtro de discontinuados", () => {
    const view = read("productos-view.tsx");
    expect(view).toContain("PRODUCT_STATUSES.map");
    expect(view).toContain("PRODUCT_STATUS_LABEL");
    expect(view).toContain("Mostrar discontinuados (");
    expect(view).toContain("Ocultar discontinuados");
    expect(view).toContain("piecesLabel(product.pieces)");
    expect(view).toContain("SettingsTabs");
  });

  // Con Ventas (F3) la lógica de orden, filtro y "Sin piezas" pasó de la vista a
  // funciones puras (lib/sales/catalog/products.ts), con su propio test.
  it("el orden y el texto del contador siguen siendo los de siempre (ahora en funciones puras)", () => {
    const view = read("productos-view.tsx");
    expect(view).toContain("sortProducts(products)");
    expect(view).toContain("visibleProducts(sorted, showDiscontinued)");
    const logic = readFileSync(join(process.cwd(), "lib/sales/catalog/products.ts"), "utf8");
    expect(logic).toContain("{ active: 0, inactive: 1, discontinued: 2 }");
    expect(logic).toContain('localeCompare(b.name, "es")');
    expect(logic).toContain('"Sin piezas"');
  });
});
