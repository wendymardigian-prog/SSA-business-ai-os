import { describe, expect, it } from "vitest";
import { isCuratedFont } from "./fonts";
import { FORMAT_KEYS } from "./formats";
import { availableStyles, FACTORY_STYLES, findStyle, styleSchema, wordsPerPage } from "./styles";

describe("estilos de fábrica (F13)", () => {
  it("son seis, con los nombres del plano", () => {
    expect(FACTORY_STYLES.map((s) => s.name)).toEqual(["Automático", "Dinámico de redes", "Editorial serio", "Minimal", "Impacto", "Cálido y personal"]);
  });

  it.each(FACTORY_STYLES.map((s) => [s.name, s] as const))("%s es válido y sus fuentes están en la lista curada", (_n, style) => {
    expect(styleSchema.safeParse(style).success).toBe(true);
    expect(isCuratedFont(style.fonts.title)).toBe(true);
    expect(isCuratedFont(style.fonts.body)).toBe(true);
  });

  it("todos dicen su densidad para cada formato", () => {
    for (const style of FACTORY_STYLES) for (const format of FORMAT_KEYS) expect(style.density[format], `${style.key}/${format}`).toBeGreaterThan(0);
  });

  it("un estilo propio archivado no se ofrece ni se encuentra", () => {
    const own = { ...FACTORY_STYLES[1], key: "c_abcd", name: "Mío", archived: true };
    expect(availableStyles([own]).some((s) => s.key === "c_abcd")).toBe(false);
    expect(findStyle("c_abcd", [own])).toBeUndefined();
    expect(findStyle("c_abcd", [{ ...own, archived: false }])?.name).toBe("Mío");
  });

  it("las palabras por página caen al valor por defecto", () => {
    expect(wordsPerPage(undefined, "story")).toBe(22);
    expect(wordsPerPage(findStyle("minimal"), "v45")).toBe(18);
  });
});
