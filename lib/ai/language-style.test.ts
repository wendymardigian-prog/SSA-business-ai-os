import { describe, it, expect, afterEach } from "vitest";
import { aiLanguageStyle } from "./language-style";

afterEach(() => {
  delete process.env.AI_LANGUAGE_STYLE;
});

describe("aiLanguageStyle", () => {
  it("usa un estilo neutro si no esta configurado", () => {
    expect(aiLanguageStyle()).toBe("español neutro, directo y sin relleno");
  });

  it("usa AI_LANGUAGE_STYLE si esta configurado", () => {
    process.env.AI_LANGUAGE_STYLE = "español rioplatense (vos/tenés)";
    expect(aiLanguageStyle()).toBe("español rioplatense (vos/tenés)");
  });

  it("ignora un valor vacio o solo espacios", () => {
    process.env.AI_LANGUAGE_STYLE = "   ";
    expect(aiLanguageStyle()).toBe("español neutro, directo y sin relleno");
  });
});
