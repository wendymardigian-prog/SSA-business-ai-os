import { describe, expect, it } from "vitest";
import { CURATED_FONTS } from "../fonts";
import { findStyle, type DesignStyle } from "../styles";
import type { DesignDoc } from "../doc/schema";
import type { MeasuredPage } from "../render-client";
import type { MeasureFn } from "./measure";
import type { DesignerGenerate, DesignerGenerateArgs } from "./provider";
import { COULD_NOT_APPLY, runDesignerEngine, styleTextProblem, textsOf, type EngineInput, type EnginePorts } from "./run";
import { carousel, page, textEl, WS } from "./test-fixtures";

const social = findStyle("social") as DesignStyle;
const allowedFonts = CURATED_FONTS.map((f) => f.family);
const photo = `${WS}/images/aaaaaaaa-0000-0000-0000-000000000001.png`;

const textJson = (text: string, over: Record<string, unknown> = {}) => ({
  type: "text",
  x: 50,
  y: 50,
  w: 80,
  text,
  font: { family: "Inter", weight: 700 },
  size: 64,
  align: "center",
  color: "#ffffff",
  ...over,
});
const pageJson = (...texts: string[]) => ({ background: { type: "color", color: "#101010" }, elements: texts.map((t, i) => textJson(t, { y: 30 + i * 20 })) });

/** Un proveedor simulado: contesta en orden y guarda lo que recibió. */
function fakeProvider(responses: unknown[]) {
  const calls: DesignerGenerateArgs<unknown>[] = [];
  const generate: DesignerGenerate = async <T,>(args: DesignerGenerateArgs<T>) => {
    calls.push(args as DesignerGenerateArgs<unknown>);
    const object = responses[Math.min(calls.length - 1, responses.length - 1)] as T;
    return { object, usage: { inputTokens: 10, outputTokens: 5 } };
  };
  return { generate, calls };
}

const noMeasure = (generate: DesignerGenerate): EnginePorts => ({ generate, measure: null, nonce: () => "n0nce" });

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  mode: "change",
  workspaceId: WS,
  format: "v45",
  isTemplate: false,
  style: social,
  brand: { name: "Academia Ejemplo", colorHex: "#c4d94a" },
  languageStyle: "español rioplatense",
  allowedFonts,
  doc: carousel(),
  request: "Hacé la portada más llamativa",
  scope: { page: null },
  attachments: [],
  fallbackBackground: "#0f1115",
  ...over,
});

const update = (index: number, id: string, set: Record<string, unknown>) => ({ index, ops: [{ op: "update", id, set }] });

