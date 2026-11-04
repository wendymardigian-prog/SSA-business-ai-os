import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_POLICY,
  DEFAULT_WHATSAPP_POLICY,
  combinePolicies,
  describeDays,
  describePolicy,
  estimateFinish,
  hourlyRate,
  isInWindow,
  nextWindowOpen,
  paceDecision,
  paceExceedsCeiling,
  parseBroadcastPace,
  parsePolicy,
  pickGapSeconds,
  startOfNextDay,
  type SendPolicy,
} from "./pace";

// Buenos Aires: UTC-3 todo el año.
const TZ = "America/Argentina/Buenos_Aires";
/** Un instante como hora de pared de Buenos Aires. */
const ba = (iso: string) => new Date(`${iso}-03:00`);
const zero = { lastMinute: 0, lastHour: 0, today: 0 };

describe("parsePolicy", () => {
  it("sin nada guardado, el respaldo", () => {
    expect(parsePolicy(null, DEFAULT_WHATSAPP_POLICY)).toEqual(DEFAULT_WHATSAPP_POLICY);
    expect(parsePolicy("x", DEFAULT_WHATSAPP_POLICY)).toEqual(DEFAULT_WHATSAPP_POLICY);
  });

  it("el máximo nunca queda debajo del mínimo", () => {
    const p = parsePolicy({ minGapSeconds: 90, maxGapSeconds: 10 }, DEFAULT_WHATSAPP_POLICY);
    expect(p.minGapSeconds).toBe(90);
    expect(p.maxGapSeconds).toBe(90);
  });

  it("null es sin tope; un valor raro deja el respaldo", () => {
    const p = parsePolicy({ perHour: null, perDay: "abc", perMinute: -4 }, DEFAULT_WHATSAPP_POLICY);
    expect(p.perHour).toBeNull();
    expect(p.perDay).toBe(DEFAULT_WHATSAPP_POLICY.perDay);
    expect(p.perMinute).toBe(1);
  });

  it("un horario al revés o sin días vuelve al respaldo", () => {
    expect(parsePolicy({ window: { enabled: true, days: [1], start: "20:00", end: "09:00" } }, DEFAULT_WHATSAPP_POLICY).window.start).toBe("09:00");
    expect(parsePolicy({ window: { enabled: true, days: [], start: "09:00", end: "10:00" } }, DEFAULT_WHATSAPP_POLICY).window.days).toEqual(
      DEFAULT_WHATSAPP_POLICY.window.days,
    );
    expect(parsePolicy({ window: { enabled: true, days: [5, 5, 9, 0], start: "08:30", end: "12:00" } }, DEFAULT_WHATSAPP_POLICY).window).toEqual({
      enabled: true,
      days: [0, 5],
      start: "08:30",
      end: "12:00",
    });
  });
});

describe("combinePolicies: el broadcast puede ir más lento, nunca más rápido", () => {
  it("de cada regla, la más lenta", () => {
    const p = combinePolicies(DEFAULT_WHATSAPP_POLICY, { minGapSeconds: 10, maxGapSeconds: 120, perHour: 100, perDay: 50 });
    expect(p.minGapSeconds).toBe(25);
    expect(p.maxGapSeconds).toBe(120);
    expect(p.perHour).toBe(60);
    expect(p.perDay).toBe(50);
  });

  it("sin ajustes del broadcast, el techo tal cual", () => {
    expect(combinePolicies(DEFAULT_WHATSAPP_POLICY, {})).toEqual(DEFAULT_WHATSAPP_POLICY);
  });

  it("un tope del broadcast sobre un número sin tope", () => {
    const ceiling: SendPolicy = { ...DEFAULT_WHATSAPP_POLICY, perHour: null };
    expect(combinePolicies(ceiling, { perHour: 30 }).perHour).toBe(30);
  });

  it("avisa si el broadcast pide más que el número", () => {
    expect(paceExceedsCeiling(DEFAULT_WHATSAPP_POLICY, { perHour: 200 })).toBe(true);
    expect(paceExceedsCeiling(DEFAULT_WHATSAPP_POLICY, { minGapSeconds: 5 })).toBe(true);
    expect(paceExceedsCeiling(DEFAULT_WHATSAPP_POLICY, { perHour: 20, minGapSeconds: 60 })).toBe(false);
  });

  it("parseBroadcastPace descarta lo que no es un número", () => {
    expect(parseBroadcastPace({ minGapSeconds: "30", perHour: "x", perDay: 10, otra: 1 })).toEqual({ minGapSeconds: 30, perDay: 10 });
  });
});

describe("pickGapSeconds", () => {
  it("queda entre el mínimo y el máximo, incluidos", () => {
    expect(pickGapSeconds({ minGapSeconds: 25, maxGapSeconds: 60 }, 0)).toBe(25);
    expect(pickGapSeconds({ minGapSeconds: 25, maxGapSeconds: 60 }, 0.9999999)).toBe(60);
    for (let i = 0; i < 200; i++) {
      const g = pickGapSeconds({ minGapSeconds: 25, maxGapSeconds: 60 });
      expect(g).toBeGreaterThanOrEqual(25);
      expect(g).toBeLessThanOrEqual(60);
    }
  });
  it("sin espera (email)", () => {
    expect(pickGapSeconds(DEFAULT_EMAIL_POLICY, 0.5)).toBe(0);
  });
});

