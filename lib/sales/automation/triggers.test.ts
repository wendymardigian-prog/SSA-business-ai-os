import { describe, expect, it } from "vitest";
import {
  isSalesTriggerType, planPaymentRelativeJobs, salesDedupeKey, salesEventMatches, validateSalesTriggerConfig, SALES_TRIGGER_TYPES,
} from "./triggers";

describe("configuración", () => {
  it("vacío vale, lo desconocido se descarta y lo roto devuelve el motivo", () => {
    expect(validateSalesTriggerConfig("sale_created", {})).toEqual({ ok: true, config: {} });
    expect(validateSalesTriggerConfig("sale_created", { product_ids: ["p1"], basura: 1, utm_sources: [] })).toEqual({ ok: true, config: { product_ids: ["p1"] } });
    expect(validateSalesTriggerConfig("payment_status_changed", { to_status: ["inventado"] })).toMatchObject({ ok: false });
    expect(validateSalesTriggerConfig("payment_before_due", { offset_days: 31 })).toMatchObject({ ok: false });
    expect(validateSalesTriggerConfig("payment_after_due", { offset_days: 0 })).toMatchObject({ ok: false });
    expect(validateSalesTriggerConfig("payment_before_due", { offset_days: 0, at_time: "09:00" }).ok).toBe(true);
    expect(validateSalesTriggerConfig("payment_before_due", { offset_days: 3, at_time: "9am" })).toMatchObject({ ok: false });
    expect(validateSalesTriggerConfig("nope", {})).toMatchObject({ ok: false });
  });
  it("los seis tipos son reconocidos", () => {
    expect(SALES_TRIGGER_TYPES).toHaveLength(6);
    expect(isSalesTriggerType("payment_after_due")).toBe(true);
    expect(isSalesTriggerType("booking_created")).toBe(false);
  });
});

describe("sale_created", () => {
  const payload = { product_id: "A", variant_id: "vA", vendedor_id: "u1", financing_type: "full", final_amount: 1297, attribution_type: "last_touch", utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "Octubre Promo" };
  it("un flujo filtrado al producto B no arranca con una venta del A; con filtro vacío o que incluye A, sí", () => {
    expect(salesEventMatches("sale_created", { product_ids: ["B"] }, payload)).toBe(false);
    expect(salesEventMatches("sale_created", {}, payload)).toBe(true);
    expect(salesEventMatches("sale_created", { product_ids: ["A", "B"] }, payload)).toBe(true);
  });
  it("filtra por UTM, atribución, monto y financiamiento", () => {
    expect(salesEventMatches("sale_created", { utm_sources: ["instagram"], utm_campaign_contains: "octubre" }, payload)).toBe(true);
    expect(salesEventMatches("sale_created", { utm_sources: ["tiktok"] }, payload)).toBe(false);
    expect(salesEventMatches("sale_created", { attribution_types: ["manual"] }, payload)).toBe(false);
    expect(salesEventMatches("sale_created", { min_amount: 1000, max_amount: 1500 }, payload)).toBe(true);
    expect(salesEventMatches("sale_created", { min_amount: 2000 }, payload)).toBe(false);
    expect(salesEventMatches("sale_created", { financing_types: ["subscription"] }, payload)).toBe(false);
  });
  it("una configuración rota no dispara para nadie", () => {
    expect(salesEventMatches("sale_created", { attribution_types: ["inventado"] }, payload)).toBe(false);
  });
});

describe("estados", () => {
  it("«Pago cobrado» (→ paid) no corre con un pago que pasa a moroso", () => {
    expect(salesEventMatches("payment_status_changed", { to_status: ["paid"] }, { from_status: "scheduled", to_status: "overdue" })).toBe(false);
    expect(salesEventMatches("payment_status_changed", { to_status: ["paid"] }, { from_status: "scheduled", to_status: "paid" })).toBe(true);
    expect(salesEventMatches("payment_status_changed", { to_status: ["overdue"] }, { from_status: "scheduled", to_status: "overdue" })).toBe(true);
  });
  it("revertir (paid → scheduled) emite from paid y un flujo «→ Cobrado» NO corre", () => {
    expect(salesEventMatches("payment_status_changed", { to_status: ["paid"] }, { from_status: "paid", to_status: "scheduled" })).toBe(false);
    expect(salesEventMatches("payment_status_changed", { from_status: ["paid"] }, { from_status: "paid", to_status: "scheduled" })).toBe(true);
  });
  it("lo que nace cobrado trae to_status pero no from_status: un filtro por «desde» no coincide", () => {
    expect(salesEventMatches("payment_status_changed", { to_status: ["paid"] }, { to_status: "paid" })).toBe(true);
    expect(salesEventMatches("payment_status_changed", { from_status: ["scheduled"] }, { to_status: "paid" })).toBe(false);
  });
  it("sale_status_changed: motivo y desde/hacia", () => {
    expect(salesEventMatches("sale_status_changed", { to_status: ["cancelled"], reasons_contains: "arrepin" }, { from_status: "paid", to_status: "cancelled", reason: "Se arrepintió" })).toBe(true);
    expect(salesEventMatches("sale_status_changed", { reasons_contains: "arrepin" }, { to_status: "cancelled" })).toBe(false);
  });
  it("atraso mínimo y monto", () => {
    expect(salesEventMatches("payment_status_changed", { to_status: ["paid"], min_delay_days: 5 }, { to_status: "paid", delay_days: 7 })).toBe(true);
    expect(salesEventMatches("payment_status_changed", { to_status: ["paid"], min_delay_days: 5 }, { to_status: "paid", delay_days: 2 })).toBe(false);
    expect(salesEventMatches("payment_status_changed", { min_delay_days: 5 }, { to_status: "paid" })).toBe(false);
    expect(salesEventMatches("payment_status_changed", { min_amount: 100 }, { amount: 50 })).toBe(false);
  });
});

