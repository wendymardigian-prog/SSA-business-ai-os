import { describe, it, expect } from "vitest";
import {
  canRedistribute,
  duplicateAsVariant,
  hasVariant,
  isRedistribution,
  resolveNetworkContent,
  type RedistributeContext,
} from "./redistribution";

describe("variantes dentro de la pieza (F28)", () => {
  it("una red sin nada propio usa lo base", () => {
    const network = { platform: "instagram" };

    expect(hasVariant(network)).toBe(false);
    expect(
      resolveNetworkContent({ network, baseCaption: "Base", baseMedia: ["a"] }),
    ).toEqual({ caption: "Base", media: ["a"], ownCaption: false, ownMedia: false });
  });

  it("una red con caption propio usa el suyo y la media base", () => {
    const network = { platform: "linkedin", caption: "Version larga" };

    expect(hasVariant(network)).toBe(true);
    expect(resolveNetworkContent({ network, baseCaption: "Base", baseMedia: ["a"] })).toEqual({
      caption: "Version larga",
      media: ["a"],
      ownCaption: true,
      ownMedia: false,
    });
  });

  it("un caption propio VACIO es una decision, no una falta", () => {
    // Cadena vacia distinta de null: alguien decidio publicar sin texto ahi.
    const network = { platform: "instagram", caption: "" };

    expect(hasVariant(network)).toBe(true);
    expect(resolveNetworkContent({ network, baseCaption: "Base", baseMedia: [] }).caption).toBe("");
  });

  it("media propia reemplaza a la base", () => {
    const network = { platform: "linkedin", media: ["propio"] };

    expect(resolveNetworkContent({ network, baseCaption: null, baseMedia: ["base"] }).media).toEqual([
      "propio",
    ]);
  });
});

describe("duplicar como variante", () => {
  const source = {
    id: "p1",
    idea_id: "i1",
    title: "Como cobrar",
    format: "reel",
    script: "Hola\n\nCuerpo",
    recording_notes: "Plano medio",
    caption: "Un caption",
    networks: [{ platform: "instagram", planned_at: "2026-10-01T15:00:00Z" }],
    media: ["archivo"],
  };

  it("nace en borrador y conserva la idea de origen", () => {
    const copia = duplicateAsVariant(source);

    expect(copia.status).toBe("draft");
    expect(copia.idea_id).toBe("i1");
    expect(copia.title).toContain("variante");
  });

  it("copia el contenido pero LIMPIA las fechas", () => {
    // Heredarlas programaria dos piezas para el mismo momento sin pedirlo.
    const copia = duplicateAsVariant(source);

    expect(copia.script).toBe(source.script);
    expect(copia.recording_notes).toBe(source.recording_notes);
    expect(copia).not.toHaveProperty("copy");
    expect(copia.media).toEqual(source.media);
    expect(copia.networks[0].planned_at).toBeNull();
  });

  it("la copia no comparte objetos con el original", () => {
    const copia = duplicateAsVariant(source);
    copia.networks[0].platform = "cambiado";

    expect(source.networks[0].platform).not.toBe("cambiado");
  });
});

describe("redistribuir a otra red", () => {
  const context = (over: Partial<RedistributeContext> = {}): RedistributeContext => ({
    postStatus: "published",
    publishedPlatforms: ["instagram"],
    connected: ["instagram", "youtube"],
    baseChangedSinceApproval: false,
    ...over,
  });

  it("agregar YouTube a una pieza publicada se puede, sin volver a aprobar", () => {
    // Lo que se aprobo es el contenido, y es el mismo.
    expect(canRedistribute("youtube", context())).toEqual({ ok: true, needsReview: false });
  });

  it("si el copy cambio despues de aprobar, esa red vuelve a revision", () => {
    const result = canRedistribute("youtube", context({ baseChangedSinceApproval: true }));

    expect(result).toMatchObject({ ok: true, needsReview: true });
  });

  it("una red que ya tiene publicacion no se redistribuye", () => {
    expect(canRedistribute("instagram", context()).ok).toBe(false);
  });

  it("una pieza que todavia no salio no se redistribuye: se programa", () => {
    const result = canRedistribute("youtube", context({ postStatus: "draft" }));

    expect(result).toEqual({ ok: false, error: expect.stringContaining("ya salio") });
  });

  it("una red sin cuenta conectada no", () => {
    expect(canRedistribute("threads", context()).ok).toBe(false);
  });
});

describe("que cuenta como redistribucion", () => {
  const fechas = ["2026-10-01T15:00:00Z", "2026-10-08T15:00:00Z"];

  it("toda fecha posterior a la primera de la pieza", () => {
    expect(isRedistribution("2026-10-08T15:00:00Z", fechas)).toBe(true);
    expect(isRedistribution("2026-10-01T15:00:00Z", fechas)).toBe(false);
  });

  it("con una sola fecha, no hay redistribucion", () => {
    expect(isRedistribution("2026-10-01T15:00:00Z", ["2026-10-01T15:00:00Z"])).toBe(false);
  });

  it("dos redes el mismo dia y hora no son redistribucion", () => {
    const mismas = ["2026-10-01T15:00:00Z", "2026-10-01T15:00:00Z"];
    expect(isRedistribution("2026-10-01T15:00:00Z", mismas)).toBe(false);
  });
});
