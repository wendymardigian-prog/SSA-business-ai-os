import { describe, it, expect } from "vitest";
import { buildCapiEvent, capiEventId, parseMoney, safeSourceUrl, type CapiEventInput } from "./build-event";
import { checkStepEventName } from "./events";
import { sha256 } from "./normalize";

const NOW = new Date("2026-11-08T12:00:00Z");

function input(over: Partial<CapiEventInput> = {}): CapiEventInput {
  return {
    eventName: "Lead",
    eventId: "form.s1",
    occurredAt: new Date("2026-11-08T11:58:00Z"),
    now: NOW,
    fromWebsite: true,
    sourceUrl: "https://negocio.com/clase?utm_source=fb",
    user: { emails: ["ana@mail.com"], clientIp: "190.12.34.56", userAgent: "Mozilla/5.0", externalId: "c1" },
    ...over,
  };
}

describe("el código del evento", () => {
  it("un formulario usa el que mandó la web (el mismo que su Pixel); si no, uno fijo por respuesta", () => {
    expect(capiEventId({ type: "form", submissionId: "s1", metaEventId: "lead-123" })).toBe("lead-123");
    expect(capiEventId({ type: "form", submissionId: "s1", metaEventId: null })).toBe("form.s1");
    expect(capiEventId({ type: "form", submissionId: "s1", metaEventId: "con espacios" })).toBe("form.s1");
  });

  it("una reunión, un pago y un paso de flujo tienen el suyo, siempre el mismo", () => {
    expect(capiEventId({ type: "booking", bookingId: "b1" })).toBe("booking.b1");
    expect(capiEventId({ type: "payment", paymentId: "p1" })).toBe("payment.p1");
    expect(capiEventId({ type: "flow", sessionId: "x", nodeId: "n1" })).toBe("flow.x.n1");
  });
});

describe("montos", () => {
  it.each([
    ["1500", 1500],
    ["1.500", 1500],
    ["1.500,50", 1500.5],
    ["1,500.50", 1500.5],
    ["$ 99,5", 99.5],
    ["USD 99.90", 99.9],
    ["1,500", 1500],
    ["0", 0],
  ])("«%s» → %s", (raw, expected) => {
    expect(parseMoney(raw)).toBe(expected);
  });

  it("lo que no es un monto positivo, nada", () => {
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("sin valor")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe("la URL del evento", () => {
  it("solo http o https", () => {
    expect(safeSourceUrl("https://negocio.com/x")).toBe("https://negocio.com/x");
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("no es una url")).toBeNull();
  });
});

describe("el evento", () => {
  it("de web: con la URL, el navegador y la hora en SEGUNDOS", () => {
    const result = buildCapiEvent(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      event_name: "Lead",
      event_id: "form.s1",
      action_source: "website",
      event_source_url: "https://negocio.com/clase?utm_source=fb",
      event_time: Math.floor(Date.parse("2026-11-08T11:58:00Z") / 1000),
    });
    expect(result.event.user_data.em).toEqual([sha256("ana@mail.com")]);
    expect(result.event.custom_data).toBeUndefined();
  });

  it("sin la URL o sin el navegador, va como generado por el sistema (Meta exige los dos para la web)", () => {
    const noUrl = buildCapiEvent(input({ sourceUrl: null }));
    expect(noUrl.ok && noUrl.event.action_source).toBe("system_generated");
    expect(noUrl.ok && "event_source_url" in noUrl.event).toBe(false);
    const noUa = buildCapiEvent(input({ user: { emails: ["ana@mail.com"] } }));
    expect(noUa.ok && noUa.event.action_source).toBe("system_generated");
  });

  it("un pago no es de web aunque traiga URL", () => {
    const result = buildCapiEvent(input({ fromWebsite: false, eventName: "Purchase", value: 250, currency: "USD", orderId: "p1" }));
    expect(result.ok && result.event.action_source).toBe("system_generated");
    expect(result.ok && result.event.custom_data).toEqual({ value: 250, currency: "USD", order_id: "p1" });
  });

  it("con valor y sin moneda válida, USD", () => {
    const result = buildCapiEvent(input({ value: 10, currency: "pesos" }));
    expect(result.ok && result.event.custom_data).toEqual({ value: 10, currency: "USD" });
  });

  it("de más de 7 días, no se manda (Meta rechazaría el lote entero)", () => {
    expect(buildCapiEvent(input({ occurredAt: new Date("2026-10-31T11:00:00Z") }))).toEqual({ ok: false, reason: "too_old" });
  });

  it("sin nada con qué reconocer a la persona, no se manda", () => {
    expect(buildCapiEvent(input({ user: { externalId: "c1", displayName: "Ana" } }))).toEqual({ ok: false, reason: "no_match_data" });
  });

  it("sin cookie `_fbc` pero con el fbclid del link, arma el fbc con la hora del evento", () => {
    const result = buildCapiEvent(input({ user: { fbclid: "IwAR0AbCdEfGhIjK" } }));
    expect(result.ok && result.event.user_data.fbc).toBe(`fb.1.${Date.parse("2026-11-08T11:58:00Z")}.IwAR0AbCdEfGhIjK`);
  });

  it("una hora del futuro (relojes desfasados) se manda como ahora", () => {
    const result = buildCapiEvent(input({ occurredAt: new Date("2026-11-08T12:05:00Z") }));
    expect(result.ok && result.event.event_time).toBe(Math.floor(NOW.getTime() / 1000));
  });
});

describe("el nombre del evento del paso", () => {
  it("los estándar y uno propio sirven; Purchase no (lo manda cada pago)", () => {
    expect(checkStepEventName("Lead")).toEqual({ ok: true, name: "Lead" });
    expect(checkStepEventName("LlamadaCalificada")).toEqual({ ok: true, name: "LlamadaCalificada" });
    expect(checkStepEventName("Purchase").ok).toBe(false);
    expect(checkStepEventName("").ok).toBe(false);
    expect(checkStepEventName("1 empieza con número").ok).toBe(false);
  });
});