describe("ai/run: primera versión (F33)", () => {
  const blank: DesignDoc = { v: 1, format: "v45", pages: [page("pg_blank001", [])] };

  it("con una imagen adjunta, la portada queda con la foto de fondo y una capa de color (proveedor simulado)", async () => {
    const provider = fakeProvider([{ message: "Armé un carrusel con tu foto.", doc: { pages: [pageJson("Hola mundo", "Tres ideas"), pageJson("Dos"), pageJson("Seguinos")] } }]);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const out = await runDesignerEngine(base({ mode: "first", doc: blank, request: "Un carrusel con mi foto", attachments: [{ path: photo, name: "foto.png", mime: "image/png", bytes }] }), noMeasure(provider.generate));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.pages[0].background.type).toBe("image");
    expect(out.doc.pages[0].background.image?.asset).toBe(photo);
    expect(out.doc.pages[0].background.overlay?.opacity).toBeGreaterThan(0);
    expect(out.doc.pages).toHaveLength(3);
    // La imagen viajó al modelo como imagen, con su nombre corto en el mensaje.
    expect(provider.calls[0].images[0]).toEqual({ bytes, mediaType: "image/png" });
    expect(provider.calls[0].text).toContain("imagen_1: foto.png");
  });

  it("la capa de color es más fuerte con letras claras que lo que decía la IA", async () => {
    const withWeakOverlay = { background: { type: "image", image: { asset: "imagen_1", fit: "cover", focal: { x: 50, y: 50 }, locked: false }, overlay: { color: "#000000", opacity: 0.05 } }, elements: [textJson("Título claro")] };
    const provider = fakeProvider([{ message: "Listo", doc: { pages: [withWeakOverlay, pageJson("Dos")] } }]);
    const out = await runDesignerEngine(base({ mode: "first", doc: blank, attachments: [{ path: photo, name: "f.png", mime: "image/png", bytes: new Uint8Array([1]) }] }), noMeasure(provider.generate));
    expect(out.ok && out.doc.pages[0].background.overlay?.opacity).toBeGreaterThanOrEqual(0.4); // un título grande pide 3:1
  });

  it("sin imágenes, no hay fondo de imagen ni capa", async () => {
    const provider = fakeProvider([{ message: "Listo", doc: { pages: [pageJson("Uno")] } }]);
    const out = await runDesignerEngine(base({ mode: "first", doc: blank }), noMeasure(provider.generate));
    expect(out.ok && out.doc.pages[0].background.type).toBe("color");
  });

  it("en un formato impreso la foto no se pone sola de portada", async () => {
    const certificate: DesignDoc = { v: 1, format: "carta_h", pages: [page("pg_blank001", [])] };
    const provider = fakeProvider([{ message: "Listo", doc: { pages: [pageJson("Certificado")] } }]);
    const out = await runDesignerEngine(base({ mode: "first", format: "carta_h", doc: certificate, attachments: [{ path: photo, name: "f.png", mime: "image/png", bytes: new Uint8Array([1]) }] }), noMeasure(provider.generate));
    expect(out.ok && out.doc.pages[0].background.type).toBe("color");
  });

  it("corrige una fuente fuera de la lista a la más cercana", async () => {
    const provider = fakeProvider([{ message: "Listo", doc: { pages: [{ background: { type: "color", color: "#101010" }, elements: [textJson("Hola", { font: { family: "Montserat", weight: 800 } })] }] } }]);
    const out = await runDesignerEngine(base({ mode: "first", doc: blank }), noMeasure(provider.generate));
    const el = out.ok ? out.doc.pages[0].elements[0] : null;
    expect(el && el.type === "text" && el.font.family).toBe("Montserrat");
  });

  it("fija el formato y el estilo del documento aunque la IA diga otra cosa", async () => {
    const provider = fakeProvider([{ message: "Listo", doc: { style: "impact", pages: [pageJson("Hola")] } }]);
    const out = await runDesignerEngine(base({ mode: "first", doc: blank }), noMeasure(provider.generate));
    expect(out.ok && out.doc.format).toBe("v45");
    expect(out.ok && out.doc.style).toBe("social");
  });
});

describe("ai/run: reintento y «No pude aplicar ese cambio» (F32)", () => {
  it("si la salida no valida, reintenta UNA vez con el motivo y aplica lo que llega bien", async () => {
    const provider = fakeProvider([
      { message: "x", patch: { pages: [update(0, "el_fantasma", { size: 90 })] } },
      { message: "Listo", patch: { pages: [update(0, "el_title01", { size: 90 })] } },
    ]);
    const out = await runDesignerEngine(base(), noMeasure(provider.generate));
    expect(out.ok).toBe(true);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].text).toContain("no existe el elemento el_fantasma");
    if (out.ok) expect((out.doc.pages[0].elements[0] as { size: number }).size).toBe(90);
  });

  it("si vuelve a fallar, dice «No pude aplicar ese cambio» y no devuelve ningún diseño", async () => {
    const bad = { message: "x", patch: { pages: [update(0, "el_fantasma", { size: 90 })] } };
    const provider = fakeProvider([bad, bad, bad]);
    const out = await runDesignerEngine(base(), noMeasure(provider.generate));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toBe(COULD_NOT_APPLY);
      expect(out.problems.join(" ")).toMatch(/el_fantasma/);
    }
    expect(provider.calls).toHaveLength(2);
  });

  it("una respuesta que ni siquiera tiene la forma pedida también se reintenta", async () => {
    const provider = fakeProvider([{ nada: true }, { message: "Listo", patch: { pages: [] } }]);
    const out = await runDesignerEngine(base(), noMeasure(provider.generate));
    expect(out.ok).toBe(true);
    expect(provider.calls).toHaveLength(2);
  });

  it("un documento que no valida por los porcentajes se arregla sin gastar otra llamada", async () => {
    const provider = fakeProvider([{ message: "Listo", patch: { pages: [update(0, "el_title01", { opacity: 4 })] } }]);
    const out = await runDesignerEngine(base(), noMeasure(provider.generate));
    expect(out.ok && out.doc.pages[0].elements[0].opacity).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("suma el uso de cada llamada para el costo", async () => {
    const provider = fakeProvider([{ message: "x", patch: { pages: [update(0, "el_fantasma", {})] } }, { message: "Listo", patch: { pages: [] } }]);
    const usages: unknown[] = [];
    await runDesignerEngine(base(), { ...noMeasure(provider.generate), onUsage: (u) => usages.push(u) });
    expect(usages).toHaveLength(2);
  });
});

