import { describe, expect, it } from "vitest";
import { styleSchema, type DesignStyle } from "../styles";
import { checkExtractionFile, checkFontFile, DENSITY_FIELDS, downscaleSize, draftFromStyle, extractionPick, fontRows, googleFamiliesToLoad, previewFontsHref, styleCards, styleFromDraft, weightLabel } from "./settings";

const style = (over: Partial<DesignStyle> = {}): DesignStyle => ({ key: "c_abc123", name: "Mi estilo", palette: { bg: "#101820", text: "#fef9ef", accent: "#f2aa4c" }, fonts: { title: "Archivo Black", body: "Inter" }, density: { sq: 22, v45: 22, story: 16 }, rules: "Fondo oscuro.", ...over });

describe("screens/settings: editar un estilo propio", () => {
  it("un borrador de un estilo guardado se arma con sus valores, y uno nuevo con los del Automático", () => {
    const d = draftFromStyle(style());
    expect(d).toMatchObject({ key: "c_abc123", name: "Mi estilo", fonts: { title: "Archivo Black" }, density: { social: "22", story: "16", wide: "40" } });
    expect(draftFromStyle(null)).toMatchObject({ key: null, name: "", fonts: { title: "Inter", body: "Inter" }, density: { social: "25", print: "120" } });
  });

  it("ida y vuelta: el borrador de un estilo da un estilo válido para el esquema", () => {
    const r = styleFromDraft(draftFromStyle(style()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(styleSchema.safeParse(r.style).success).toBe(true);
    expect(r.style.key).toBe("c_abc123");
    expect(r.style.density).toMatchObject({ sq: 22, v45: 22, story: 16, carta_h: 120, a4_v: 120, web: 400 });
  });

  it("uno nuevo recibe una clave propia (c_…)", () => {
    const d = { ...draftFromStyle(null), name: "Nuevo" };
    const r = styleFromDraft(d);
    expect(r.ok && r.style.key).toMatch(/^c_[a-z0-9]{6}$/);
  });

  it("acepta colores escritos con o sin # y de 3 dígitos", () => {
    const d = { ...draftFromStyle(style()), palette: { bg: "101820", text: "fff", accent: "#F2AA4C" } };
    const r = styleFromDraft(d);
    expect(r.ok && r.style.palette).toEqual({ bg: "#101820", text: "#ffffff", accent: "#f2aa4c" });
  });

  it("dice todo lo que está mal, en español", () => {
    const d = { ...draftFromStyle(style()), name: "  ", palette: { bg: "rojo", text: "#fff", accent: "zzz" }, density: { ...draftFromStyle(style()).density, story: "2" }, rules: "x".repeat(1501) };
    const r = styleFromDraft(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toEqual(
        expect.arrayContaining(["El estilo necesita un nombre.", "El color de fondo no es válido (por ejemplo #101820).", "El color de acento no es válido (por ejemplo #f2aa4c).", "«Historias»: poné un número de palabras entre 5 y 1000.", "Las reglas pueden tener hasta 1500 caracteres."]),
      );
    }
  });

  it("los grupos de densidad cubren los 9 formatos una sola vez", () => {
    const formats = DENSITY_FIELDS.flatMap((f) => f.formats);
    expect(new Set(formats).size).toBe(9);
    expect(formats).toHaveLength(9);
  });
});

describe("screens/settings: las tarjetas de estilos", () => {
  it("separa los activos de los archivados y resume la densidad y las reglas", () => {
    const cards = styleCards([style(), style({ key: "c_old123", name: "Viejo", archived: true, rules: "r".repeat(300) })]);
    expect(cards.active.map((c) => c.name)).toEqual(["Mi estilo"]);
    expect(cards.archived.map((c) => c.name)).toEqual(["Viejo"]);
    expect(cards.active[0].densityLine).toBe("Posts hasta 22 · Historias hasta 16");
    expect(cards.archived[0].rulesPreview.length).toBe(140);
  });

  it("sin estilos propios, no hay tarjetas", () => {
    expect(styleCards([])).toEqual({ active: [], archived: [] });
  });
});

describe("screens/settings: crear un estilo desde mis piezas", () => {
  it("pide entre 3 y 5 piezas (imágenes más diseños)", () => {
    expect(extractionPick(1, 1)).toMatchObject({ canExtract: false, message: "Elegí al menos 3 piezas (te falta 1)." });
    expect(extractionPick(0, 0).message).toMatch(/te faltan 3/);
    expect(extractionPick(3, 0)).toEqual({ count: 3, canExtract: true, message: null });
    expect(extractionPick(3, 2).canExtract).toBe(true);
    expect(extractionPick(4, 2)).toMatchObject({ canExtract: false, message: "Elegí hasta 5 piezas (sobra 1)." });
  });

  it("solo imágenes PNG, JPG o WebP", () => {
    expect(checkExtractionFile({ type: "image/png", size: 100 })).toBeNull();
    expect(checkExtractionFile({ type: "image/svg+xml", size: 100 })).toBe("Usá PNG o JPG (también WebP).");
  });

  it("achica el lado mayor sin deformar y no agranda", () => {
    expect(downscaleSize(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(downscaleSize(1080, 1920)).toEqual({ width: 576, height: 1024 });
    expect(downscaleSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("screens/settings: fuentes", () => {
  it("la lista junta las de Google (ordenadas) y las subidas con su peso", () => {
    const rows = fontRows({
      google: ["Rubik", "Lobster", "Rubik"],
      uploaded: [
        { family: "Mi Marca Sans", weight: 700, style: "normal", path: "ws/fonts/a.woff2", format: "woff2" },
        { family: "Mi Marca Sans", weight: 400, style: "italic", path: "ws/fonts/b.ttf", format: "ttf" },
      ],
    });
    expect(rows.map((r) => `${r.kind}:${r.family}`)).toEqual(["google:Lobster", "google:Rubik", "uploaded:Mi Marca Sans", "uploaded:Mi Marca Sans"]);
    expect(rows[2].detail).toBe("Regular 400 · cursiva · .ttf");
    expect(rows[3].detail).toBe("Bold 700 · .woff2");
  });

  it("pide a Google solo las de Google y las de los estilos, sin las subidas, y arma una sola URL", () => {
    const families = googleFamiliesToLoad([style({ fonts: { title: "Mi Marca Sans", body: "Inter" } })], ["Lobster"], ["Mi Marca Sans"]);
    expect(families.sort()).toEqual(["Inter", "Lobster"]);
    const href = previewFontsHref(families);
    expect(href).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
    expect(href?.match(/family=/g)).toHaveLength(2);
    expect(previewFontsHref([])).toBeNull();
  });

  it("valida el archivo de la fuente antes de subirlo", () => {
    expect(checkFontFile({ name: "a.woff2", size: 1000 })).toBeNull();
    expect(checkFontFile({ name: "a.exe", size: 1000 })).toMatch(/\.woff2/);
    expect(checkFontFile({ name: "a.ttf", size: 3 * 1024 * 1024 })).toMatch(/2 MB/);
    expect(checkFontFile({ name: "a.otf", size: 0 })).toBe("El archivo está vacío.");
  });

  it("nombra los pesos", () => {
    expect(weightLabel(400)).toBe("Regular 400");
    expect(weightLabel(900)).toBe("Black 900");
  });
});
