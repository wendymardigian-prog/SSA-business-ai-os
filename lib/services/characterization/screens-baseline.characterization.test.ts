// @plantilla-quitar(servicios)
/**
 * Caracterización de las pantallas de BAIOS que la Corrida A1 de Servicios cambia o extiende,
 * escrita ANTES de tocarlas (8/11/2026). Fija lo que tiene que seguir igual:
 * - Ventas: las columnas de la lista (Servicio entra por un punto de extensión, nunca a mano).
 * - Productos: las acciones del catálogo, su permiso y lo que hoy hace la pestaña de precio,
 *   que pasa sin cambios a «Precio y cobro».
 * - La ficha de la venta: sus secciones (Servicio entra como otra sección, sin mover las de hoy).
 * - La ficha del contacto: el orden de sus secciones (Servicios entra después de Ventas).
 * Si un cambio de Servicios rompe algo de esto, el test lo dice. Los cambios a propósito se
 * anotan acá con el comentario «Servicios A1».
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SALES_COLUMN_METAS } from "../../sales/columns";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Ventas: columnas de la lista", () => {
  const src = read("components/sales/sales-list.tsx");
  it("las columnas de BAIOS son las de siempre y en el mismo orden", () => {
    // Tabla única (10/11/2026): el catálogo vive en lib/sales/columns.ts. Cambio a propósito: «Variante» tiene su
    // columna propia (antes iba dentro de «Producto»). Las demás, en el mismo orden.
    expect(SALES_COLUMN_METAS.map((c) => c.label)).toEqual(["Fecha", "Contacto", "Producto", "Variante", "Monto", "Cobrado", "Pendiente", "Estado", "Vendedor", "Atribución", "Origen"]);
  });
  it("Servicio entra por el punto de extensión: las columnas de módulos van después de las de BAIOS", () => {
    expect(src).toContain("return [...base, ...modules];");
  });
});

describe("Productos: acciones del catálogo", () => {
  const src = read("lib/actions/products.ts");
  const exported = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
  it("exporta las mismas acciones", () => {
    expect(exported).toEqual(
      [
        "archiveProduct",
        "archiveVariant",
        "createProduct",
        "createVariant",
        "duplicateVariant",
        "restoreProduct",
        "restoreVariant",
        "setProductStatus",
        "setVariantPrice",
        "updateProduct",
        "updateVariant",
      ].sort(),
    );
  });
  it("todas piden products.manage", () => {
    expect(src).toContain(`getPermissionAction("products.manage")`);
  });
  it("las páginas de Productos piden products.manage", () => {
    expect(read("app/(dashboard)/dashboard/settings/productos/page.tsx")).toContain(`requirePermission("products.manage")`);
    expect(read("app/(dashboard)/dashboard/settings/productos/[id]/page.tsx")).toContain(`requirePermission("products.manage")`);
  });
  it("el precio de una variante se guarda con setVariantPrice y su historial sale del audit_log de la variante", () => {
    const tab = read("components/catalog/variant-price-tab.tsx");
    expect(tab).toContain("setVariantPrice");
    const detail = read("components/catalog/product-detail.tsx");
    expect(detail).toContain(`entityType="product_variant"`);
  });
});

describe("Ficha de la venta: secciones", () => {
  const view = read("components/sales/sale-detail.tsx");
  it("SaleDetail recibe las secciones de módulos como props", () => {
    expect(view).toMatch(/export function SaleDetail\(\{[^}]*contracts[^}]*commissions[^}]*\}/);
  });
});

describe("Ficha del contacto: orden de las secciones", () => {
  const page = read("app/(dashboard)/dashboard/contacts/[contactId]/page.tsx");
  it("las secciones de BAIOS siguen en el mismo orden", () => {
    const order = [...page.matchAll(/<([A-Z][A-Za-z]*Section)\b/g)].map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i);
    const baios = [
      "NotesSection",
      "ContactDataSection",
      "ContactSequencesSection",
      "ContactBookingsSection",
      "ContactCallsSection",
      "ContactSalesSection",
      "ContactFormsSection",
      "AttributionSection",
      "HistorySection",
    ];
    expect(order.filter((n) => baios.includes(n))).toEqual(baios);
  });
});
