import { describe, expect, it } from "vitest";
import { countActiveSalesFilters, parseSalesFilters, PILL_STATUSES, salesFiltersToParams, SALES_PAGE_SIZE, saleListRow, salesQueryFilters, scopeChip } from "./list";

describe("parseSalesFilters", () => {
  it("lee la URL y descarta lo desconocido", () => {
    const f = parseSalesFilters({ pastilla: "con_mora", estado: "paid,inventado,overdue", producto: "p1", utm_source: "instagram", atribucion: "manual", desde: "2026-10-01", hasta: "no-es-fecha", pagina: "3" });
    expect(f).toMatchObject({ pill: "con_mora", status: ["paid", "overdue"], productId: "p1", utmSource: "instagram", attributionType: "manual", from: "2026-10-01", to: null, page: 3 });
    expect(parseSalesFilters({ pastilla: "rara", atribucion: "x", pagina: "-2" })).toMatchObject({ pill: null, attributionType: null, page: 1 });
    expect(SALES_PAGE_SIZE).toBe(50);
  });
});

describe("salesQueryFilters", () => {
  it("«Con mora» lista solo overdue", () => {
    expect(salesQueryFilters(parseSalesFilters({ pastilla: "con_mora" }))).toEqual([{ column: "status", op: "in", value: ["overdue"] }]);
    expect(PILL_STATUSES.canceladas).toContain("cancelled");
  });

  it("producto y variante filtran por el SNAPSHOT (una venta de un producto archivado sigue apareciendo)", () => {
    const filters = salesQueryFilters(parseSalesFilters({ producto: "p1", variante: "v1" }));
    expect(filters).toEqual([
      { column: "product_snapshot->>product_id", op: "eq", value: "p1" },
      { column: "product_snapshot->>variant_id", op: "eq", value: "v1" },
    ]);
  });

  it("los filtros de atribución leen attribution->>source|medium|campaign y el tipo", () => {
    const filters = salesQueryFilters(parseSalesFilters({ utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "octubre", atribucion: "none" }));
    expect(filters.map((f) => f.column)).toEqual(["attribution->>source", "attribution->>medium", "attribution->>campaign", "attribution_type"]);
    expect(filters[2]).toMatchObject({ op: "ilike", value: "%octubre%" });
  });

  it("un campaña con comodines de PostgREST se sanea", () => {
    const [f] = salesQueryFilters(parseSalesFilters({ utm_campaign: "a,b%c(d)" }));
    expect(f.value).toBe("%a b c d %");
  });

  it("rango de fechas de venta", () => {
    expect(salesQueryFilters(parseSalesFilters({ desde: "2026-10-01", hasta: "2026-10-31" }))).toEqual([
      { column: "sale_date", op: "gte", value: "2026-10-01" },
      { column: "sale_date", op: "lte", value: "2026-10-31" },
    ]);
  });
});

describe("saleListRow", () => {
  const sale = { id: "s1", sale_date: "2026-10-10", status: "pending_payment", final_amount: 1250, product_snapshot: { product_name: "Mentoría", variant_name: "Estándar" }, attribution: { source: "instagram", medium: "paid_social", campaign: "octubre" }, attribution_type: "last_touch", contact_id: "c1", vendedor_id: null };
  const now = new Date("2026-10-11T00:00:00Z");

  it("cobrado y pendiente se calculan con saleBalance en céntimos, no con sumas en flotante", () => {
    const row = saleListRow(sale, [416.67, 416.67].map((amount) => ({ amount, status: "paid" })).concat([{ amount: 416.66, status: "scheduled" }]), now, "UTC");
    expect(row).toMatchObject({ paid: 833.34, pending: 416.66, product: "Mentoría" });
  });

  it("la atribución se muestra como «source / medium · campaña», y sin atribución lo dice", () => {
    expect(saleListRow(sale, [], now, "UTC").attribution).toBe("instagram / paid_social · octubre");
    expect(saleListRow({ ...sale, attribution: null, attribution_type: "none" }, [], now, "UTC").attribution).toBe("Sin atribución");
  });

  it("el chip de alcance", () => {
    expect(scopeChip(true)).toBe("Todas las ventas del equipo");
    expect(scopeChip(false)).toBe("Solo tus ventas");
  });
});

describe("filtros ↔ URL", () => {
  it("ida y vuelta: lo que se escribe en la URL se lee igual", () => {
    const f = parseSalesFilters({ pastilla: "esta_semana", estado: "paid,overdue", producto: "p1", variante: "v1", vendedor: "u1", setter: "u2", utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "oct", atribucion: "none", desde: "2026-10-01", hasta: "2026-10-31", q: "ana", pagina: "2" });
    const params = Object.fromEntries(salesFiltersToParams(f).entries());
    expect(parseSalesFilters(params)).toEqual(f);
  });

  it("sin filtros no escribe nada, y los globitos no cuentan pastilla, búsqueda ni página", () => {
    expect(salesFiltersToParams(parseSalesFilters({})).toString()).toBe("");
    expect(countActiveSalesFilters(parseSalesFilters({ pastilla: "con_mora", q: "ana", pagina: "3" }))).toBe(0);
    expect(countActiveSalesFilters(parseSalesFilters({ estado: "paid", producto: "p1", desde: "2026-10-01" }))).toBe(3);
  });
});
