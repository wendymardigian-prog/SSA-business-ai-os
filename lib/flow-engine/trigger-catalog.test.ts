import { describe, expect, it } from "vitest";
import { applyTriggerChoice, chosenType, filterTriggerChoices, hasTriggerConfig, triggerChoices, triggerDisplayLabel } from "./trigger-catalog";

describe("triggerChoices", () => {
  it("Ventas se ofrece con sus atajos y el resto con un tipo por opcion", () => {
    const choices = triggerChoices();
    expect(choices.some((c) => c.key === "sales:payment_paid" && c.type === "payment_status_changed")).toBe(true);
    expect(choices.filter((c) => c.type === "keyword")).toHaveLength(1);
  });
});

describe("filterTriggerChoices", () => {
  const choices = triggerChoices();
  it("busca sin tildes, por sinonimo y por grupo", () => {
    expect(filterTriggerChoices(choices, "reunion").map((c) => c.type)).toContain("booking_created");
    expect(filterTriggerChoices(choices, "tag").map((c) => c.type)).toContain("crm_event");
    expect(filterTriggerChoices(choices, "agenda cancelo").map((c) => c.type)).toEqual(["booking_cancelled"]);
    expect(filterTriggerChoices(choices, "   ")).toHaveLength(choices.length);
  });
});

describe("applyTriggerChoice", () => {
  const choice = (key: string) => triggerChoices().find((c) => c.key === key)!;
  it("pone el tipo y sus valores por defecto, sin arrastrar lo del anterior", () => {
    const next = applyTriggerChoice({ label: "Arranque", triggerType: "keyword", keywords: [{ value: "hola" }] }, choice("crm_event"));
    expect(next).toEqual({ label: "Arranque", triggerType: "crm_event", event: "tag_added" });
  });
  it("un atajo de Ventas deja elegida su configuracion", () => {
    expect(applyTriggerChoice({}, choice("sales:payment_paid"))).toEqual({ triggerType: "payment_status_changed", to_status: ["paid"] });
    expect(applyTriggerChoice({}, choice("sales:payment_before_due"))).toMatchObject({ offset_days: 3, at_time: "09:00" });
  });
});

describe("nombres y estado", () => {
  it("sin elegir, viejo sin clave y atajos", () => {
    expect(chosenType({ triggerType: null })).toBeNull();
    expect(chosenType({})).toBe("keyword");
    expect(triggerDisplayLabel({ triggerType: null })).toBe("Elegí cómo arranca");
    expect(triggerDisplayLabel({ triggerType: "booking_created" })).toBe("Se agendó una reunión");
    expect(triggerDisplayLabel({ triggerType: "payment_status_changed", to_status: ["paid"] })).toBe("Pago cobrado");
  });
  it("hasTriggerConfig", () => {
    expect(hasTriggerConfig({ triggerType: "keyword", keywords: [], label: "x" })).toBe(false);
    expect(hasTriggerConfig({ triggerType: "keyword", keywords: [{ value: "a" }] })).toBe(true);
  });
});
