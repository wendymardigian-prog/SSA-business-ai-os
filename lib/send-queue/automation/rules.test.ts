import { describe, expect, it } from "vitest";
import { DEFAULT_WHATSAPP_POLICY } from "@/lib/send-queue/pace";
import { effectiveQueuePolicy, mergeQueueKeys, parseQueuePolicy, warmupLabel, warmupState, warmupStepsInput } from "./policy";
import { allowedPriorities, bulkCeiling, hourlyLimitFor, queueDecision } from "./quota";
import { expiresAtFor, parseExpiry } from "./expiry";
import { classifyEvolutionStatus, retryPlan } from "./retry";
import { hourStart, parsePerRunLimit, perRunPlacement } from "./per-run";
import { dedupeKey } from "./dedupe";
import { initialStatus, parseSchedule, reapplySchedule, scheduleProblem, scheduledForFrom } from "./schedule";
import { deliveryProblem, isInstantTrigger, parseDelivery, parseQueueSettings, resolveDeliveryMode } from "./settings";
import { contactCapDecision, contactCapInput, parseContactCap } from "./contact-cap";
import { isLaneStalled, laneAlertInput, nextUndeliveredSince, parseLaneAlert } from "./lane-alert";
import { manualQuotaText, manualQuotaWarning } from "./manual-quota";
import { settlePatch } from "./settle";
import { barTone, busiestWarning, laneCard, queueTimingText } from "./screen";
import { displayStatus, parseStatusTab } from "./labels";

const TZ = "America/Costa_Rica"; // UTC-6, sin horario de verano
/** Un martes a las 10:00 de Costa Rica. */
const TUE_10 = new Date("2026-11-17T16:00:00Z");
const DAY = 24 * 3600_000;

describe("el ritmo de la cola es el del número (no el de RER)", () => {
  it("sin nada guardado: el de siempre de WhatsApp, con 20 % de reserva", () => {
    const p = parseQueuePolicy(null);
    expect(p.perHour).toBe(DEFAULT_WHATSAPP_POLICY.perHour);
    expect(p.perDay).toBe(DEFAULT_WHATSAPP_POLICY.perDay);
    expect(p.minGapSeconds).toBe(DEFAULT_WHATSAPP_POLICY.minGapSeconds);
    expect(p.urgentReservePct).toBe(20);
  });

  it("lo guardado manda (60/h y 304/día) y lo raro vuelve al previsto", () => {
    const p = parseQueuePolicy({ perHour: 60, perDay: 304, urgentReservePct: "x", newNumberFactor: 9 });
    expect(p.perHour).toBe(60);
    expect(p.perDay).toBe(304);
    expect(p.urgentReservePct).toBe(20);
    expect(p.newNumberFactor).toBe(1);
  });

  it("guardar el ritmo desde Canales no pisa la reserva ni el calentamiento", () => {
    const merged = mergeQueueKeys(DEFAULT_WHATSAPP_POLICY, { perHour: 10, urgentReservePct: 30, warmupSteps: [{ days: 3, factor: 0.25 }], warmupFrom: "2026-11-10T00:00:00Z" });
    expect(merged.perHour).toBe(DEFAULT_WHATSAPP_POLICY.perHour);
    expect(merged.urgentReservePct).toBe(30);
    expect(merged.warmupSteps).toEqual([{ days: 3, factor: 0.25 }]);
    expect(merged.warmupFrom).toBe("2026-11-10T00:00:00Z");
  });
});

