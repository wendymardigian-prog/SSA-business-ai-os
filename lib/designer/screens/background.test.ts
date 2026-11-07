import { describe, expect, it } from "vitest";
import { emptyDoc, parseDesignDoc, type DesignPage } from "../doc/schema";
import {
  anyImageBackground,
  backgroundLayers,
  clearOverlay,
  currentFit,
  DEFAULT_OVERLAY_OPACITY,
  overlayOpacityFromPercent,
  overlayPercent,
  removeBackground,
  setBackgroundColor,
  setBackgroundFit,
  setBackgroundFocal,
  setBackgroundGradient,
  setBackgroundImage,
  setFitEverywhere,
  setOverlay,
} from "./background";

const BASE: DesignPage = emptyDoc("v45", "#112233").pages[0];
const page = (): DesignPage => BASE;
const withImage = () => setBackgroundImage(page(), "ws/images/foto.jpg");

describe("fondo y capa de color (F23)", () => {
  it("backgroundLayers ordena color → imagen → capa → (elementos van encima)", () => {
    const layered = setOverlay(withImage(), { color: "#000000", opacity: 0.5 });
    expect(backgroundLayers(layered).map((l) => l.kind)).toEqual(["base", "image", "overlay"]);
    // Sin imagen no hay capa de imagen; sin capa, tampoco overlay.
    expect(backgroundLayers(page()).map((l) => l.kind)).toEqual(["base"]);
    expect(backgroundLayers(withImage()).map((l) => l.kind)).toEqual(["base", "image"]);
  });

  it("la opacidad de la capa fuera de rango se corrige al límite (0 a 90 %)", () => {
    expect(setOverlay(withImage(), { color: "#000000", opacity: 5 }).background.overlay?.opacity).toBe(0.9);
    expect(setOverlay(withImage(), { color: "#000000", opacity: -3 }).background.overlay).toBeUndefined();
    // El render también la corrige si llegara un documento con otro valor.
    const bad = { ...withImage(), background: { ...withImage().background, overlay: { color: "#000000", opacity: 1.7 } } };
    const overlay = backgroundLayers(bad).find((l) => l.kind === "overlay")!;
    expect(overlay.style.background).toBe("rgba(0, 0, 0, 0.9)");
  });

  it("la barra va de 0 a 90 y el número sigue a la barra", () => {
    expect(overlayOpacityFromPercent(55)).toBe(0.55);
    expect(overlayOpacityFromPercent(250)).toBe(0.9);
    expect(overlayOpacityFromPercent(-4)).toBe(0);
    expect(overlayPercent(0.55)).toBe(55);
    expect(overlayPercent(3)).toBe(90);
  });

  it("subir una imagen: «Cubrir», punto focal al centro, bloqueada; reemplazar conserva ajuste, foco y capa", () => {
    const first = withImage();
    expect(first.background).toMatchObject({ type: "image", image: { asset: "ws/images/foto.jpg", fit: "cover", focal: { x: 50, y: 50 }, locked: true } });
    let tuned = setBackgroundFit(first, "contain");
    tuned = setBackgroundFocal(tuned, { x: 20, y: 80 });
    tuned = setOverlay(tuned, { color: "#1b0f3a", opacity: DEFAULT_OVERLAY_OPACITY });
    const replaced = setBackgroundImage(tuned, "ws/images/otra.jpg");
    expect(replaced.background.image).toMatchObject({ asset: "ws/images/otra.jpg", fit: "contain", focal: { x: 20, y: 80 } });
    expect(replaced.background.overlay).toEqual({ color: "#1b0f3a", opacity: 0.45 });
  });

  it("el punto focal se queda dentro de la imagen", () => {
    expect(setBackgroundFocal(withImage(), { x: 150, y: -20 }).background.image?.focal).toEqual({ x: 100, y: 0 });
    expect(setBackgroundFocal(page(), { x: 10, y: 10 })).toEqual(page());
  });

  it("el ajuste y la capa solo valen con una imagen", () => {
    const plain = page();
    expect(setBackgroundFit(plain, "contain")).toBe(plain);
    expect(setOverlay(plain, { color: "#000000", opacity: 0.4 })).toBe(plain);
    expect(setOverlay(withImage(), { color: "no", opacity: 0.4 }).background.overlay).toBeUndefined();
  });

  it("color y degradé: solo con colores válidos", () => {
    expect(setBackgroundColor(page(), "#FF0000").background).toEqual({ type: "color", color: "#ff0000" });
    expect(setBackgroundColor(page(), "rojo")).toEqual(page());
    expect(setBackgroundGradient(page(), { from: "#000000", to: "#ffffff", angle: 720 }).background.gradient).toEqual({ from: "#000000", to: "#ffffff", angle: 360 });
    expect(setBackgroundGradient(page(), { from: "x", to: "#ffffff", angle: 0 })).toEqual(page());
  });

  it("quitar la capa y quitar el fondo", () => {
    const layered = setOverlay(withImage(), { color: "#000000", opacity: 0.5 });
    expect(clearOverlay(layered).background.overlay).toBeUndefined();
    expect(clearOverlay(page())).toEqual(page());
    expect(removeBackground(layered).background).toEqual({ type: "color", color: "#112233" });
  });

  it("cambiar el ajuste en toda la configuración alcanza a cada página con imagen", () => {
    const pages = [withImage(), page()];
    expect(anyImageBackground(pages)).toBe(true);
    expect(anyImageBackground([page()])).toBe(false);
    expect(currentFit(pages)).toBe("cover");
    const all = setFitEverywhere(pages, "contain");
    expect(all[0].background.image?.fit).toBe("contain");
    expect(all[1]).toEqual(pages[1]);
    expect(currentFit([page()])).toBeNull();
  });

  it("todo lo que arma es un documento válido", () => {
    const doc = emptyDoc("v45");
    doc.pages[0] = setOverlay(withImage(), { color: "#102030", opacity: 0.6 });
    expect(parseDesignDoc(doc).ok).toBe(true);
  });
});
