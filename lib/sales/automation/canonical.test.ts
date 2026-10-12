import { describe, expect, it } from "vitest";
import { pickCanonicalTrigger } from "./triggers";

describe("pickCanonicalTrigger", () => {
  it("gana el de menor (prioridad, trigger, evento), sin importar el orden de entrada", () => {
    const a = { triggerId: "t-b", priority: 45, eventId: "e1" };
    const b = { triggerId: "t-a", priority: 45, eventId: "e2" };
    const c = { triggerId: "t-a", priority: 60, eventId: "e1" };
    expect(pickCanonicalTrigger([a, b, c])).toEqual(b);
    expect(pickCanonicalTrigger([c, b, a])).toEqual(b);
    expect(pickCanonicalTrigger([b, a])).toEqual(b);
  });
  it("con el mismo trigger y dos eventos, gana el evento menor", () => {
    expect(pickCanonicalTrigger([{ triggerId: "t", priority: 1, eventId: "e2" }, { triggerId: "t", priority: 1, eventId: "e1" }])?.eventId).toBe("e1");
  });
  it("sin candidatos no hay ganador", () => {
    expect(pickCanonicalTrigger([])).toBeNull();
  });
});
