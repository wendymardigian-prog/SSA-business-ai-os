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

describe("aiLanguageStyle con el tono de un negocio (00266)", () => {
  it("el del negocio gana sobre el de la instalacion", () => {
    process.env.AI_LANGUAGE_STYLE = "español rioplatense (vos/tenés)";
    expect(aiLanguageStyle("español mexicano (tú)")).toBe("español mexicano (tú)");
  });

  it("sin tono propio (null, vacio o espacios), el de la instalacion", () => {
    process.env.AI_LANGUAGE_STYLE = "español rioplatense (vos/tenés)";
    expect(aiLanguageStyle(null)).toBe("español rioplatense (vos/tenés)");
    expect(aiLanguageStyle("  ")).toBe("español rioplatense (vos/tenés)");
  });
});
