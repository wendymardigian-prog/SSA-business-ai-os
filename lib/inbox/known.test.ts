import { describe, expect, it } from "vitest";
import cases from "./known.cases.json";
import { canUnmarkKnown, checkKnownSettings, knownAssignee, knownGate, knownLabel, parseKnownSettings } from "./known";

describe("knownAssignee (casos compartidos con private.known_assignee)", () => {
  it.each(cases)("$name", (c) => {
    expect(knownAssignee(c.settings, c.channel, c.members, c.owner)).toBe(c.expected);
  });
});

describe("knownGate", () => {
  const base = { isKnown: true, markedBy: "ana", assignedTo: "beto", viewerId: "caro" };

  it("otra persona ve el aviso", () => {
    expect(knownGate(base)).toBe(true);
  });

  it("quien lo marcó y el responsable entran directo", () => {
    expect(knownGate({ ...base, viewerId: "ana" })).toBe(false);
    expect(knownGate({ ...base, viewerId: "beto" })).toBe(false);
  });

  it("si no es conocido, nunca", () => {
    expect(knownGate({ ...base, isKnown: false })).toBe(false);
  });
});

describe("checkKnownSettings", () => {
  const known = { memberIds: ["ana", "beto"], channelIds: ["ch1", "ch2"] };

  it("acepta y descarta las cuentas vacías", () => {
    expect(checkKnownSettings({ byChannel: { ch1: "ana", ch2: "" }, defaultUserId: "beto" }, known)).toEqual({
      ok: true,
      value: { byChannel: { ch1: "ana" }, defaultUserId: "beto" },
    });
  });

  it("rechaza gente o cuentas que no existen", () => {
    expect(checkKnownSettings({ byChannel: { ch1: "zz" } }, known).ok).toBe(false);
    expect(checkKnownSettings({ byChannel: { zz: "ana" } }, known).ok).toBe(false);
    expect(checkKnownSettings({ defaultUserId: "zz" }, known).ok).toBe(false);
  });
});

describe("parseKnownSettings, knownLabel y canUnmarkKnown", () => {
  it("tolera basura", () => {
    expect(parseKnownSettings(null)).toEqual({ byChannel: {}, defaultUserId: null });
    expect(parseKnownSettings({ by_channel: [1], default_user_id: 3 })).toEqual({ byChannel: {}, defaultUserId: null });
  });

  it("dice de quién es", () => {
    expect(knownLabel("Ana")).toBe("Conocido de Ana");
    expect(knownLabel(null)).toBe("Conocido");
  });

  it("quita la marca quien la puso o quien borra contactos", () => {
    expect(canUnmarkKnown({ viewerId: "ana", markedBy: "ana", canDeleteContacts: false })).toBe(true);
    expect(canUnmarkKnown({ viewerId: "beto", markedBy: "ana", canDeleteContacts: false })).toBe(false);
    expect(canUnmarkKnown({ viewerId: "beto", markedBy: "ana", canDeleteContacts: true })).toBe(true);
    expect(canUnmarkKnown({ viewerId: "beto", markedBy: null, canDeleteContacts: false })).toBe(false);
  });
});
