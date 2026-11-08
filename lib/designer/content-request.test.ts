import { describe, expect, it } from "vitest";
import { buildPieceRequest, designTextParts, pickTargetForPiece, scriptParts, type PieceBrief } from "./content-request";
import { docWithPages } from "./testing/content-fixtures";
import { PLACEHOLDER_TEXT } from "./screens/starter-docs";
import { MAX_PAGES } from "./formats";
import type { DesignDoc } from "./doc/schema";

const FIVE = ["Frená el scroll con una pregunta.", "El problema que casi nadie nombra.", "Lo que hacen los que sí avanzan.", "Un ejemplo con números simples.", "Escribinos CARRUSEL y te mandamos la guía."];

const piece = (over: Partial<PieceBrief> = {}): PieceBrief => ({
  postId: "bbbbbbbb-2222-3333-4444-555555555555",
  title: "Cómo ordenar tu semana",
  script: FIVE.join("\n\n"),
  caption: "Una semana ordenada rinde el doble.",
  pillar: "Productividad",
  offer: "Programa Ejemplo",
  funnelStage: "mofu",
  ...over,
});

describe("scriptParts", () => {
  it("separa por líneas en blanco y descarta lo vacío", () => {
    expect(scriptParts("Uno\n\nDos\r\n\r\n  \n\nTres  ")).toEqual(["Uno", "Dos", "Tres"]);
  });

  it("un renglón solo es una parte; sin guion, ninguna", () => {
    expect(scriptParts("Una sola\ncon dos renglones")).toEqual(["Una sola\ncon dos renglones"]);
    expect(scriptParts(null)).toEqual([]);
    expect(scriptParts("  \n ")).toEqual([]);
  });
});

