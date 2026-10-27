import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  canOpenCell,
  emptyMessage,
  hasMore,
  isCellMetric,
  isCivilDate,
  itemDetails,
  itemHref,
  itemTitle,
  mapDetailRows,
  originLabel,
  panelHint,
  panelTitle,
  type DetailItem,
} from "./ads-crm-detail";

const item = (over: Partial<DetailItem> = {}): DetailItem => ({ itemId: "i-1", contactId: "c-1", contactName: "Ana Pérez", occurredAt: "2026-10-10T15:30:00Z", origin: "dm", detailAt: null, amountCents: null, ...over });
const opts = { timeZone: "America/Costa_Rica", formatMoney: (n: number) => `$${n}` };

describe("mapDetailRows", () => {
  it("el total es el de TODA la lista (no el de la pagina) y los bigint llegan como texto", () => {
    const page = mapDetailRows([
      { item_id: "i-1", contact_id: "c-1", contact_name: "Ana", occurred_at: "2026-10-10T15:30:00Z", origin: "dm", detail_at: null, amount_cents: "12345", total_count: "137" },
      { item_id: "i-2", contact_id: "c-2", contact_name: null, occurred_at: null, origin: null, detail_at: null, amount_cents: null, total_count: 137 },
    ]);
    expect(page.total).toBe(137);
    expect(page.items).toHaveLength(2);
    expect(page.items[0].amountCents).toBe(12345);
    expect(page.items[1].contactName).toBeNull();
  });

  it("una lista vacia (o ausente) tiene total 0", () => {
    expect(mapDetailRows([])).toEqual({ items: [], total: 0 });
    expect(mapDetailRows(null)).toEqual({ items: [], total: 0 });
  });

  it("de a 50 y se sigue mientras falten", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(hasMore(50, 137)).toBe(true);
    expect(hasMore(137, 137)).toBe(false);
  });
});

describe("a donde lleva cada item (las rutas que ya existen)", () => {
  it("un lead lleva a la ficha del contacto", () => {
    expect(itemHref("leads_new", item())).toBe("/dashboard/contacts/c-1");
    expect(itemHref("leads_total", item())).toBe("/dashboard/contacts/c-1");
  });
  it("una agenda lleva a su detalle en la Agenda; una venta, a su pantalla", () => {
    expect(itemHref("bookings", item({ itemId: "b-9" }))).toBe("/dashboard/agenda?agenda=b-9");
    expect(itemHref("sales", item({ itemId: "s-9" }))).toBe("/dashboard/ventas/s-9"); // @plantilla-quitar(ventas)
  });
  it("sin id no hay enlace (y no se inventa uno)", () => {
    expect(itemHref("leads_new", item({ contactId: null }))).toBeNull();
    expect(itemHref("bookings", item({ itemId: null }))).toBeNull();
    expect(itemHref("sales", item({ itemId: null }))).toBeNull(); // @plantilla-quitar(ventas)
  });
});

describe("lo que se muestra", () => {
  it("nombre, fecha del toque y origen", () => {
    expect(itemTitle("leads_new", item())).toBe("Ana Pérez");
    const lines = itemDetails("leads_new", item(), opts);
    expect(lines[0]).toMatch(/^Toque: /);
    expect(lines).toContain("Origen: Mensaje directo");
  });

  it("una agenda suma la fecha de la reunion; una venta, el monto y la fecha", () => {
    const booking = itemDetails("bookings", item({ detailAt: "2026-10-20T14:00:00Z", origin: "booking" }), opts);
    expect(booking.some((l) => l.startsWith("Reunión: "))).toBe(true);
    expect(booking).toContain("Origen: Agenda");
    // @plantilla-desde(ventas)
    const sale = itemDetails("sales", item({ detailAt: "2026-10-12T00:00:00Z", amountCents: 150000 }), opts);
    expect(sale).toContain("Monto: $1500");
    expect(sale.some((l) => l.startsWith("Venta: "))).toBe(true);
    // @plantilla-hasta(ventas)
  });

  it("un lead no muestra reunion ni monto", () => {
    const lines = itemDetails("leads_total", item({ detailAt: "2026-10-20T14:00:00Z", amountCents: 100 }), opts);
    expect(lines.some((l) => l.startsWith("Reunión") || l.startsWith("Monto"))).toBe(false);
  });

  it("sin nombre dice que no tiene, y sin fecha u origen simplemente no los muestra", () => {
    expect(itemTitle("leads_new", item({ contactName: "  " }))).toBe("Contacto sin nombre");
    expect(itemTitle("sales", item({ contactName: null }))).toBe("Venta sin nombre de contacto"); // @plantilla-quitar(ventas)
    expect(itemDetails("leads_new", item({ occurredAt: null, origin: null }), opts)).toEqual([]);
    expect(itemDetails("leads_new", item({ occurredAt: "no es una fecha" }), opts)).toEqual(["Origen: Mensaje directo"]);
  });

  it("los origenes en palabras; uno desconocido, tal cual", () => {
    expect(originLabel("dm")).toBe("Mensaje directo");
    expect(originLabel("webhook")).toBe("Webhook"); // @plantilla-quitar(webhooks)
    // @plantilla-sin(webhooks): expect(originLabel("webhook")).toBe("webhook");
    expect(originLabel("nuevo")).toBe("nuevo");
    expect(originLabel(null)).toBeNull();
  });

  it("el titulo del panel dice la metrica y el objeto (o Total)", () => {
    expect(panelTitle("leads_new", "Video testimonio")).toBe("Leads nuevos · Video testimonio");
    expect(panelTitle("sales", null)).toBe("Ventas · Total"); // @plantilla-quitar(ventas)
    expect(panelTitle("bookings", "  ")).toBe("Agendas · Total");
  });

  it("cada metrica explica que se esta viendo y tiene su estado vacio", () => {
    for (const m of ["leads_new", "leads_total", "bookings", "sales"] as const) { // @plantilla-quitar(ventas)
    // @plantilla-sin(ventas): for (const m of ["leads_new", "leads_total", "bookings"] as const) {
      expect(panelHint(m).length).toBeGreaterThan(20);
      expect(emptyMessage(m)).toMatch(/Ning/);
    }
  });
});

describe("cuando se puede abrir una celda", () => {
  it("solo con una metrica abrible y un numero mayor que cero", () => {
    expect(canOpenCell("leads_new", 3)).toBe(true);
    expect(canOpenCell("leads_new", 0)).toBe(false);
    expect(canOpenCell("sales", null)).toBe(false); // @plantilla-quitar(ventas)
    // @plantilla-sin(ventas): expect(canOpenCell("bookings", null)).toBe(false);
    expect(canOpenCell(undefined, 5)).toBe(false);
  });
});

describe("lo que acepta el servidor", () => {
  it("las cuatro metricas y fechas civiles", () => {
    for (const m of ["leads_new", "leads_total", "bookings", "sales"]) expect(isCellMetric(m)).toBe(true); // @plantilla-quitar(ventas)
    // @plantilla-sin(ventas): for (const m of ["leads_new", "leads_total", "bookings"]) expect(isCellMetric(m)).toBe(true);
    for (const m of ["uf_cash", "cash", "", 3, null]) expect(isCellMetric(m)).toBe(false);
    expect(isCivilDate("2026-10-14")).toBe(true);
    for (const d of ["2026-10-14T00:00:00Z", "14/10/2026", "2026-13-45", "", null, 20261014]) expect(isCivilDate(d), String(d)).toBe(false);
  });
});
