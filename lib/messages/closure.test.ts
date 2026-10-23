import { describe, expect, it } from "vitest";
import cases from "./closure.cases.json";
import { isClosureMessage, isClosureRun, normalizeClosureText } from "./closure";

describe("isClosureMessage: los casos compartidos con el SQL", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const attachments = (c as { attachments?: string[] }).attachments ?? [];
      expect(isClosureMessage({ text: c.text, attachmentKinds: attachments }, c.lastReply)).toBe(c.expected);
    });
  }
});

describe("isClosureRun", () => {
  it("una pregunta en la tanda la deja esperando aunque termine en gracias", () => {
    expect(isClosureRun([{ text: "¿cuánto sale?" }, { text: "gracias" }], null)).toBe(false);
  });

  it("toda la tanda de cierre cierra", () => {
    expect(isClosureRun([{ text: "genial" }, { text: "gracias!" }, { text: "🙌" }], null)).toBe(true);
  });

  it("una tanda vacia no cierra nada", () => {
    expect(isClosureRun([], null)).toBe(false);
  });
});

describe("normalizeClosureText", () => {
  it("saca tildes con la misma tabla que el SQL y colapsa letras repetidas", () => {
    expect(normalizeClosureText("BUENÍSIMOOO Mañana")).toBe("buenisimo manana");
  });

  it("deja las dobles (ll, rr) como estan", () => {
    expect(normalizeClosureText("llamame")).toBe("llamame");
  });
});