describe("calentamiento", () => {
  const base = parseQueuePolicy({ perHour: 60, perDay: 300 });

  it("un número nuevo, la primera semana a la mitad (hora y día; la espera no cambia)", () => {
    const since = new Date(TUE_10.getTime() - 2 * DAY);
    const eff = effectiveQueuePolicy(base, since, TUE_10);
    expect(eff.perHour).toBe(30);
    expect(eff.perDay).toBe(150);
    expect(eff.minGapSeconds).toBe(base.minGapSeconds);
    expect(warmupLabel(base, since, TUE_10)).toBe("calentando: día 3 de 7, cupos al 50 %");
  });

  it("pasada la escalera, los topes enteros", () => {
    const since = new Date(TUE_10.getTime() - 8 * DAY);
    expect(effectiveQueuePolicy(base, since, TUE_10).perHour).toBe(60);
    expect(warmupLabel(base, since, TUE_10)).toBeNull();
  });

  it("una escalera de tramos y «volver a calentar» desde una fecha", () => {
    const p = parseQueuePolicy({ perHour: 60, perDay: 300, warmupSteps: [{ days: 2, factor: 0.25 }, { days: 3, factor: 0.5 }], warmupFrom: new Date(TUE_10.getTime() - 3 * DAY).toISOString() });
    // El número es viejo, pero se volvió a calentar hace 3 días: está en el día 4 (segundo tramo).
    const since = new Date("2026-01-01T00:00:00Z");
    expect(warmupState(p, since, TUE_10)).toMatchObject({ day: 4, totalDays: 5, stepIndex: 1, factor: 0.5 });
    expect(effectiveQueuePolicy(p, since, TUE_10).perDay).toBe(150);
  });

  it("la escalera que llega de la pantalla", () => {
    expect(warmupStepsInput([{ days: 3, pct: 25 }, { days: 4, pct: 50 }])).toEqual({ ok: true, value: [{ days: 3, factor: 0.25 }, { days: 4, factor: 0.5 }] });
    expect(warmupStepsInput([{ days: 0, pct: 25 }]).ok).toBe(false);
    expect(warmupStepsInput([{ days: 3, pct: 5 }]).ok).toBe(false);
  });
});

