import { describe, it, expect } from "vitest";
import { evaluateGuardrails, isWithinBusinessHours } from "./guardrails";
import { guardrailsSchema } from "./schemas";
import { findPhrase } from "./text";

const DEFAULTS = guardrailsSchema.parse({});
const base = {
  guardrails: DEFAULTS,
  burstText: "hola, queria saber como funciona el curso",
  now: new Date("2026-09-15T16:00:00Z"), // martes 10:00 en Costa Rica
  repliesSinceHuman: 0,
  maxRepliesPerConversation: 12,
  unresolvedTurns: 0,
};

describe("temas vedados: derivan ANTES de llamar al modelo", () => {
  it.each([
    ["¿Me hacés un descuento?", "descuento"],
    ["Tengo un RECLAMO por el cobro", "reclamo"],
    ["necesito la factura de septiembre", "factura"],
    ["quiero hablar con una persona por favor", "hablar con una persona"],
  ])("'%s' deriva por '%s'", (text, phrase) => {
    const block = evaluateGuardrails({ ...base, burstText: text });
    expect(block).toMatchObject({ kind: "blocked_topic", action: "escalate" });
    expect(block?.detail).toContain(phrase);
  });

  it("matchea palabras completas, no pedazos: 'descuentoslocos.com' no es un pedido de descuento", () => {
    expect(findPhrase("mira descuentoslocos.com", ["descuento"])).toBeNull();
  });

  it("ignora acentos y mayusculas en los dos lados", () => {
    expect(findPhrase("Quiero una DEVOLUCIÓN", ["devolucion"])).toBe("devolucion");
  });

  it("apagados, no bloquean", () => {
    const guardrails = guardrailsSchema.parse({ blockedTopics: { enabled: false } });
    expect(evaluateGuardrails({ ...base, guardrails, burstText: "un descuento?" })).toBeNull();
  });
});

describe("escalamiento por enojo y urgencia", () => {
  it("enojo deriva", () => {
    expect(evaluateGuardrails({ ...base, burstText: "esto es una estafa" })).toMatchObject({ kind: "frustration" });
  });
  it("urgencia deriva", () => {
    expect(evaluateGuardrails({ ...base, burstText: "es urgente!!" })).toMatchObject({ kind: "urgency" });
  });
});

describe("tope de respuestas por conversacion", () => {
  it("al llegar al tope (default 12) deriva", () => {
    expect(evaluateGuardrails({ ...base, repliesSinceHuman: 12 })).toMatchObject({
      kind: "reply_cap",
      action: "escalate",
    });
  });
  it("una respuesta antes del tope, sigue", () => {
    expect(evaluateGuardrails({ ...base, repliesSinceHuman: 11 })).toBeNull();
  });
  it("N turnos seguidos sin resolver en el mismo intercambio derivan", () => {
    expect(evaluateGuardrails({ ...base, unresolvedTurns: 6 })).toMatchObject({ kind: "unresolved_turns" });
  });
});

describe("horario de atencion, cortado en Costa Rica", () => {
  const hours = guardrailsSchema.parse({
    businessHours: {
      enabled: true,
      slots: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "18:00" })),
      outsideMode: "notice",
    },
  });

  it("24/7 por defecto", () => {
    expect(isWithinBusinessHours(DEFAULTS, new Date("2026-09-13T08:00:00Z"))).toBe(true);
  });

  it("martes 10:00 CR (16:00 UTC) esta dentro", () => {
    expect(isWithinBusinessHours(hours, new Date("2026-09-15T16:00:00Z"))).toBe(true);
  });

  it("martes 19:30 CR (miercoles 01:30 UTC) esta afuera, aunque en UTC ya sea otro dia habil", () => {
    expect(isWithinBusinessHours(hours, new Date("2026-09-16T01:30:00Z"))).toBe(false);
  });

  it("fuera de horario devuelve el modo configurado", () => {
    const block = evaluateGuardrails({ ...base, guardrails: hours, now: new Date("2026-09-13T16:00:00Z") }); // domingo
    expect(block).toMatchObject({ kind: "outside_hours", action: "notice" });
  });

  it("un reclamo fuera de horario deriva igual: le tiene que llegar a alguien", () => {
    const block = evaluateGuardrails({
      ...base,
      guardrails: hours,
      now: new Date("2026-09-13T16:00:00Z"),
      burstText: "tengo un reclamo",
    });
    expect(block).toMatchObject({ kind: "blocked_topic" });
  });
});