describe("ai/run: alcance (F34)", () => {
  it("con «Solo la página 2», un parche que toca otra se descarta y se reintenta", async () => {
    const provider = fakeProvider([
      { message: "x", patch: { pages: [update(0, "el_title01", { size: 90 }), update(1, "el_body001", { size: 90 })] } },
      { message: "Listo", patch: { pages: [update(1, "el_body001", { size: 90 })] } },
    ]);
    const out = await runDesignerEngine(base({ scope: { page: 1 } }), noMeasure(provider.generate));
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].text).toMatch(/fuera del alcance/);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.doc.pages[0].elements[0] as { size: number }).size).toBe(64);
      expect((out.doc.pages[1].elements[0] as { size: number }).size).toBe(90);
    }
  });

  it("«Agregá 2 láminas» agrega antes de la última si es el llamado a la acción", async () => {
    const provider = fakeProvider([{ message: "Sumé 2 láminas.", patch: { pages: [], newPages: [{ page: pageJson("Testimonio") }, { page: pageJson("Primer paso") }] } }]);
    const out = await runDesignerEngine(base(), noMeasure(provider.generate));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.doc.pages).toHaveLength(5);
      expect(out.doc.pages[4].id).toBe("pg_cta0001");
    }
  });
});

describe("ai/run: cambiar de estilo (F35)", () => {
  const minimal = findStyle("minimal") as DesignStyle;

  it("conserva los textos: las mismas cadenas en el resultado", async () => {
    const doc = carousel();
    const provider = fakeProvider([
      {
        message: `Rehice el diseño con el estilo «${minimal.name}».`,
        patch: {
          pages: doc.pages.map((p, i) => ({
            index: i,
            background: { type: "color", color: "#ffffff" },
            ops: p.elements.map((e) => ({ op: "update", id: e.id, set: { color: "#111111", font: { family: "Space Grotesk", weight: 700 } } })),
          })),
        },
      },
    ]);
    const out = await runDesignerEngine(base({ mode: "style", style: minimal, doc, request: "Rehacé con el estilo Minimal" }), noMeasure(provider.generate));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(textsOf(out.doc)).toEqual(textsOf(doc));
    expect(out.doc.style).toBe("minimal");
    expect(out.doc.pages[0].background.color).toBe("#ffffff");
  });

  it("un cambio que modifica un texto se rechaza y se reintenta", async () => {
    const doc = carousel();
    const provider = fakeProvider([
      { message: "x", patch: { pages: [update(0, "el_title01", { text: "OTRO TEXTO" })] } },
      { message: "Listo", patch: { pages: [update(0, "el_title01", { color: "#000000" })] } },
    ]);
    const out = await runDesignerEngine(base({ mode: "style", style: minimal, doc }), noMeasure(provider.generate));
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].text).toMatch(/conservar los textos/);
    expect(out.ok && textsOf(out.doc)).toEqual(textsOf(doc));
  });

  it("si la IA no consigue conservar los textos, no toca el diseño", async () => {
    const bad = { message: "x", patch: { pages: [update(0, "el_title01", { text: "OTRO" })] } };
    const out = await runDesignerEngine(base({ mode: "style", style: minimal }), noMeasure(fakeProvider([bad]).generate));
    expect(out.ok).toBe(false);
  });

  it("styleTextProblem mira el conjunto de textos, no dónde están", () => {
    const a = carousel();
    const b = carousel();
    b.pages[0].elements.push(textEl("el_extra001", "Un texto más"));
    expect(styleTextProblem(a, a)).toBeNull();
    expect(styleTextProblem(a, b)).toMatch(/conservar los textos/);
  });
});

