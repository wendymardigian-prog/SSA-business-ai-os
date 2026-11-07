import { describe, it, expect } from "vitest";
import { eventShareText, formShareText, plainText, shareVersion, titleFontSize, truncateText } from "./text";

describe("plainText", () => {
  it("saca las marcas de un markdown y deja lo que se lee", () => {
    expect(plainText("# Hola\n\n**Una** reunión con *vos* y [mi equipo](https://x.com).\n- punto uno\n> cita")).toBe("Hola Una reunión con vos y mi equipo. punto uno cita");
  });
  it("saca imágenes y etiquetas", () => {
    expect(plainText("![foto](a.png) <b>texto</b>")).toBe("texto");
  });
  it("no rompe un guion bajo adentro de una palabra", () => {
    expect(plainText("usa snake_case_name y _esto_")).toBe("usa snake_case_name y esto");
  });
  it("sin texto da vacío", () => {
    expect(plainText(null)).toBe("");
    expect(plainText("   ")).toBe("");
  });
});

describe("truncateText", () => {
  it("un texto que entra queda igual", () => {
    expect(truncateText("hola", 10)).toBe("hola");
  });
  it("corta en una palabra y no se pasa del máximo", () => {
    const out = truncateText("una reunión para hablar de tu negocio", 20);
    expect(out).toBe("una reunión para…");
    expect(out.length).toBeLessThanOrEqual(20);
  });
  it("una palabra sola muy larga también se corta", () => {
    expect(truncateText("a".repeat(30), 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("eventShareText", () => {
  const base = { title: "Consulta inicial", hostName: "Ana", durationMinutes: 30, description: null };

  it("sin descripción arma una con la duración y el anfitrión", () => {
    expect(eventShareText(base)).toEqual({
      title: "Consulta inicial · Ana",
      description: "30 min con Ana. Elegí un horario.",
      imageTitle: "Consulta inicial",
      imageSubtitle: "30 min · con Ana",
    });
  });
  it("con descripción usa su texto plano", () => {
    expect(eventShareText({ ...base, description: "**Hablemos** de tu negocio" }).description).toBe("Hablemos de tu negocio");
  });
  it("sin duración no deja un separador suelto", () => {
    const out = eventShareText({ ...base, durationMinutes: null });
    expect(out.imageSubtitle).toBe("con Ana");
    expect(out.description).toBe("Elegí un horario con Ana.");
  });
});

describe("formShareText", () => {
  it("usa el título y la introducción del formulario", () => {
    expect(formShareText({ title: "Aplicá", intro: "Contanos de **vos**", businessName: "Negocio" })).toEqual({
      title: "Aplicá",
      description: "Contanos de vos",
      imageTitle: "Aplicá",
      imageSubtitle: "Negocio",
    });
  });
  it("sin título usa el negocio, y sin introducción no inventa una descripción", () => {
    const out = formShareText({ title: "  ", intro: null, businessName: "Negocio" });
    expect(out.title).toBe("Negocio");
    expect(out).not.toHaveProperty("description");
  });
});

describe("titleFontSize", () => {
  it("achica los títulos largos", () => {
    expect(titleFontSize("corto")).toBeGreaterThan(titleFontSize("a".repeat(40)));
    expect(titleFontSize("a".repeat(40))).toBeGreaterThan(titleFontSize("a".repeat(80)));
  });
});

describe("shareVersion", () => {
  it("es la misma con los mismos datos y cambia si cambia alguno", () => {
    expect(shareVersion(["a", "b"])).toBe(shareVersion(["a", "b"]));
    expect(shareVersion(["a", "b"])).not.toBe(shareVersion(["a", "c"]));
    expect(shareVersion(["a", null])).not.toBe(shareVersion(["a", "null"]));
  });
});
