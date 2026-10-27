/**
 * Caracterización del registro de triggers ANTES de que Formularios sume los
 * suyos (F19). Lo nuevo solo puede SUMAR: cada tipo de acá tiene que seguir
 * registrado con el mismo alcance, la misma prioridad y los mismos eventos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { listTriggers } from "./index";

// [type, scope, priority, eventTypes | null]
const BEFORE: Array<[string, string, number, string[] | null]> = [
  ["postback", "message", 100, null],
  ["quick_reply", "message", 90, null],
  ["keyword", "message", 80, null],
  ["comment_keyword", "comment", 80, null],
  ["new_contact", "event", 60, ["contact_created"]],
  ["email_received", "event", 55, null],
  ["crm_event", "event", 50, ["*"]],
  ["booking_created", "event", 45, ["booking_created"]],
  ["booking_rescheduled", "event", 45, ["booking_rescheduled"]],
  ["booking_cancelled", "event", 45, ["booking_cancelled"]],
  ["booking_updated", "event", 45, ["booking_updated"]],
  ["booking_ended", "event", 45, ["booking_ended"]],
  ["booking_status_changed", "event", 45, ["booking_status_changed"]],
  ["booking_before_start", "scheduled", 45, ["booking_before_start"]],
  ["booking_after_end", "scheduled", 45, ["booking_after_end"]],
  ["booking_after_created", "scheduled", 45, ["booking_after_created"]],
  ["call_analyzed", "event", 45, ["call_analyzed"]], // @plantilla-quitar(llamadas)
  ["call_linked", "event", 45, ["call_linked"]], // @plantilla-quitar(llamadas)
  ["inactivity", "scheduled", 40, null],
  ["welcome", "message", 20, null],
  ["default", "message", 10, null],
];

describe("registro de triggers: lo que ya existía", () => {
  const registered = new Map(listTriggers().map((t) => [t.type, t]));

  it.each(BEFORE)("%s sigue registrado igual", (type, scope, priority, eventTypes) => {
    const def = registered.get(type);
    expect(def, `falta el trigger ${type}`).toBeDefined();
    expect(def!.scope).toBe(scope);
    expect(def!.priority).toBe(priority);
    expect(def!.eventTypes ?? null).toEqual(eventTypes);
  });

  it("la unión TriggerType y el CHECK de la base conocen los mismos tipos de antes", () => {
    const source = readFileSync("lib/types/database.ts", "utf8");
    const decl = source.slice(source.indexOf("export type TriggerType"));
    const block = decl.slice(0, decl.indexOf(";") + 1);
    for (const [type] of BEFORE) {
      expect(block, `TriggerType no menciona ${type}`).toContain(`"${type}"`);
    }
  });
});