describe("ai/run: propuesta de textos sobre una imagen base (F30)", () => {
  const withImage: DesignDoc = { v: 1, format: "carta_h", pages: [{ id: "pg_img00001", background: { type: "image", image: { asset: photo, fit: "cover", focal: { x: 50, y: 50 }, locked: true } }, elements: [] }] };

  it("devuelve el parche con textos y variables sobre la página 1, sin aplicar nada fuera de ella", async () => {
    const provider = fakeProvider([
      {
        message: "Puse el nombre y la fecha donde hay lugar.",
        documentKind: "certificado",
        patch: { pages: [{ index: 0, ops: [{ op: "add", element: textJson("{{contact.display_name}}", { color: "#111111", size: 48 }) }, { op: "add", element: textJson("{{design.issued_on}}", { y: 80, color: "#111111", size: 24 }) }] }] },
      },
    ]);
    const out = await runDesignerEngine(
      base({ mode: "propose_texts", format: "carta_h", isTemplate: true, doc: withImage, scope: { page: 0 }, attachments: [{ path: photo, name: "base.png", mime: "image/png", bytes: new Uint8Array([1]) }] }),
      noMeasure(provider.generate),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.documentKind).toBe("certificado");
    expect(out.patch?.pages[0].ops).toHaveLength(2);
    expect(out.doc.pages[0].elements.map((e) => e.type === "text" && e.text)).toEqual(["{{contact.display_name}}", "{{design.issued_on}}"]);
    // El fondo (la imagen base) no cambia.
    expect(out.doc.pages[0].background.image?.asset).toBe(photo);
    expect(out.doc.pages[0].background.image?.locked).toBe(true);
  });

  it("una propuesta que no agrega ningún texto se reintenta", async () => {
    const provider = fakeProvider([{ message: "x", patch: { pages: [] } }, { message: "Listo", patch: { pages: [{ index: 0, ops: [{ op: "add", element: textJson("Hola", { color: "#111111", size: 48 }) }] }] } }]);
    const out = await runDesignerEngine(base({ mode: "propose_texts", format: "carta_h", doc: withImage, scope: { page: 0 } }), noMeasure(provider.generate));
    expect(provider.calls).toHaveLength(2);
    expect(out.ok).toBe(true);
  });
});

