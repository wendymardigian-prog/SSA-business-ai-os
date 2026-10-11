import { describe, expect, it } from "vitest";
import { describeSalesTrigger, getPreset, presetFor, SALES_PRESETS } from "./presets";
import { validateSalesTriggerConfig } from "./triggers";

describe("presetFor", () => {
  it("to_status paid → «Pago cobrado»; con dos estados, el genérico", () => {
    expect(presetFor("payment_status_changed", { to_status: ["paid"] })?.label).toBe("Pago cobrado");
    expect(presetFor("payment_status_changed", { to_status: ["paid", "overdue"] })?.label).toBe("Cambió el estado del pago");
    expect(presetFor("payment_status_changed", { to_status: ["overdue"] })?.label).toBe("Pago vencido (moroso)");
  });
  it("los atajos de venta y el reembolso", () => {
    expect(presetFor("sale_status_changed", { to_status: ["cancelled"] })?.label).toBe("Venta cancelada");
    expect(presetFor("sale_status_changed", { to_status: ["paid"] })?.label).toBe("Venta saldada");
    expect(presetFor("sale_status_changed", {})?.label).toBe("Cambió el estado de la venta");
    expect(presetFor("payment_created", { payment_types: ["refund"], refund_scope: ["total"] })?.label).toBe("Reembolso registrado");
    expect(presetFor("payment_created", {})?.label).toBe("Pago creado");
  });
  it("otros filtros no cambian el nombre del atajo", () => {
    expect(presetFor("payment_status_changed", { to_status: ["paid"], product_ids: ["p1"] })?.label).toBe("Pago cobrado");
  });
  it("un tipo que no es de ventas no tiene atajo", () => {
    expect(presetFor("booking_created", {})).toBeNull();
  });
  it("todo preset guarda una configuración válida de su tipo", () => {
    for (const p of SALES_PRESETS) {
      const base = p.type.endsWith("_due") ? { offset_days: 3, ...p.config } : p.config;
      expect(validateSalesTriggerConfig(p.type, base).ok, p.key).toBe(true);
    }
    expect(getPreset("payment_paid")?.type).toBe("payment_status_changed");
  });
});

describe("describeSalesTrigger", () => {
  it("etiquetas legibles", () => {
    expect(describeSalesTrigger("payment_status_changed", { from_status: ["scheduled"], to_status: ["paid"] })).toBe("Pago: Programado → Cobrado");
    expect(describeSalesTrigger("payment_status_changed", {})).toBe("Pago: cualquiera → cualquiera");
    expect(describeSalesTrigger("sale_status_changed", { to_status: ["cancelled"] })).toContain("Cancelada");
    expect(describeSalesTrigger("payment_before_due", { offset_days: 3, at_time: "09:00" })).toBe("3 días antes del vencimiento, 09:00");
    expect(describeSalesTrigger("payment_before_due", { offset_days: 0 })).toBe("El día del vencimiento, 09:00");
    expect(describeSalesTrigger("payment_after_due", { offset_days: 1 })).toBe("1 día después del vencimiento si sigue impago, 09:00");
    expect(describeSalesTrigger("payment_created", { payment_types: ["refund"] })).toBe("Reembolso registrado");
    expect(describeSalesTrigger("sale_created", { to_status: 5 })).toBe("Venta creada");
    expect(describeSalesTrigger("payment_status_changed", { to_status: ["xx"] })).toBe("Configuración incompleta");
  });
});
