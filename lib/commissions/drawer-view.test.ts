import { describe, expect, it } from "vitest";
import { allowedActions, attributionView, paymentLines, ruleFromSnapshot, saleClosedChip, usedRuleText } from "./drawer-view";

describe("attributionView", () => {
  it("dice el canal en palabras y trae la pieza o el anuncio de origen con su id", () => {
    const v = attributionView({ channel: "organic", source: "instagram", content_post_id: "p1", content_title: "Reel de octubre", meta_ad_id: null, ad_name: null }, null);
    expect(v).toMatchObject({ channelLabel: "Orgánico", source: "instagram", piece: { id: "p1", title: "Reel de octubre" }, ad: null, empty: false });
    const paid = attributionView({ channel: "paid", source: "facebook", meta_ad_id: "123", ad_name: "Anuncio verano" }, null);
    expect(paid).toMatchObject({ channelLabel: "Pagado", ad: { id: "123", name: "Anuncio verano" }, piece: null });
  });

  it("sin atribución está vacía, y un canal desconocido se muestra tal cual", () => {
    expect(attributionView(null, null)).toMatchObject({ empty: true, channelLabel: null, piece: null, ad: null, touch: [] });
    expect(attributionView({ channel: "raro" }, null).channelLabel).toBe("raro");
  });

  it("del toque, solo lo que tiene valor", () => {
    const v = attributionView({ channel: "paid" }, { medium: "cpc", campaign: null, content: "video-1", term: null, origin: "agenda" });
    expect(v.touch).toEqual([{ label: "Medio", value: "cpc" }, { label: "Contenido", value: "video-1" }, { label: "Origen", value: "agenda" }]);
  });

  it("una pieza sin título guardado igual se muestra", () => {
    expect(attributionView({ content_post_id: "p9" }, null).piece).toEqual({ id: "p9", title: "Una pieza de contenido" });
  });
});

describe("la regla usada", () => {
  const snapshot = { name: "Vendedor 8 %", role: "vendedor", calc_type: "percent", rate: 8, fixed_amount: null, base: "net_of_fees", conditions: { financing_types: ["installments"] }, position: 1 };

  it("arma una regla desde la foto y la dice en palabras", () => {
    expect(ruleFromSnapshot(snapshot)).toMatchObject({ name: "Vendedor 8 %", calc_type: "percent", rate: 8, base: "net_of_fees", hold_days: 0 });
    expect(usedRuleText(snapshot, { roles: { vendedor: "Vendedor" } })).toBe("Vendedor · en cuotas · 8 % del neto");
  });

  it("sin foto (un ajuste) no hay regla", () => {
    expect(ruleFromSnapshot(null)).toBeNull();
    expect(ruleFromSnapshot({})).toBeNull();
    expect(usedRuleText(null, {})).toBeNull();
  });
});

describe("saleClosedChip", () => {
  it("avisa cuando la venta ya no está viva", () => {
    expect(saleClosedChip("cancelled")).toEqual({ label: "Venta cancelada", tone: "gray" });
    expect(saleClosedChip("refunded")?.label).toBe("Venta reembolsada");
    expect(saleClosedChip("paid")).toBeNull();
    expect(saleClosedChip(null)).toBeNull();
  });
});

describe("allowedActions", () => {
  it("asignar solo a «Sin persona»; anular a Pendiente, Retenida y Sin persona, nunca con gasto", () => {
    expect(allowedActions("sin_persona", false)).toEqual({ assign: true, void: true });
    expect(allowedActions("pendiente", false)).toEqual({ assign: false, void: true });
    expect(allowedActions("retenida", false)).toEqual({ assign: false, void: true });
    expect(allowedActions("en_gasto", true)).toEqual({ assign: false, void: false });
    expect(allowedActions("pagada", true)).toEqual({ assign: false, void: false });
    expect(allowedActions("anulada", false)).toEqual({ assign: false, void: false });
  });
});

describe("paymentLines", () => {
  const date = (d: string | null) => d ?? "—";
  it("con alcance total muestra lo cobrado, la comisión y el neto", () => {
    const lines = paymentLines({ installment: "Cuota 2 de 6", paidOn: "2026-10-10", methodName: "Whop", collectedCents: 50000, feeCents: 1480, formatDate: date });
    expect(lines.map((l) => [l.label, l.value])).toEqual([
      ["Pago", "Cuota 2 de 6"], ["Fecha del cobro", "2026-10-10"], ["Método", "Whop"], ["Cobrado", "USD 500,00"], ["Comisión del procesador", "USD 14,80"], ["Neto", "USD 485,20"],
    ]);
  });
  it("con alcance propio no muestra montos del negocio", () => {
    const lines = paymentLines({ installment: "Pago completo", paidOn: null, methodName: null, collectedCents: null, feeCents: null, formatDate: date });
    expect(lines.map((l) => l.label)).toEqual(["Pago", "Fecha del cobro"]);
  });
  it("un método sin comisión no inventa un neto", () => {
    const lines = paymentLines({ installment: null, paidOn: "2026-10-10", methodName: "Transferencia", collectedCents: 10000, feeCents: null, formatDate: date });
    expect(lines.map((l) => l.label)).toEqual(["Fecha del cobro", "Método", "Cobrado"]);
  });
});
