import { describe, expect, it } from "vitest";
import type { HtmlInspection } from "../contracts";
import { assetsText, checkPickedFile, choiceProblem, formatOptions, helpText, initialChoice, loadAsText, stepValue } from "./html-step";

const inspection = (over: Partial<HtmlInspection["detected"]> = {}, removed: Partial<HtmlInspection["removed"]> = {}): HtmlInspection => ({
  uploadId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  fileName: "archivo.zip",
  detected: { as: "slides", format: "wide", pages: 5, label: "Presentación · 5 diapositivas de 1920 × 1080", ...over },
  removed: { scripts: 0, iframes: 0, forms: 0, other: 0, summary: null, ...removed },
  assets: { images: 8, fonts: 2 },
});

describe("el paso «Archivo» del modal Nuevo", () => {
  it("solo acepta .html, .htm y .zip, con sus topes", () => {
    expect(checkPickedFile({ name: "landing.html", size: 1000 })).toEqual({ ok: true });
    expect(checkPickedFile({ name: "LANDING.HTM", size: 1000 })).toEqual({ ok: true });
    expect(checkPickedFile({ name: "sitio.zip", size: 49 * 1024 * 1024 })).toEqual({ ok: true });
    expect(checkPickedFile({ name: "foto.png", size: 10 })).toEqual({ ok: false, error: "Subí un archivo .html o un .zip." });
    expect(checkPickedFile({ name: "landing.html", size: 6 * 1024 * 1024 })).toMatchObject({ ok: false, error: expect.stringContaining("5 MB") });
    expect(checkPickedFile({ name: "sitio.zip", size: 51 * 1024 * 1024 })).toMatchObject({ ok: false, error: expect.stringContaining("50 MB") });
    expect(checkPickedFile({ name: "vacio.html", size: 0 })).toMatchObject({ ok: false });
  });

  it("«¿Es correcto?» ofrece las dos opciones en un diseño y solo la presentación en una plantilla", () => {
    expect(formatOptions("design").map((o) => o.label)).toEqual(["Página web", "Presentación (cada sección es una diapositiva)"]);
    expect(formatOptions("template").map((o) => o.key)).toEqual(["slides"]);
  });

  it("arranca con lo detectado; una plantilla siempre como presentación", () => {
    expect(initialChoice("design", inspection({ as: "web", format: "web", pages: 1 }))).toBe("web");
    expect(initialChoice("design", inspection())).toBe("slides");
    expect(initialChoice("template", inspection({ as: "web", format: "web", pages: 1 }))).toBe("slides");
  });

  it("avisa cuando la persona eligió otra cosa que lo detectado", () => {
    expect(loadAsText("slides", inspection())).toBeNull();
    expect(loadAsText("web", inspection())).toBe("Se va a cargar como página web: una sola página con scroll.");
    expect(loadAsText("slides", inspection({ as: "web", format: "web", pages: 1 }))).toBe("Se va a cargar como presentación: cada sección será una diapositiva.");
  });

  it("más de 20 diapositivas no se puede cargar como presentación", () => {
    expect(choiceProblem("slides", inspection({ pages: 21 }))).toContain("21 diapositivas");
    expect(choiceProblem("web", inspection({ pages: 21 }))).toBeNull();
    expect(choiceProblem("slides", inspection({ pages: 20 }))).toBeNull();
  });

  it("el texto de imágenes y fuentes", () => {
    expect(assetsText({ images: 8, fonts: 2 })).toBe("8 imágenes guardadas · 2 fuentes guardadas");
    expect(assetsText({ images: 1, fonts: 0 })).toBe("1 imagen guardada");
    expect(assetsText({ images: 0, fonts: 1 })).toBe("1 fuente guardada");
    expect(assetsText({ images: 0, fonts: 0 })).toBe("El archivo no trae imágenes ni fuentes propias");
  });

  it("la ayuda de los scripts, con lo de las variables solo en plantillas", () => {
    expect(helpText("design")).toContain("Los scripts del archivo se quitan por seguridad");
    expect(helpText("design")).not.toContain("variables");
    expect(helpText("template")).toContain("convertir partes en variables");
  });

  it("al modal le llega el archivo leído y la opción, o nada", () => {
    expect(stepValue(null, null)).toBeNull();
    expect(stepValue(inspection(), null)).toBeNull();
    expect(stepValue(inspection(), "slides")).toEqual({ uploadId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", as: "slides" });
    expect(stepValue(inspection({ pages: 25 }), "slides")).toBeNull();
    expect(stepValue(inspection({ pages: 25 }), "web")).toEqual({ uploadId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", as: "web" });
  });
});