describe("horario de envío", () => {
  const w = DEFAULT_WHATSAPP_POLICY.window; // lunes a sábado, 9 a 20

  it("adentro y afuera, en la hora del negocio", () => {
    expect(isInWindow(w, ba("2026-11-03T10:00:00"), TZ)).toBe(true); // martes
    expect(isInWindow(w, ba("2026-11-03T08:59:00"), TZ)).toBe(false);
    expect(isInWindow(w, ba("2026-11-03T20:00:00"), TZ)).toBe(false);
    expect(isInWindow(w, ba("2026-11-08T12:00:00"), TZ)).toBe(false); // domingo
  });

  it("apagado = siempre", () => {
    expect(isInWindow({ ...w, enabled: false }, ba("2026-11-08T03:00:00"), TZ)).toBe(true);
  });

  it("antes de abrir, abre hoy; después de cerrar, mañana; el sábado a la noche, el lunes", () => {
    expect(nextWindowOpen(w, ba("2026-11-03T07:15:30"), TZ).toISOString()).toBe(ba("2026-11-03T09:00:00").toISOString());
    expect(nextWindowOpen(w, ba("2026-11-03T21:00:00"), TZ).toISOString()).toBe(ba("2026-11-04T09:00:00").toISOString());
    expect(nextWindowOpen(w, ba("2026-11-07T22:00:00"), TZ).toISOString()).toBe(ba("2026-11-09T09:00:00").toISOString());
  });

  it("adentro, ahora mismo", () => {
    const now = ba("2026-11-03T10:00:00");
    expect(nextWindowOpen(w, now, TZ)).toBe(now);
  });

  it("el día siguiente es el del negocio, no el de UTC", () => {
    // 22:30 en Buenos Aires ya es el 4 en UTC; el día siguiente del negocio igual es el 4 a las 00:00 locales.
    expect(startOfNextDay(ba("2026-11-03T22:30:00"), TZ).toISOString()).toBe(ba("2026-11-04T00:00:00").toISOString());
  });
});

describe("paceDecision", () => {
  const now = ba("2026-11-03T10:00:00");

  it("con lugar, sale", () => {
    expect(paceDecision(DEFAULT_WHATSAPP_POLICY, zero, now, TZ)).toEqual({ ok: true });
  });

  it("fuera de horario, vuelve cuando abre", () => {
    const d = paceDecision(DEFAULT_WHATSAPP_POLICY, zero, ba("2026-11-03T21:00:00"), TZ);
    expect(d).toEqual({ ok: false, reason: "window", retryAt: ba("2026-11-04T09:00:00") });
  });

  it("tope del día: vuelve cuando abre el día siguiente", () => {
    const d = paceDecision(DEFAULT_WHATSAPP_POLICY, { ...zero, today: 300 }, now, TZ);
    expect(d).toEqual({ ok: false, reason: "day", retryAt: ba("2026-11-04T09:00:00") });
  });

  it("tope por hora y por minuto", () => {
    expect(paceDecision(DEFAULT_WHATSAPP_POLICY, { ...zero, lastHour: 60 }, now, TZ)).toMatchObject({ ok: false, reason: "hour" });
    expect(paceDecision(DEFAULT_WHATSAPP_POLICY, { ...zero, lastMinute: 2 }, now, TZ)).toMatchObject({ ok: false, reason: "minute" });
  });

  it("el día manda sobre la hora", () => {
    expect(paceDecision(DEFAULT_WHATSAPP_POLICY, { lastMinute: 9, lastHour: 99, today: 300 }, now, TZ)).toMatchObject({ reason: "day" });
  });
});

describe("estimateFinish", () => {
  const now = ba("2026-11-03T10:00:00");

  it("nada pendiente = ahora", () => {
    expect(estimateFinish(0, DEFAULT_WHATSAPP_POLICY, now, TZ)).toBe(now);
  });

  it("el ritmo por hora es el más lento de las reglas", () => {
    expect(hourlyRate(DEFAULT_WHATSAPP_POLICY)).toBe(60); // la espera daría ~84/h, el tope dice 60
    expect(hourlyRate({ ...DEFAULT_WHATSAPP_POLICY, perHour: null, perMinute: null, minGapSeconds: 60, maxGapSeconds: 60 })).toBe(60);
  });

  it("30 mensajes a 60 por hora: media hora", () => {
    const end = estimateFinish(30, DEFAULT_WHATSAPP_POLICY, now, TZ)!;
    expect((end.getTime() - now.getTime()) / 60_000).toBeCloseTo(30, 0);
  });

  it("lo que no entra hoy pasa al próximo día con horario", () => {
    // 10 a 20 h = 10 horas a 60/h = 600, pero el tope es 300 por día: 400 mensajes terminan el miércoles.
    const end = estimateFinish(400, DEFAULT_WHATSAPP_POLICY, now, TZ)!;
    expect(end.getTime()).toBeGreaterThan(ba("2026-11-04T09:00:00").getTime());
    expect(end.getTime()).toBeLessThan(ba("2026-11-04T20:00:00").getTime());
  });

  it("email sin espera ni topes: enseguida", () => {
    expect(estimateFinish(5000, { ...DEFAULT_EMAIL_POLICY, perMinute: null }, now, TZ)).toBe(now);
  });
});

describe("describePolicy", () => {
  it("el ritmo de WhatsApp por defecto, en una línea", () => {
    expect(describePolicy(DEFAULT_WHATSAPP_POLICY)).toBe("25–60 s entre mensajes · máx. 2/min · 60/hora · 300/día · Lun a Sáb de 09:00 a 20:00");
  });
  it("días sueltos y todos", () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe("Todos los días");
    expect(describeDays([1, 3, 5])).toBe("Lun, Mié, Vie");
    expect(describeDays([1, 2])).toBe("Lun, Mar");
  });
});