describe("el pedido a la IA desde una pieza (F62)", () => {
  it("CRITERIO: guion de 5 partes y red Instagram Carrusel → diseño v45 con las 5 partes en el pedido", () => {
    const out = buildPieceRequest({ piece: piece(), platform: "instagram", existingFormat: "carousel" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.format).toBe("v45");
    expect(out.multiPage).toBe(true);
    expect(out.pages).toBe(5);
    expect(out.target.label).toBe("Instagram · Carrusel");
    // Las 5 partes, en el pedido (una por página) y en el contexto.
    expect(out.contentContext.script).toEqual(FIVE);
    for (const [i, part] of FIVE.entries()) expect(out.prompt).toContain(`Página ${i + 1}: ${part}`);
    expect(out.prompt).toContain("El guion tiene 5 partes: armá 5 páginas, una por cada parte, en este orden.");
    expect(out.prompt).toContain("Vertical 4:5 (1080×1350)");
  });

  it("el contexto lleva la pieza: caption, pilar, oferta y la etapa con su nombre", () => {
    const out = buildPieceRequest({ piece: piece(), platform: "instagram", existingFormat: "carousel" });

    expect(out.ok && out.contentContext).toMatchObject({
      postId: "bbbbbbbb-2222-3333-4444-555555555555",
      network: "Instagram · Carrusel",
      caption: "Una semana ordenada rinde el doble.",
      pillar: "Productividad",
      offer: "Programa Ejemplo",
      funnelStage: "Consideración",
    });
  });

  it("sin la red elegida en la pieza, un guion de varias partes va a un carrusel y uno de una parte a una imagen", () => {
    const many = buildPieceRequest({ piece: piece(), platform: "instagram" });
    const one = buildPieceRequest({ piece: piece({ script: "Solo una idea" }), platform: "instagram" });

    expect(many.ok && many.target.format).toBe("carousel");
    expect(one.ok && one.target.format).toBe("image");
    expect(one.ok && one.pages).toBe(1);
    expect(one.ok && one.multiPage).toBe(false);
  });

  it("LinkedIn con varias partes es un carrusel PDF; con una parte, una imagen cuadrada", () => {
    const pdf = buildPieceRequest({ piece: piece(), platform: "linkedin" });
    const image = buildPieceRequest({ piece: piece({ script: "Una" }), platform: "linkedin" });

    expect(pdf.ok && [pdf.target.format, pdf.format, pdf.pages]).toEqual(["pdf", "v45", 5]);
    expect(image.ok && [image.target.format, image.format]).toEqual(["image", "sq"]);
  });

  it("una historia nace en 9:16 y TikTok también", () => {
    const story = buildPieceRequest({ piece: piece(), platform: "instagram", existingFormat: "story" });
    const tiktok = buildPieceRequest({ piece: piece(), platform: "tiktok" });

    expect(story.ok && story.format).toBe("story");
    expect(tiktok.ok && [tiktok.target.format, tiktok.format]).toEqual(["photos", "story"]);
  });

  it("el formato que la pieza ya tenía en mente se respeta si sirve para la red", () => {
    const sq = buildPieceRequest({ piece: piece(), platform: "instagram", existingFormat: "carousel", preferredFormat: "sq" });
    const wrong = buildPieceRequest({ piece: piece(), platform: "instagram", existingFormat: "carousel", preferredFormat: "story" });

    expect(sq.ok && sq.format).toBe("sq");
    expect(wrong.ok && wrong.format).toBe("v45");
  });

  it("un carrusel con una sola parte pide al menos las páginas que la red necesita y le dice a la IA que complete", () => {
    const out = buildPieceRequest({ piece: piece({ script: "Una sola parte" }), platform: "instagram", existingFormat: "carousel" });

    expect(out.ok && out.pages).toBe(2);
    expect(out.ok && out.prompt).toContain("Completá hasta 2 páginas con una portada y un cierre.");
  });

  it("sin guion no inventa páginas: le pide a la IA una propuesta desde el título y el caption", () => {
    const out = buildPieceRequest({ piece: piece({ script: null }), platform: "instagram", existingFormat: "carousel" });

    expect(out.ok && out.pages).toBeNull();
    expect(out.ok && out.contentContext.script).toEqual([]);
    expect(out.ok && out.prompt).toContain("Todavía no hay guion");
  });

  it("más partes que el máximo de páginas: se pide el máximo y las últimas se resumen en la última", () => {
    const parts = Array.from({ length: 25 }, (_, i) => `Parte ${i + 1}`);
    const out = buildPieceRequest({ piece: piece({ script: parts.join("\n\n") }), platform: "tiktok" });

    expect(out.ok && out.pages).toBe(MAX_PAGES);
    expect(out.ok && out.prompt).toContain(`Las partes ${MAX_PAGES + 1} a 25 se resumen en la última página.`);
    // El contexto conserva todas.
    expect(out.ok && out.contentContext.script).toHaveLength(25);
  });

  it("un guion enorme no rompe el tope del pedido ni del contexto", () => {
    const huge = Array.from({ length: 12 }, (_, i) => `${i}: ${"palabra ".repeat(900)}`).join("\n\n");
    const out = buildPieceRequest({ piece: piece({ script: huge }), platform: "instagram", existingFormat: "carousel" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.prompt.length).toBeLessThanOrEqual(3800);
    expect(out.contentContext.script.every((p) => p.length <= 2000)).toBe(true);
  });

  it("una red que no se arma con un diseño devuelve un error claro", () => {
    for (const platform of ["youtube", "facebook"]) {
      const out = buildPieceRequest({ piece: piece(), platform });
      expect(out).toEqual({ ok: false, error: "Esa red no se arma con un diseño. Elegí otra." });
    }
  });

  it("un formato de la red que no se arma con un diseño (un Reel) cae al que corresponde al guion", () => {
    const out = buildPieceRequest({ piece: piece(), platform: "instagram", existingFormat: "reel" });

    expect(out.ok && out.target.format).toBe("carousel");
  });

  it("el nombre del diseño lleva la pieza y la red, y cabe en el límite", () => {
    const out = buildPieceRequest({ piece: piece({ title: "x".repeat(400) }), platform: "instagram", existingFormat: "carousel" });

    expect(out.ok && out.name.length).toBeLessThanOrEqual(200);
    const short = buildPieceRequest({ piece: piece(), platform: "instagram", existingFormat: "carousel" });
    expect(short.ok && short.name).toBe("Cómo ordenar tu semana · Instagram · Carrusel");
    const untitled = buildPieceRequest({ piece: piece({ title: "  " }), platform: "instagram", existingFormat: "carousel" });
    expect(untitled.ok && untitled.name).toBe("Pieza · Instagram · Carrusel");
  });

  it("sin pilar, oferta ni etapa los deja vacíos (nada inventado)", () => {
    const out = buildPieceRequest({ piece: piece({ pillar: null, offer: null, funnelStage: null, caption: null }), platform: "instagram", existingFormat: "carousel" });

    expect(out.ok && out.contentContext).toMatchObject({ pillar: null, offer: null, funnelStage: null, caption: null });
  });
});

describe("pickTargetForPiece", () => {
  it("respeta el formato de la red si se arma con un diseño", () => {
    expect(pickTargetForPiece({ platform: "threads", existingFormat: "image", parts: 5 })?.format).toBe("image");
  });

  it("sin nada elige por la cantidad de partes", () => {
    expect(pickTargetForPiece({ platform: "threads", parts: 0 })?.format).toBe("image");
    expect(pickTargetForPiece({ platform: "threads", parts: 3 })?.format).toBe("carousel");
    expect(pickTargetForPiece({ platform: "youtube", parts: 3 })).toBeNull();
  });
});

describe("el texto de un diseño para el copywriter", () => {
  const withText = (texts: Array<Array<{ x: number; y: number; text: string }>>): DesignDoc => {
    const doc = docWithPages("v45", texts.length);
    texts.forEach((page, i) => {
      doc.pages[i].elements = page.map((t, j) => ({ id: `el_${i}${j}`, type: "text", x: t.x, y: t.y, w: 60, text: t.text }) as never);
    });
    return doc;
  };

  it("junta el texto de cada página, de arriba hacia abajo, y descarta las vacías y el relleno", () => {
    const doc = withText([
      [{ x: 50, y: 70, text: "Segundo" }, { x: 50, y: 20, text: "Primero" }],
      [{ x: 50, y: 50, text: PLACEHOLDER_TEXT }],
      [{ x: 50, y: 50, text: "Hola {{contact.first_name}}, bienvenida" }],
    ]);

    expect(designTextParts(doc)).toEqual(["Primero\nSegundo", "Hola , bienvenida"]);
  });

  it("un diseño sin texto no da nada", () => {
    expect(designTextParts(docWithPages("sq", 3))).toEqual([]);
  });
});