describe("cupos y reserva de urgentes", () => {
  const p = parseQueuePolicy({ perHour: 60, perDay: 300, perMinute: 2, window: { enabled: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" } });
  const counts = (lastHour: number, today = lastHour, lastMinute = 0) => ({ lastHour, today, lastMinute });

  it("con 60 por hora y 20 %: lo normal y lo masivo usan 48; lo urgente 60", () => {
    expect(hourlyLimitFor(p, "urgent")).toBe(60);
    expect(hourlyLimitFor(p, "normal")).toBe(48);
    expect(hourlyLimitFor(p, "bulk")).toBe(48);
  });

  it("un broadcast es masivo: su techo por hora deja la reserva libre", () => {
    expect(bulkCeiling(p).perHour).toBe(48);
    expect(bulkCeiling(p).perDay).toBe(300);
  });

  it("fuera del horario del número, nada sale (tampoco lo urgente) y se vuelve a mirar a la apertura", () => {
    const night = new Date("2026-11-18T03:00:00Z"); // martes 21:00 en Costa Rica
    const d = queueDecision(p, counts(0), "urgent", night, TZ);
    expect(d).toEqual({ ok: false, reason: "window", retryAt: new Date("2026-11-18T14:00:00Z") });
  });

  it("con 48 en la hora: lo normal espera la reserva; lo urgente sale", () => {
    expect(queueDecision(p, counts(48), "normal", TUE_10, TZ)).toMatchObject({ ok: false, reason: "hour_reserved" });
    expect(queueDecision(p, counts(48), "urgent", TUE_10, TZ)).toEqual({ ok: true });
    expect(queueDecision(p, counts(60), "urgent", TUE_10, TZ)).toMatchObject({ ok: false, reason: "hour" });
  });

  it("el tope del día y el del minuto", () => {
    expect(queueDecision(p, counts(0, 300), "urgent", TUE_10, TZ)).toMatchObject({ ok: false, reason: "day" });
    expect(queueDecision(p, counts(1, 1, 2), "urgent", TUE_10, TZ)).toMatchObject({ ok: false, reason: "minute" });
  });

  it("qué prioridades pueden salir, y lo masivo pausado no se ofrece", () => {
    expect(allowedPriorities(p, counts(10), TUE_10, TZ, { bulkPaused: false }).priorities).toEqual(["urgent", "normal", "bulk"]);
    expect(allowedPriorities(p, counts(10), TUE_10, TZ, { bulkPaused: true }).priorities).toEqual(["urgent", "normal"]);
    const full = allowedPriorities(p, counts(48), TUE_10, TZ, { bulkPaused: false });
    expect(full.priorities).toEqual(["urgent"]);
    expect(full.blocks).toMatchObject({ normal: "hour_reserved", bulk: "hour_reserved" });
  });
});

describe("caducidad, reintentos y límite por hora", () => {
  it("la caducidad cuenta desde que puede salir", () => {
    expect(expiresAtFor("15m", TUE_10)).toEqual(new Date(TUE_10.getTime() + 15 * 60_000));
    expect(expiresAtFor("none", TUE_10)).toBeNull();
    expect(parseExpiry("2d")).toBe("none");
  });

  it("transporte se reintenta a 1, 5 y 15 minutos; un rechazo no", () => {
    expect(classifyEvolutionStatus(null)).toBe("transport");
    expect(classifyEvolutionStatus(503)).toBe("transport");
    expect(classifyEvolutionStatus(429)).toBe("transport");
    expect(classifyEvolutionStatus(400)).toBe("rejected");
    expect(retryPlan("transport", 0, TUE_10)).toEqual({ retry: true, attempts: 1, nextAttemptAt: new Date(TUE_10.getTime() + 60_000) });
    expect(retryPlan("transport", 2, TUE_10)).toEqual({ retry: true, attempts: 3, nextAttemptAt: new Date(TUE_10.getTime() + 15 * 60_000) });
    expect(retryPlan("transport", 3, TUE_10)).toEqual({ retry: false, attempts: 4 });
    expect(retryPlan("rejected", 0, TUE_10)).toEqual({ retry: false, attempts: 1 });
  });

  it("con límite de 40 por hora, el envío 41 pasa a la hora siguiente", () => {
    expect(parsePerRunLimit("40")).toBe(40);
    expect(parsePerRunLimit(0)).toBeNull();
    expect(perRunPlacement(40, 39, TUE_10)).toEqual(TUE_10);
    expect(perRunPlacement(40, 40, TUE_10)).toEqual(new Date(hourStart(TUE_10).getTime() + 3_600_000));
    expect(perRunPlacement(null, 1000, TUE_10)).toEqual(TUE_10);
  });

  it("un envío por paso, ejecución y destino; otra vuelta por el mismo paso es otro envío", () => {
    const base = { flowId: "f", nodeId: "n", index: 0, sessionId: "s", targetKey: "c", visit: 0 };
    expect(dedupeKey(base)).toBe("run:f:n#0:s:c");
    expect(dedupeKey({ ...base, visit: 2 })).toBe("run:f:n#0:s:c:v2");
    expect(dedupeKey({ ...base, index: 1 })).not.toBe(dedupeKey(base));
  });
});

describe("envíos programados", () => {
  it("se lee sin lanzar y se valida para publicar", () => {
    expect(parseSchedule(null).enabled).toBe(false);
    expect(scheduleProblem({ enabled: true, amount: 0, unit: "days" })).toMatch(/no es válida/);
    expect(scheduleProblem({ enabled: true, amount: 3, unit: "days" })).toBeNull();
  });

  it("nace programado, en cola o vencido", () => {
    const s = parseSchedule({ enabled: true, amount: 2, unit: "hours" });
    expect(scheduledForFrom(TUE_10, s)).toEqual(new Date(TUE_10.getTime() + 2 * 3_600_000));
    expect(initialStatus(new Date(TUE_10.getTime() + 1000), TUE_10, true)).toBe("scheduled");
    expect(initialStatus(TUE_10, TUE_10, false)).toBe("queued");
  });

  it("aplicar una programación más corta a quien ya la pasó lo deja vencido (no sale de golpe)", () => {
    const anchor = new Date(TUE_10.getTime() - 4 * DAY);
    expect(reapplySchedule(anchor, parseSchedule({ enabled: true, amount: 3, unit: "days" }), TUE_10).status).toBe("overdue");
    expect(reapplySchedule(anchor, parseSchedule({ enabled: true, amount: 7, unit: "days" }), TUE_10).status).toBe("scheduled");
  });
});

describe("qué va por la cola (decisión del 18/11/2026)", () => {
  const auto = parseDelivery(undefined);

  it("según el disparador: si el contacto escribió o es su agenda, al instante", () => {
    for (const t of ["keyword", "welcome", "default", "postback", "quick_reply", "comment_keyword", "booking_created", "booking_before_start"]) {
      expect(isInstantTrigger(t)).toBe(true);
      expect(resolveDeliveryMode(auto, t)).toBe("immediate");
    }
  });

  it("si lo dispara otra cosa (etiqueta, alta, formulario, fecha, webhook, venta, servicio), por la cola", () => {
    for (const t of ["crm_event", "new_contact", "form_submitted", "scheduled_time", "webhook_received", "sale_created", "service_created", null]) {
      expect(resolveDeliveryMode(auto, t)).toBe("queue");
    }
  });

  it("un paso a un grupo sale al instante en «según el disparador» (un solo mensaje, con hora fija)", () => {
    expect(resolveDeliveryMode(auto, "scheduled_time", { groupStep: true })).toBe("immediate");
    expect(resolveDeliveryMode(parseDelivery({ mode: "queue" }), "scheduled_time", { groupStep: true })).toBe("queue");
  });

  it("lo que elige el paso manda; un paso programado va por la cola", () => {
    expect(resolveDeliveryMode(parseDelivery({ mode: "immediate" }), "crm_event")).toBe("immediate");
    expect(resolveDeliveryMode(parseDelivery({ mode: "queue" }), "keyword")).toBe("queue");
    expect(resolveDeliveryMode(parseDelivery({ schedule: { enabled: true, amount: 1, unit: "days" } }), "keyword")).toBe("queue");
  });

  it("al instante no se puede programar (frena la publicación)", () => {
    expect(deliveryProblem({ mode: "immediate", schedule: { enabled: true, amount: 1, unit: "days" } })).toMatch(/al instante/);
    expect(deliveryProblem(undefined)).toBeNull();
  });

  it("la configuración de la automatización: normal, sin caducidad y sin límite", () => {
    expect(parseQueueSettings(undefined)).toEqual({ priority: "normal", expiry: "none", perRunLimit: null });
    expect(parseQueueSettings({ priority: "urgent", expiry: "15m", perRunLimit: 20 })).toEqual({ priority: "urgent", expiry: "15m", perRunLimit: 20 });
  });
});

describe("tope por contacto y día (apagado por defecto)", () => {
  it("sin guardar, apagado: no frena nada", () => {
    const cap = parseContactCap(null);
    expect(cap.enabled).toBe(false);
    expect(contactCapDecision(cap, "contact", "normal", 99)).toEqual({ ok: true });
  });

  it("prendido: el cuarto del día se descarta; lo urgente no cuenta", () => {
    const cap = parseContactCap({ enabled: true });
    expect(contactCapDecision(cap, "contact", "normal", 2)).toEqual({ ok: true });
    expect(contactCapDecision(cap, "contact", "normal", 3)).toMatchObject({ ok: false });
    expect(contactCapDecision(cap, "contact", "urgent", 10)).toEqual({ ok: true });
    expect(contactCapDecision(cap, "group", "bulk", 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/grupo/) });
  });

  it("lo que llega de la pantalla", () => {
    expect(contactCapInput({ enabled: true, perContactDay: "2", perGroupDay: "", urgentCounts: false })).toEqual({ ok: true, value: { enabled: true, perContactDay: 2, perGroupDay: null, urgentCounts: false } });
    expect(contactCapInput({ enabled: true, perContactDay: 0 }).ok).toBe(false);
  });
});

describe("alerta si un número deja de entregar", () => {
  it("el reloj arranca con pendientes y vuelve a cero al entregar o esperar con motivo", () => {
    expect(nextUndeliveredSince(null, "pending", TUE_10)).toBe(TUE_10.toISOString());
    expect(nextUndeliveredSince("2026-11-17T15:00:00.000Z", "pending", TUE_10)).toBe("2026-11-17T15:00:00.000Z");
    expect(nextUndeliveredSince("2026-11-17T15:00:00.000Z", "delivered", TUE_10)).toBeNull();
    expect(nextUndeliveredSince("2026-11-17T15:00:00.000Z", "idle", TUE_10)).toBeNull();
  });

  it("a los 30 minutos (previsto) pausa y avisa", () => {
    const s = parseLaneAlert(null);
    expect(s.stalledMinutes).toBe(30);
    expect(isLaneStalled(new Date(TUE_10.getTime() - 29 * 60_000).toISOString(), TUE_10, s)).toBe(false);
    expect(isLaneStalled(new Date(TUE_10.getTime() - 30 * 60_000).toISOString(), TUE_10, s)).toBe(true);
    expect(laneAlertInput("3").ok).toBe(false);
    expect(laneAlertInput("45")).toEqual({ ok: true, value: { stalledMinutes: 45 } });
  });
});

describe("lo manual nunca se frena: solo avisa con el cupo gastado", () => {
  const p = parseQueuePolicy({ perHour: 60, perDay: 300 });
  it("avisa con el cupo de la hora o del día gastado (el del día manda)", () => {
    expect(manualQuotaWarning(p, { lastHour: 59, today: 100 })).toBeNull();
    expect(manualQuotaWarning(p, { lastHour: 60, today: 100 })).toEqual({ reason: "hour", used: 60, limit: 60 });
    expect(manualQuotaWarning(p, { lastHour: 60, today: 300 })).toEqual({ reason: "day", used: 300, limit: 300 });
    expect(manualQuotaText({ reason: "day", used: 300, limit: 300 }).detail).toMatch(/sale igual/);
  });
});

describe("cómo queda un envío después de un intento", () => {
  it("enviado, descartado, tope de 200/h, transporte y rechazo", () => {
    expect(settlePatch({ kind: "sent", messageId: "m1" }, 0, TUE_10)).toMatchObject({ patch: { status: "sent", platform_message_id: "m1" }, failures: "reset", final: true });
    expect(settlePatch({ kind: "discarded", code: "do_not_contact", reason: "x" }, 0, TUE_10)).toMatchObject({ patch: { status: "discarded", reason_code: "do_not_contact" }, failures: "keep" });
    expect(settlePatch({ kind: "rate_limited" }, 0, TUE_10)).toMatchObject({ patch: { status: "queued", reason_code: "waiting_quota" }, failures: "keep", final: false });
    expect(settlePatch({ kind: "failed", errorKind: "transport", message: "sin respuesta" }, 0, TUE_10)).toMatchObject({ patch: { status: "queued", attempts: 1 }, failures: "add", final: false });
    expect(settlePatch({ kind: "failed", errorKind: "rejected", message: "no existe" }, 0, TUE_10)).toMatchObject({ patch: { status: "failed", error_kind: "rejected" }, final: true });
  });
});

describe("la pantalla", () => {
  const policy = parseQueuePolicy({ perHour: 60, perDay: 300 });
  const input = {
    channelId: "c1",
    name: "WhatsApp +50600000000",
    sessionDown: false,
    pausedAt: null,
    pausedReason: null,
    bulkPausedAt: null,
    nextSendAt: null,
    policy,
    warmupLabel: null,
    warmupSteps: [],
    lastHour: 10,
    today: 40,
    pending: 3,
    inHours: true,
    opensAtLabel: null,
  };

  it("el estado de cada número", () => {
    expect(laneCard(input).status).toEqual({ label: "Enviando", tone: "green" });
    expect(laneCard({ ...input, pending: 0 }).status.label).toBe("Sin cola");
    expect(laneCard({ ...input, inHours: false, opensAtLabel: "a las 08:00" })).toMatchObject({ status: { label: "En espera" }, note: "Fuera del horario de envío: sigue a las 08:00." });
    expect(laneCard({ ...input, lastHour: 48 }).note).toBe("Esperando cupo.");
    expect(laneCard({ ...input, pausedAt: "x", pausedReason: "Fallaron 3 envíos seguidos." })).toMatchObject({ status: { label: "Pausado", tone: "red" }, note: "Fallaron 3 envíos seguidos." });
    expect(laneCard(input).hour).toEqual({ used: 10, limit: 60, pct: 17 });
  });

  it("barras, aviso y próximo envío", () => {
    expect(barTone(69)).toBe("green");
    expect(barTone(70)).toBe("yellow");
    expect(barTone(95)).toBe("red");
    expect(busiestWarning([{ name: "A", hour: { used: 50, limit: 60, pct: 83 } }])).toMatch(/83 %/);
    const card = laneCard({ ...input, nextSendAt: new Date(TUE_10.getTime() + 12_000).toISOString() });
    expect(queueTimingText([card], TUE_10.getTime())).toMatch(/^Siguiente envío en 12 s/);
  });

  it("estados con nombre propio y pestañas", () => {
    expect(displayStatus("queued", "waiting_quota")).toEqual({ label: "Esperando cupo", tone: "yellow" });
    expect(displayStatus("discarded", "contact_cap").label).toBe("Descartado por tope");
    expect(parseStatusTab("nada")).toBe("pendientes");
  });
});
