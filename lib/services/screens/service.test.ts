// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { clientTimelineFilter, defaultServiceStartsOn, newServiceFormIssues, salesServiceCell, serviceActions, serviceAlerts, serviceStartsOnHint } from "./service";

describe("las alertas de la ficha", () => {
  it("salen en orden de gravedad", () => {
    const a = serviceAlerts({
      status: "pending_confirmation",
      overduePayment: true,
      overdueItems: [{ id: "i1", name: "Diagnóstico" }],
      possibleDuplicate: true,
      needsAttentionItems: [{ id: "i2", name: "Clase 3" }],
      saleChanged: true,
      saleId: "s1",
    });
    expect(a.map((x) => x.kind)).toEqual(["overdue_payment", "overdue_item", "pending", "duplicate", "needs_attention", "sale_changed"]);
    expect(a[0].action.href).toBe("/dashboard/ventas/s1");
  });
  it("sin nada, ninguna", () => {
    expect(serviceAlerts({ status: "active", overduePayment: false, overdueItems: [], possibleDuplicate: false, needsAttentionItems: [], saleChanged: false, saleId: null })).toEqual([]);
  });
});

describe("las acciones de la ficha", () => {
  it("ocultan lo que el permiso no da", () => {
    expect(serviceActions("active", () => true)).toEqual(["pause", "extend", "complete", "cancel", "change_phase", "change_owner"]);
    expect(serviceActions("active", (k) => k === "services.extend")).toEqual(["extend"]);
    expect(serviceActions("active", () => false)).toEqual([]);
  });
  it("dependen del estado", () => {
    expect(serviceActions("paused", () => true)).toContain("resume");
    expect(serviceActions("pending_confirmation", () => true)).toEqual(["confirm", "discard"]);
    expect(serviceActions("cancelled", () => true)).toEqual([]);
    expect(serviceActions("completed", () => true)).toEqual(["extend", "change_owner"]);
  });
});

describe("+ Servicio", () => {
  const base = { origin: "courtesy" as const, saleId: "", contactId: "c", variantId: "v", startsOn: "", ownerId: "", reason: "" };
  it("sin venta el motivo es obligatorio", () => {
    expect(newServiceFormIssues(base)).toEqual(["Escribí el motivo (es obligatorio sin venta)."]);
    expect(newServiceFormIssues({ ...base, reason: "regalo" })).toEqual([]);
  });
  it("con origen venta pide la venta y no el motivo", () => {
    expect(newServiceFormIssues({ ...base, origin: "sale" })).toEqual(["Elegí la venta."]);
    expect(newServiceFormIssues({ ...base, origin: "sale", saleId: "s" })).toEqual([]);
  });
});

describe("la celda Servicio de Ventas", () => {
  it("con servicio, renovacion y sin servicio", () => {
    expect(salesServiceCell({ serviceId: "s", status: "active", phaseName: "Implementación", light: "green", extendsProductName: null }, true)).toEqual({
      kind: "service",
      label: "Activo · Implementación",
      light: "green",
      href: "/dashboard/clientes?servicio=s",
    });
    expect(salesServiceCell({ serviceId: "s", status: "active", phaseName: null, light: null, extendsProductName: "Programa" }, true).kind).toBe("extends");
    expect(salesServiceCell(null, true)).toEqual({ kind: "create" });
    expect(salesServiceCell(null, false)).toEqual({ kind: "none" });
  });
});

describe("la actividad del cliente", () => {
  const ev = [
    { id: "1", at: "2026-10-01T00:00:00Z", serviceId: null, kind: "note" },
    { id: "2", at: "2026-11-02T00:00:00Z", serviceId: "s1", kind: "item" },
    { id: "3", at: "2026-11-03T00:00:00Z", serviceId: "s2", kind: "item" },
  ];
  it("todo, por servicio y antes de la venta", () => {
    expect(clientTimelineFilter(ev, { kind: "all" }).map((e) => e.id)).toEqual(["3", "2", "1"]);
    expect(clientTimelineFilter(ev, { kind: "service", serviceId: "s1" }).map((e) => e.id)).toEqual(["2"]);
    expect(clientTimelineFilter(ev, { kind: "before_sale", firstSaleAt: "2026-11-01T00:00:00Z" }).map((e) => e.id)).toEqual(["1"]);
  });
});

describe("fecha de inicio por defecto de «+ Servicio»", () => {
  it("sin evento, hoy en la zona del negocio", () => {
    expect(defaultServiceStartsOn("2026-11-08", null)).toBe("2026-11-08");
    expect(serviceStartsOnHint(null)).toMatch(/hoy/);
  });
  it("con evento, la fecha del evento", () => {
    expect(defaultServiceStartsOn("2026-11-08", "2026-12-01")).toBe("2026-12-01");
    expect(serviceStartsOnHint("2026-12-01")).toMatch(/evento/);
  });
  it("una fecha de evento mal formada no se usa", () => {
    expect(defaultServiceStartsOn("2026-11-08", "01/12/2026")).toBe("2026-11-08");
  });
});
