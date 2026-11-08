import { describe, expect, it } from "vitest";
import type { ImageElement, ShapeElement, TextElement } from "../doc/schema";
import { parseDesignDoc, emptyDoc } from "../doc/schema";
import { patchElement } from "./doc-ops";
import {
  hasControl,
  replaceImage,
  setAlign,
  setColor,
  setFill,
  setFontFamily,
  setHighlight,
  setImageFit,
  setLetterSpacing,
  setLineHeight,
  setOpacity,
  setRadius,
  setSize,
  setStroke,
  setWeight,
  sheetTabsFor,
  stepSize,
  toggleItalic,
  toggleShadow,
  toggleUppercase,
  toolbarFor,
} from "./element-toolbar";

const text: TextElement = { id: "el_t00001", type: "text", x: 50, y: 50, w: 40, text: "Hola", font: { family: "Inter", weight: 400 }, size: 40, align: "left", color: "#111111" };
const image: ImageElement = { id: "el_i00001", type: "image", x: 50, y: 50, w: 30, h: 30, asset: "ws/images/a.png", fit: "cover" };
const rect: ShapeElement = { id: "el_s00001", type: "shape", x: 50, y: 50, w: 30, h: 30, shape: "rect", fill: "#000000" };
const line: ShapeElement = { id: "el_l00001", type: "shape", x: 50, y: 50, w: 30, shape: "line", stroke: { color: "#000000", width: 2 } };

const controls = (el: Parameters<typeof toolbarFor>[0], template = false) => toolbarFor(el, template).flatMap((g) => g.controls);

describe("barra del elemento (F21)", () => {
  it("un texto tiene tipografía, peso, tamaño, cursiva, mayúsculas, interlineado, espaciado, alineación, color, resaltado y sombra", () => {
    const style = toolbarFor(text, false).find((g) => g.id === "style")!.controls;
    expect(style).toEqual(["font", "weight", "size", "italic", "uppercase", "lineHeight", "letterSpacing", "align", "color", "highlight", "shadow"]);
  });

  it("«Insertar variable» aparece solo en las plantillas", () => {
    expect(controls(text, false)).not.toContain("variable");
    expect(controls(text, true)).toContain("variable");
    expect(controls(image, true)).not.toContain("variable");
  });

  it("una imagen: reemplazar, ajuste, esquinas y opacidad", () => {
    expect(toolbarFor(image, false).find((g) => g.id === "style")!.controls).toEqual(["replace", "fit", "radius", "opacity"]);
    expect(controls(image)).not.toContain("font");
  });

  it("una forma: relleno, borde, esquinas y opacidad; una línea, solo borde y opacidad", () => {
    expect(toolbarFor(rect, false).find((g) => g.id === "style")!.controls).toEqual(["fill", "stroke", "radius", "opacity"]);
    expect(toolbarFor(line, false).find((g) => g.id === "style")!.controls).toEqual(["stroke", "opacity"]);
  });

  it("todos tienen nombre, orden, alinear a la página, duplicar, bloquear, eliminar y Listo", () => {
    for (const el of [text, image, rect, line, { type: "html" as const }]) {
      const all = controls(el);
      for (const needed of ["name", "order", "alignPage", "duplicate", "lock", "delete", "done"]) expect(all, `${el.type} ${needed}`).toContain(needed);
    }
  });

  it("el rótulo del grupo de estilo sale del tipo", () => {
    expect(toolbarFor(text, false).find((g) => g.id === "style")!.label).toBe("Texto");
    expect(toolbarFor(image, false).find((g) => g.id === "style")!.label).toBe("Imagen");
    expect(toolbarFor(rect, false).find((g) => g.id === "style")!.label).toBe("Forma");
  });

  it("en el celular son tres pestañas: Texto (o Imagen o Forma) · Orden · Más", () => {
    expect(sheetTabsFor(text).map((t) => t.label)).toEqual(["Texto", "Orden", "Más"]);
    expect(sheetTabsFor(image).map((t) => t.label)).toEqual(["Imagen", "Orden", "Más"]);
    expect(sheetTabsFor(rect)[0].groups).toEqual(["style"]);
    expect(sheetTabsFor(text)[2].groups).toEqual(["actions"]);
  });

  it("sabe si un control es de ese elemento", () => {
    expect(hasControl(text, false, "font")).toBe(true);
    expect(hasControl(image, false, "font")).toBe(false);
    expect(hasControl(line, false, "fill")).toBe(false);
  });
});

