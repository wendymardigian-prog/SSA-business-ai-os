/**
 * Caracterizacion de los triggers registrados (Llamadas, §4.3): el conjunto
 * exacto de tipos, con su alcance y prioridad, ANTES de sumar `call_analyzed`
 * y `call_linked`. Llamadas solo puede agregar; ningun tipo existente cambia.
 */
import { describe, expect, it } from "vitest";
import { listTriggers, listNodes } from "./index";

const BEFORE_CALLS = [
  "keyword", "postback", "quick_reply", "welcome", "default", "comment_keyword",
  "new_contact", "crm_event", "inactivity", "email_received",
  "booking_created", "booking_rescheduled", "booking_cancelled", "booking_updated",
  "booking_ended", "booking_status_changed", "booking_before_start", "booking_after_end",
  "booking_after_created",
];

describe("triggers registrados", () => {
  it("incluyen los 19 de antes de Llamadas, con la misma forma", () => {
    const all = listTriggers();
    const byType = new Map(all.map((t) => [t.type, t]));
    for (const type of BEFORE_CALLS) expect(byType.has(type), type).toBe(true);
    // La forma de los nueve de agenda no cambia.
    for (const type of BEFORE_CALLS.filter((t) => t.startsWith("booking_"))) {
      const t = byType.get(type)!;
      expect(t.priority, type).toBe(45);
      expect(["event", "scheduled"], type).toContain(t.scope);
      expect(t.eventTypes, type).toEqual([type]);
    }
  });

  it("Llamadas suma exactamente call_analyzed y call_linked, de alcance evento y prioridad 45", () => {
    const byType = new Map(listTriggers().map((t) => [t.type, t]));
    for (const type of ["call_analyzed", "call_linked"]) {
      const t = byType.get(type)!;
      expect(t, type).toBeDefined();
      expect(t.scope).toBe("event");
      expect(t.priority).toBe(45);
      expect(t.eventTypes).toEqual([type]);
    }
    // + los tres de Formularios, los seis de Ventas y el del reporte de fin de día (ver abajo).
    expect(listTriggers()).toHaveLength(BEFORE_CALLS.length + 2 + 3 + 6 + 1);
  });

  it("Formularios suma exactamente form_submitted, survey_answered y contract_signed, de alcance evento y prioridad 45", () => {
    const byType = new Map(listTriggers().map((t) => [t.type, t]));
    for (const type of ["form_submitted", "survey_answered", "contract_signed"]) {
      const t = byType.get(type)!;
      expect(t, type).toBeDefined();
      expect(t.scope).toBe("event");
      expect(t.priority).toBe(45);
      expect(t.eventTypes).toEqual([type]);
    }
  });

  it("Ventas suma exactamente seis triggers de prioridad 45: cuatro de evento y dos relativos (scheduled)", () => {
    const byType = new Map(listTriggers().map((t) => [t.type, t]));
    for (const type of ["sale_created", "sale_status_changed", "payment_created", "payment_status_changed", "payment_before_due", "payment_after_due"]) {
      const t = byType.get(type)!;
      expect(t, type).toBeDefined();
      expect(t.priority).toBe(45);
      expect(t.eventTypes).toEqual([type]);
      expect(t.scope).toBe(type.endsWith("_due") ? "scheduled" : "event");
    }
  });

  it("el orden de prioridad de los de mensaje sigue igual", () => {
    const order = listTriggers("message").map((t) => t.type);
    expect(order[0]).not.toBe("default");
    expect(order[order.length - 1]).toBe("default");
  });

  it("no hay dos triggers con el mismo tipo", () => {
    const types = listTriggers().map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("los nodos registrados siguen sin repetirse", () => {
    const types = listNodes().map((n) => n.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe("reporte de fin de día (E16)", () => {
  it("eod_submitted es el ÚNICO disparador sin contacto; todos los demás siguen siendo sobre un contacto", () => {
    const members = listTriggers().filter((t) => t.subject === "member").map((t) => t.type);
    expect(members).toEqual(["eod_submitted"]);
    const t = listTriggers().find((x) => x.type === "eod_submitted")!;
    expect(t).toMatchObject({ scope: "event", priority: 45, eventTypes: ["eod_submitted"] });
    expect(listTriggers().filter((x) => x.type !== "eod_submitted").every((x) => (x.subject ?? "contact") === "contact")).toBe(true);
  });
});