describe("ai/run: la revisión automática (F36)", () => {
  /** Mide siempre el mismo problema: el primer texto se desborda. */
  const alwaysOverflow = (doc: DesignDoc): MeasuredPage[] =>
    doc.pages.map((p, i) => ({ page: i, elements: p.elements.map((e, j) => ({ id: e.id, x: 100, y: 400, w: 800, h: 120, overflow: i === 0 && j === 0, bgLuminance: 0.02 })) }));
  const measureOk: MeasureFn = async (doc) => ({ status: "ok", measure: alwaysOverflow(doc), images: doc.pages.map(() => new Uint8Array([9])) });

  it("nunca hace más de 2 pasadas de corrección, aunque el proveedor siempre devuelva el mismo problema", async () => {
    const provider = fakeProvider([
      { message: "Armé el cambio", patch: { pages: [] } },
      // Las correcciones no arreglan nada: el desborde sigue.
      { message: "Intento corregir", patch: { pages: [update(0, "el_title01", { size: 62 })] } },
      { message: "Intento corregir otra vez", patch: { pages: [update(0, "el_title01", { size: 60 })] } },
      { message: "Otra más", patch: { pages: [update(0, "el_title01", { size: 58 })] } },
    ]);
    const out = await runDesignerEngine(base(), { generate: provider.generate, measure: measureOk, nonce: () => "n" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.stats.corrections).toBe(2);
    expect(provider.calls).toHaveLength(3); // el cambio + 2 correcciones, ninguna más
    expect(out.warnings.join(" ")).toMatch(/página 1 hay un texto que se sale de su caja/);
    // La pasada de corrección ve la imagen renderizada y SOLO puede tocar las páginas con problemas.
    expect(provider.calls[1].images[0].bytes).toEqual(new Uint8Array([9]));
    expect(provider.calls[1].text).toMatch(/SOLO la página 1/);
  });

  it("si la corrección se pasa de alcance, no se aplica y el diseño queda como estaba (con aviso)", async () => {
    const provider = fakeProvider([
      { message: "Armé el cambio", patch: { pages: [] } },
      { message: "Me paso", patch: { pages: [update(1, "el_body001", { size: 99 })] } },
    ]);
    const out = await runDesignerEngine(base(), { generate: provider.generate, measure: measureOk, nonce: () => "n" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.doc.pages[1].elements[0] as { size: number }).size).toBe(64);
      expect(out.warnings.join(" ")).toMatch(/No pude hacer la corrección automática/);
    }
    expect(provider.calls).toHaveLength(2);
  });

  it("una corrección que falla por el proveedor no tumba el resultado", async () => {
    let n = 0;
    const generate: DesignerGenerate = async <T,>() => {
      n++;
      if (n === 2) throw new Error("boom");
      return { object: { message: "Listo", patch: { pages: [] } } as T };
    };
    const out = await runDesignerEngine(base(), { generate, measure: measureOk, nonce: () => "n" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.warnings.join(" ")).toMatch(/No pude hacer la corrección automática/);
  });

  it("sin servicio de render hace solo los chequeos que no lo necesitan y avisa", async () => {
    const doc = carousel("story");
    (doc.pages[0].elements[1] as { size: number }).size = 30; // por debajo de 40 px
    const provider = fakeProvider([
      { message: "Listo", patch: { pages: [] } },
      { message: "Corrijo la letra", patch: { pages: [update(0, "el_sub0001", { size: 44 })] } },
    ]);
    const out = await runDesignerEngine(base({ format: "story", doc }), { generate: provider.generate, measure: async () => ({ status: "unavailable", reason: "not_configured" }), nonce: () => "n" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.doc.pages[0].elements[1] as { size: number }).size).toBe(44);
      expect(out.warnings.join(" ")).toMatch(/falta conectar el servicio de render/);
    }
  });

  it("contraste sobre una foto: lo arregla con la capa de color, sin llamar a la IA para corregir", async () => {
    const doc = carousel();
    doc.pages[0].background = { type: "image", image: { asset: photo, fit: "cover", focal: { x: 50, y: 50 }, locked: false }, overlay: { color: "#0f1115", opacity: 0.3 } };
    const provider = fakeProvider([{ message: "Listo", patch: { pages: [] } }]);
    let measured = 0;
    const measure: MeasureFn = async (d) => {
      measured++;
      const overlay = d.pages[0].background.overlay?.opacity ?? 0;
      // La foto es clara (0.8): con poca capa el texto blanco no se lee.
      const lum = 0.8 * (1 - overlay) + 0.01 * overlay;
      return { status: "ok", measure: d.pages.map((p, i) => ({ page: i, elements: p.elements.map((e) => ({ id: e.id, x: 100, y: 400, w: 800, h: 120, overflow: false, bgLuminance: i === 0 ? lum : 0.02 })) })), images: [] };
    };
    const out = await runDesignerEngine(base({ doc }), { generate: provider.generate, measure, nonce: () => "n" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.pages[0].background.overlay?.opacity).toBeGreaterThan(0.3);
    expect(out.stats.corrections).toBe(0);
    expect(provider.calls).toHaveLength(1);
    expect(measured).toBe(2);
    expect(out.warnings).toEqual([]);
  });
});