describe("lo que cambia cada control (F21)", () => {
  it("el tamaño va de 4 a 1000 px y es entero", () => {
    expect(setSize(text, 3)).toEqual({ size: 4 });
    expect(setSize(text, 5000)).toEqual({ size: 1000 });
    expect(setSize(text, 40.6)).toEqual({ size: 41 });
  });

  it("A+ y A− cambian un 10 % y siempre al menos 1 px", () => {
    expect(stepSize(text, 1)).toEqual({ size: 44 });
    expect(stepSize(text, -1)).toEqual({ size: 36 });
    expect(stepSize({ ...text, size: 5 }, 1)).toEqual({ size: 6 });
    expect(stepSize({ ...text, size: 5 }, -1)).toEqual({ size: 4 });
    expect(stepSize({ ...text, size: 4 }, -1)).toEqual({ size: 4 });
  });

  it("al cambiar de tipografía, el peso queda en uno que la fuente tenga", () => {
    // Bebas Neue solo tiene 400.
    expect(setFontFamily({ ...text, font: { family: "Inter", weight: 700 } }, "Bebas Neue")).toEqual({ font: { family: "Bebas Neue", weight: 400 } });
    expect(setFontFamily(text, "Poppins")).toEqual({ font: { family: "Poppins", weight: 400 } });
    // Una fuente propia (subida o de Google) conserva el peso: no se sabe cuáles tiene.
    expect(setFontFamily({ ...text, font: { family: "Inter", weight: 600 } }, "Mi Marca Sans")).toEqual({ font: { family: "Mi Marca Sans", weight: 600 } });
  });

  it("peso, cursiva, mayúsculas y sombra se prenden y se apagan", () => {
    expect(setWeight(text, 650)).toEqual({ font: { family: "Inter", weight: 700 } });
    expect(toggleItalic(text)).toEqual({ font: { family: "Inter", weight: 400, italic: true } });
    expect(toggleItalic({ ...text, font: { family: "Inter", weight: 400, italic: true } })).toEqual({ font: { family: "Inter", weight: 400 } });
    expect(toggleUppercase(text)).toEqual({ transform: "uppercase" });
    expect(toggleUppercase({ ...text, transform: "uppercase" })).toEqual({ transform: undefined });
    expect(toggleShadow(text)).toEqual({ shadow: true });
    expect(toggleShadow({ ...text, shadow: true })).toEqual({ shadow: undefined });
  });

  it("interlineado y espaciado tienen límites; el color solo si es válido", () => {
    expect(setLineHeight(text, 9)).toEqual({ lineHeight: 4 });
    expect(setLineHeight(text, 0.1)).toEqual({ lineHeight: 0.5 });
    expect(setLetterSpacing(text, -999)).toEqual({ letterSpacing: -50 });
    expect(setLetterSpacing(text, 2.5)).toEqual({ letterSpacing: 2.5 });
    expect(setColor(text, "#FF00AA")).toEqual({ color: "#ff00aa" });
    expect(setColor(text, "rojo")).toEqual({});
    expect(setAlign(text, "justify")).toEqual({ align: "justify" });
  });

  it("el resaltado: color + opacidad (0 a 1); null lo quita", () => {
    expect(setHighlight(text, { color: "#FFFF00", opacity: 3 })).toEqual({ highlight: { color: "#ffff00", opacity: 1 } });
    expect(setHighlight(text, { color: "amarillo", opacity: 0.5 })).toEqual({});
    expect(setHighlight(text, null)).toEqual({ highlight: undefined });
  });

  it("imagen: ajuste, esquinas, reemplazo y opacidad (1 = sin opacidad guardada)", () => {
    expect(setImageFit(image, "contain")).toEqual({ fit: "contain" });
    expect(setRadius(image, -5)).toEqual({ radius: 0 });
    expect(setRadius(rect, 24.4)).toEqual({ radius: 24 });
    expect(replaceImage(image, "ws/images/b.png")).toEqual({ asset: "ws/images/b.png" });
    expect(setOpacity(image, 0.5)).toEqual({ opacity: 0.5 });
    expect(setOpacity(image, 1)).toEqual({ opacity: undefined });
    expect(setOpacity(image, 4)).toEqual({ opacity: undefined });
  });

  it("forma: relleno y borde, o quitarlos", () => {
    expect(setFill(rect, "#00FF00")).toEqual({ fill: "#00ff00" });
    expect(setFill(rect, null)).toEqual({ fill: undefined });
    expect(setFill(rect, "verde")).toEqual({});
    expect(setStroke(rect, { color: "#ff0000", width: 999 })).toEqual({ stroke: { color: "#ff0000", width: 200 } });
    expect(setStroke(rect, null)).toEqual({ stroke: undefined });
  });

  it("un parche aplicado deja un documento válido", () => {
    let doc = emptyDoc("v45");
    doc.pages[0].elements = [text, image, rect];
    doc = patchElement(doc, 0, text.id, { ...setFontFamily(text, "Poppins"), ...setSize(text, 96), ...setHighlight(text, { color: "#ffff00", opacity: 0.4 }), ...toggleUppercase(text) });
    doc = patchElement(doc, 0, rect.id, { ...setStroke(rect, { color: "#112233", width: 6 }), ...setRadius(rect, 30) });
    expect(parseDesignDoc(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  });
});
