import { describe, expect, it } from "vitest";
import {
  buildCreateInput,
  canCreate,
  createDisabledReason,
  formatOptions,
  formatShape,
  HOW_OPTIONS,
  initialNewFlow,
  needsFormat,
  nextStep,
  prevStep,
  primaryLabel,
  setFormat,
  setHow,
  setKind,
  setMultiPage,
  stepLabels,
  type NewFlowState,
} from "./new-flow";

const at3 = (patch: Partial<NewFlowState>): NewFlowState => ({ ...initialNewFlow(), step: 3, ...patch });

describe("el modal Nuevo (F16)", () => {
  it("con «Cargar HTML» no se pide formato: el último paso se llama Archivo", () => {
    expect(needsFormat("html")).toBe(false);
    expect(needsFormat("ai")).toBe(true);
    expect(stepLabels({ how: "html" })).toEqual(["Qué", "Cómo empezás", "Archivo"]);
    expect(stepLabels({ how: "ai" })).toEqual(["Qué", "Cómo empezás", "Formato y detalles"]);
  });

  it("web no aparece con «Varias páginas» ni en plantillas", () => {
    expect(formatOptions({ multiPage: true, kind: "design" })).not.toContain("web");
    expect(formatOptions({ multiPage: false, kind: "design" })).toContain("web");
    expect(formatOptions({ multiPage: false, kind: "template" })).not.toContain("web");
    expect(formatOptions({ multiPage: true, kind: "template" })).not.toContain("web");
  });

  it("si ya estaba elegida la página web y pasa a «Varias páginas» o a plantilla, el formato vuelve a uno permitido", () => {
    const web = setFormat(setMultiPage(initialNewFlow(), false), "web");
    expect(web.format).toBe("web");
    expect(setMultiPage(web, true).format).toBe("v45");
    expect(setKind(web, "template").format).toBe("v45");
    // Un formato que no se ofrece no se puede elegir.
    expect(setFormat(initialNewFlow(), "web").format).toBe("v45");
  });

  it("«Crear» está deshabilitado sin archivo en el camino HTML, y se habilita con él", () => {
    const state = at3({ how: "html" });
    expect(canCreate(state)).toBe(false);
    expect(createDisabledReason(state)).toBe("Cargá un archivo HTML para seguir.");
    const loaded = at3({ how: "html", html: { uploadId: "u1", as: "web" } });
    expect(canCreate(loaded)).toBe(true);
    expect(createDisabledReason(loaded)).toBeNull();
  });

  it("desde una imagen pide la imagen base; con IA, un pedido o una imagen; en blanco, nada", () => {
    expect(createDisabledReason(at3({ how: "image" }))).toBe("Subí la imagen base para seguir.");
    expect(canCreate(at3({ how: "image", baseImage: { path: "ws/images/a.png", name: "a.png" } }))).toBe(true);
    expect(createDisabledReason(at3({ how: "ai", prompt: "  " }))).toBe("Contale a la IA qué querés.");
    expect(canCreate(at3({ how: "ai", prompt: "Un carrusel sobre ventas" }))).toBe(true);
    expect(canCreate(at3({ how: "ai", prompt: "", attachments: [{ asset_path: "ws/images/a.png", name: "a.png", mime: "image/png" }] }))).toBe(true);
    expect(canCreate(at3({ how: "blank" }))).toBe(true);
  });

  it("antes del último paso no hay «Crear»: solo «Siguiente»", () => {
    const state = initialNewFlow();
    expect(canCreate(state)).toBe(false);
    expect(primaryLabel(state)).toBe("Siguiente");
    expect(primaryLabel({ step: 3, how: "ai" })).toBe("Crear con IA");
    expect(primaryLabel({ step: 3, how: "html" })).toBe("Cargar");
    expect(primaryLabel({ step: 3, how: "blank" })).toBe("Crear");
  });

  it("los pasos avanzan y retroceden sin salirse de 1 a 3", () => {
    let state = initialNewFlow();
    expect(prevStep(state).step).toBe(1);
    state = nextStep(nextStep(nextStep(state)));
    expect(state.step).toBe(3);
    expect(prevStep(state).step).toBe(2);
  });

  it("cambiar de camino limpia lo del otro", () => {
    const state = at3({ how: "image", baseImage: { path: "x", name: "x" }, proposeTexts: true, attachments: [{ asset_path: "p", name: "n", mime: "image/png" }] });
    const next = setHow(state, "ai");
    expect(next.baseImage).toBeNull();
    expect(next.attachments).toEqual([]);
    expect(next.proposeTexts).toBe(false);
    expect(setHow(state, "image")).toBe(state);
  });

  it("«Que la IA me proponga…» es solo de las plantillas", () => {
    expect(buildCreateInput(at3({ how: "image", kind: "template", baseImage: { path: "ws/images/a.png", name: "a" }, proposeTexts: true })).proposeTexts).toBe(true);
    expect(buildCreateInput(at3({ how: "image", kind: "design", baseImage: { path: "ws/images/a.png", name: "a" }, proposeTexts: true })).proposeTexts).toBe(false);
    expect(setKind(at3({ kind: "template", proposeTexts: true }), "design").proposeTexts).toBe(false);
  });

  it("arma lo que se manda al servidor según el camino", () => {
    expect(buildCreateInput(at3({ how: "ai", prompt: "  Un carrusel  ", style: "social", format: "story", multiPage: true }))).toEqual({
      kind: "design",
      origin: "ai",
      format: "story",
      multiPage: true,
      style: "social",
      prompt: "Un carrusel",
      attachments: [],
    });
    expect(buildCreateInput(at3({ how: "blank", format: "carta_h", multiPage: false }))).toEqual({ kind: "design", origin: "blank", format: "carta_h", multiPage: false });
  });

  it("las cuatro formas de empezar están, con el texto del prototipo", () => {
    expect(HOW_OPTIONS.map((h) => h.title)).toEqual(["Con IA", "Desde una imagen", "Cargar un archivo HTML", "En blanco"]);
  });

  it("el dibujito de cada formato respeta su proporción dentro de la caja", () => {
    expect(formatShape("sq")).toEqual({ width: 64, height: 64, web: false });
    expect(formatShape("carta_h")).toMatchObject({ width: 64, height: 49 });
    expect(formatShape("story")).toMatchObject({ width: 36, height: 64 });
    expect(formatShape("web").web).toBe(true);
  });
});
