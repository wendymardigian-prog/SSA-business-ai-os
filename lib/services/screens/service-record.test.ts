// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { daysSinceLogin, lightSignals, overdueSteps, recordAlerts, type RecordPortalState } from "./service-record";
import type { ServiceAlertInput } from "./service";

const base: ServiceAlertInput = { status: "active", overduePayment: false, overdueItems: [], possibleDuplicate: false, needsAttentionItems: [], saleChanged: false, saleId: "v1" };
const noPortal: RecordPortalState = { hasPortal: false, accountStatus: null, lastLoginAt: null, inviteSentAt: null, accessExpiringOn: null };
const portal: RecordPortalState = { hasPortal: true, accountStatus: "active", lastLoginAt: "2026-11-01T10:00:00Z", inviteSentAt: null, accessExpiringOn: null };

describe("recordAlerts", () => {
  it("primero las entregas, después el pago, los accesos, la invitación y el no entrar", () => {
    const a = recordAlerts({
      base: { ...base, status: "pending_confirmation" },
      pendingReviews: 2,
      payment: { kind: "overdue", dueOn: "2026-11-01", daysLate: 9, amountCents: 1, index: 2, total: 3 },
      saleId: "v1",
      portal: { ...portal, accessExpiringOn: "2026-11-14" },
      loginDays: 9,
      today: "2026-11-10",
    });
    // Por confirmar no tiene accesos, invitación ni ingreso que avisar: el servicio todavía no corre.
    expect(a.map((x) => x.kind)).toEqual(["reviews", "payment", "pending"]);
    expect(a[0]).toMatchObject({ text: "2 entregas por revisar.", action: { command: "review" } });
    expect(a[1]).toMatchObject({ text: "Pago vencido hace 9 días (cuota 2 de 3).", action: { href: "/dashboard/ventas/v1" } });
  });
  it("con el servicio activo suma accesos, invitación sin entrar y días sin entrar (desde 5)", () => {
    const a = recordAlerts({ base, pendingReviews: 0, payment: null, saleId: null, portal: { ...portal, accountStatus: "invited", lastLoginAt: null, inviteSentAt: "2026-11-04T10:00:00Z", accessExpiringOn: "2026-11-14" }, loginDays: null, today: "2026-11-10" });
    expect(a.map((x) => x.kind)).toEqual(["access", "invite"]);
    expect(a[1].text).toBe("Lo invitaste al portal hace 6 días y todavía no entró.");
    expect(recordAlerts({ base, pendingReviews: 0, payment: null, saleId: null, portal, loginDays: 4, today: "2026-11-10" })).toEqual([]);
    expect(recordAlerts({ base, pendingReviews: 0, payment: null, saleId: null, portal, loginDays: 5, today: "2026-11-10" })[0]).toMatchObject({ kind: "inactive", tone: "warn" });
    expect(recordAlerts({ base, pendingReviews: 0, payment: null, saleId: null, portal, loginDays: 20, today: "2026-11-10" })[0]).toMatchObject({ kind: "inactive", tone: "bad" });
  });
  it("un producto sin portal no muestra nada del portal", () => {
    const a = recordAlerts({ base, pendingReviews: 3, payment: null, saleId: null, portal: { ...noPortal, accessExpiringOn: "2026-11-11" }, loginDays: 30, today: "2026-11-10" });
    expect(a).toEqual([]);
  });
  it("los pasos vencidos no van en las alertas (los avisa el camino)", () => {
    const a = recordAlerts({ base: { ...base, overdueItems: [{ id: "i", name: "Llamada" }] }, pendingReviews: 0, payment: null, saleId: null, portal: noPortal, loginDays: null, today: "2026-11-10" });
    expect(a).toEqual([]);
  });
});

describe("lightSignals", () => {
  it("fase, pasos, pagos, entregas y portal, cada una con su color", () => {
    const s = lightSignals({ phase: { name: "Implementación", days: 10, yellowDay: 8, redDay: 14 }, overdueItems: 1, payment: { kind: "paid", label: "Pagado" }, pendingReviews: 1, portal, loginDays: 0 });
    expect(s).toEqual([
      { key: "phase", label: "Fase 10 días", tone: "warn" },
      { key: "items", label: "1 paso vencido", tone: "bad" },
      { key: "payments", label: "Pagado", tone: "good" },
      { key: "reviews", label: "1 entrega por revisar", tone: "warn" },
      { key: "portal", label: "Portal: hoy", tone: "good" },
    ]);
  });
  it("sin portal no hay entregas ni portal; sin cuotas no hay pagos", () => {
    const s = lightSignals({ phase: null, overdueItems: 0, payment: null, pendingReviews: 4, portal: noPortal, loginDays: 30 });
    expect(s.map((x) => x.key)).toEqual(["items"]);
  });
});

describe("daysSinceLogin y overdueSteps", () => {
  it("días desde el último ingreso en fechas civiles", () => {
    expect(daysSinceLogin("2026-11-01T23:30:00Z", "2026-11-10", (iso) => iso.slice(0, 10))).toBe(9);
    expect(daysSinceLogin(null, "2026-11-10", (iso) => iso)).toBeNull();
  });
  it("los pasos vencidos, del más viejo al más nuevo", () => {
    const items = [
      { id: "a", status: "pending", dueOn: "2026-11-08" },
      { id: "b", status: "completed", dueOn: "2026-11-01" },
      { id: "c", status: "pending", dueOn: "2026-11-02" },
      { id: "d", status: "pending", dueOn: "2026-11-10" },
      { id: "e", status: "pending", dueOn: null },
    ];
    expect(overdueSteps(items, "2026-11-10").map((i) => i.id)).toEqual(["c", "a"]);
  });
});