describe("payment_created", () => {
  it("«Reembolso registrado» y su alcance", () => {
    expect(salesEventMatches("payment_created", { payment_types: ["refund"] }, { payment_type: "refund", refund_scope: "partial" })).toBe(true);
    expect(salesEventMatches("payment_created", { payment_types: ["refund"], refund_scope: ["total"] }, { payment_type: "refund", refund_scope: "partial" })).toBe(false);
    expect(salesEventMatches("payment_created", { payment_types: ["refund"] }, { payment_type: "installment" })).toBe(false);
  });
});

describe("relativos", () => {
  it("el evento lleva el id de SU trigger: otro trigger no lo atiende", () => {
    const cfg = { offset_days: 3 };
    expect(salesEventMatches("payment_before_due", cfg, { trigger_id: "t1" }, "t1")).toBe(true);
    expect(salesEventMatches("payment_before_due", cfg, { trigger_id: "t1" }, "t2")).toBe(false);
    expect(salesEventMatches("payment_before_due", cfg, { trigger_id: "t1" })).toBe(false);
  });
});

describe("clave de idempotencia", () => {
  it("<tipo>:<change_id>, o el evento si no lo trae", () => {
    expect(salesDedupeKey("payment_status_changed", { change_id: "c1" }, "e1")).toBe("payment_status_changed:c1");
    expect(salesDedupeKey("payment_created", {}, "e9")).toBe("payment_created:e9");
  });
  it("los relativos: <tipo>:<trigger>:<pago>:<reprogramaciones>", () => {
    expect(salesDedupeKey("payment_before_due", { trigger_id: "t1", payment_id: "p1", reschedule_count: 2 }, "e")).toBe("payment_before_due:t1:p1:2");
  });
});

describe("planPaymentRelativeJobs", () => {
  const tz = "America/Costa_Rica";
  const payment = { id: "p1", type: "installment", status: "scheduled", due_date: "2026-10-26", reschedule_count: 0, product_id: "A" };
  const before3 = { id: "t1", type: "payment_before_due", config: { offset_days: 3, at_time: "09:00" } };
  const now = new Date("2026-10-11T12:00:00Z");

  it("3 días antes a las 09:00: el job cae el 23/10 09:00 en la zona del workspace", () => {
    const [job] = planPaymentRelativeJobs(payment, [before3], tz, now);
    expect(job).toMatchObject({ triggerId: "t1", dedupeKey: "rel:t1:p1:0", runAt: "2026-10-23T15:00:00.000Z" }); // 09:00 CR (UTC−6)
  });
  it("un pago creado hoy que vence mañana no genera el de 3 días antes", () => {
    expect(planPaymentRelativeJobs({ ...payment, due_date: "2026-10-12" }, [before3], tz, now)).toEqual([]);
  });
  it("después del vencimiento: +N días", () => {
    const after = { id: "t2", type: "payment_after_due", config: { offset_days: 3 } };
    expect(planPaymentRelativeJobs(payment, [after], tz, now)[0].runAt).toBe("2026-10-29T15:00:00.000Z");
  });
  it("lo cobrado, anulado o un reembolso no recibe recordatorios; el filtro por producto manda", () => {
    expect(planPaymentRelativeJobs({ ...payment, status: "paid" }, [before3], tz, now)).toEqual([]);
    expect(planPaymentRelativeJobs({ ...payment, type: "refund" }, [before3], tz, now)).toEqual([]);
    expect(planPaymentRelativeJobs(payment, [{ ...before3, config: { offset_days: 3, product_ids: ["B"] } }], tz, now)).toEqual([]);
  });
  it("reprogramar cambia la clave: el reprogramado vuelve a habilitar el recordatorio", () => {
    expect(planPaymentRelativeJobs({ ...payment, reschedule_count: 1 }, [before3], tz, now)[0].dedupeKey).toBe("rel:t1:p1:1");
  });
  it("una configuración rota no agenda nada", () => {
    expect(planPaymentRelativeJobs(payment, [{ id: "t", type: "payment_before_due", config: { offset_days: 99 } }], tz, now)).toEqual([]);
  });
});
