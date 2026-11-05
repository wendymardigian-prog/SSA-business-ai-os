import { describe, it, expect } from "vitest";
import { brakeWebhookProblem, BRAKE_WEBHOOK_WARNING, marketingDeliveryView, parseDailyCap, type MarketingCapacity } from "./marketing-delivery-view";
import { readResendConnection } from "./resend-config";

const state = (config: Record<string, unknown>) => readResendConnection(config);

describe("brakeWebhookProblem: el aviso rojo del webhook", () => {
  it("desactivado en Resend (el caso de produccion del 4/11): avisa y dice como arreglarlo", () => {
    const msg = brakeWebhookProblem(state({ webhook_id: "wh_1", webhook_events: "email.received,email.bounced,email.complained", webhook_disabled: "true" }));
    expect(msg).toContain(BRAKE_WEBHOOK_WARNING);
    expect(msg).toContain("desactivado");
  });

  it("le faltan rebotes o quejas: avisa con los que faltan", () => {
    const msg = brakeWebhookProblem(state({ webhook_id: "wh_1", webhook_events: "email.received,email.bounced" }));
    expect(msg).toContain("email.complained");
    expect(msg).not.toContain("email.bounced y");
  });

  it("activo con rebotes y quejas: sin aviso (aunque falten aperturas o clics)", () => {
    expect(brakeWebhookProblem(state({ webhook_id: "wh_1", webhook_events: "email.received,email.bounced,email.complained" }))).toBeNull();
  });

  it("sin webhook ni secreto: avisa; uno creado a mano (con secreto, eventos desconocidos): no inventa un problema", () => {
    expect(brakeWebhookProblem(state({}), { secretSaved: false })).toContain("no está conectado");
    expect(brakeWebhookProblem(state({}), { secretSaved: true })).toBeNull();
    expect(brakeWebhookProblem(null)).toBeNull();
  });
});

const capacity = (over: Partial<MarketingCapacity> = {}): MarketingCapacity => ({
  status: "ok",
  cap: 200,
  remaining: 150,
  used_today: 50,
  manual_cap: 1000,
  quota: null,
  all_today: 0,
  warmup_enabled: true,
  warmup_level: 1,
  warmup_level_date: "2026-11-06",
  next_day_start: "2026-11-07T06:00:00Z",
  time_zone: "America/Costa_Rica",
  paused_at: null,
  paused_reason: null,
  ...over,
});

describe("marketingDeliveryView", () => {
  it("hoy, el escalon del calentamiento y las cuentas de 24 h", () => {
    const view = marketingDeliveryView({ capacity: capacity(), stats: { sent: 120, bounced: 1, complained: 0 }, warmupSaved: true, webhookProblem: null, brakeLimits: { bouncePct: 2, complaintPct: 0.05 } });
    expect(view.todayLine).toBe("Hoy salieron 50 de 200 emails de marketing.");
    expect(view.warmupLine).toContain("escalón 2 de 4 (200 por día), desde el 06/11/2026");
    expect(view.warmupLine).toContain("hasta tu máximo (1000)");
    expect(view.statsLine).toContain("120 enviados · 1 rebotes");
    expect(view.paused).toBeNull();
  });

  it("pausado por el freno: el motivo", () => {
    const view = marketingDeliveryView({ capacity: capacity({ status: "paused", paused_at: "2026-11-06T15:00:00Z", paused_reason: "Rebotaron 3 de 100." }), stats: null, warmupSaved: true, webhookProblem: null, brakeLimits: { bouncePct: 2, complaintPct: 0.05 } });
    expect(view.paused).toEqual({ at: "2026-11-06T15:00:00Z", reason: "Rebotaron 3 de 100." });
  });

  it("con la cuota del plan cargada la muestra; sin calentamiento dice que rige el maximo", () => {
    const view = marketingDeliveryView({ capacity: capacity({ warmup_enabled: false, quota: 3000, all_today: 120, cap: 1000 }), stats: null, warmupSaved: false, webhookProblem: null, brakeLimits: { bouncePct: 2, complaintPct: 0.05 } });
    expect(view.todayLine).toContain("cuota del plan de Resend: 120 de 3000");
    expect(view.warmupLine).toBe("Sin calentamiento: rige tu máximo (1000 por día).");
  });

  it("menos de 50 enviados: avisa que el freno todavia no calcula", () => {
    const view = marketingDeliveryView({ capacity: capacity(), stats: { sent: 10, bounced: 5, complained: 0 }, warmupSaved: true, webhookProblem: null, brakeLimits: { bouncePct: 2, complaintPct: 0.05 } });
    expect(view.statsLine).toContain("el freno no calcula");
  });

  it("sin datos de la base: lo dice", () => {
    expect(marketingDeliveryView({ capacity: null, stats: null, warmupSaved: null, webhookProblem: null, brakeLimits: { bouncePct: 2, complaintPct: 0.05 } }).todayLine).toBe("No pude leer cuánto salió hoy.");
  });
});

describe("parseDailyCap", () => {
  it("acepta enteros positivos", () => {
    expect(parseDailyCap("1000")).toEqual({ ok: true, value: 1000 });
    expect(parseDailyCap(100)).toEqual({ ok: true, value: 100 });
  });
  it("rechaza vacio, decimales, negativos, cero y de mas", () => {
    for (const bad of ["", "1.5", "-3", "0", "abc", "100001"]) expect(parseDailyCap(bad).ok, bad).toBe(false);
  });
});
