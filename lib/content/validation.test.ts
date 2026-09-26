import { describe, it, expect } from "vitest";
import { validateAll, validateNetwork, type NetworkContent } from "./validation";
import type { MediaEntry } from "./media";

const video = (over: Partial<MediaEntry> = {}): MediaEntry => ({
  storage_path: "ws/p/v.mp4",
  mime_type: "video/mp4",
  kind: "video",
  size_bytes: 10 * 1024 * 1024,
  duration_ms: 30_000,
  width: 1080,
  height: 1920,
  ...over,
});

const image = (over: Partial<MediaEntry> = {}): MediaEntry => ({
  storage_path: "ws/p/i.png",
  mime_type: "image/png",
  kind: "image",
  size_bytes: 1024 * 1024,
  ...over,
});

const content = (over: Partial<NetworkContent>): NetworkContent => ({
  platform: "instagram",
  text: "Un caption corto",
  media: [video()],
  ...over,
});

describe("validar por red (F26)", () => {
  it("una pieza normal pasa", () => {
    expect(validateNetwork(content({})).ok).toBe(true);
  });

  it("un Reel de mas de 90 segundos es error en Instagram", () => {
    const result = validateNetwork(content({ media: [video({ duration_ms: 95_000 })] }));

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("90 segundos");
  });

  it("501 caracteres es error en Threads", () => {
    const result = validateNetwork(
      content({ platform: "threads", text: "a".repeat(501), media: [] }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("500");
  });

  it("YouTube sin titulo es error", () => {
    const result = validateNetwork(content({ platform: "youtube", title: "  " }));

    expect(result.errors.some((e) => e.includes("titulo"))).toBe(true);
  });

  it("Instagram sin media es error", () => {
    const result = validateNetwork(content({ media: [] }));

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("imagen o un video");
  });

  it("un video vertical corto en YouTube es ADVERTENCIA, no error", () => {
    // Se va a publicar como Short: conviene saberlo antes, pero no impide nada.
    const result = validateNetwork(
      content({
        platform: "youtube",
        title: "Un titulo",
        media: [video({ duration_ms: 60_000, width: 1080, height: 1920 })],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain("Short");
  });

  it("un video horizontal largo en YouTube no avisa nada", () => {
    const result = validateNetwork(
      content({
        platform: "youtube",
        title: "Un titulo",
        media: [video({ duration_ms: 600_000, width: 1920, height: 1080 })],
      }),
    );

    expect(result.warnings).toEqual([]);
  });

  it("llegar al limite diario de la red es error", () => {
    const result = validateNetwork(content({}), { publishedToday: 100 });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("limite");
  });

  it("estar debajo del limite diario no molesta", () => {
    expect(validateNetwork(content({}), { publishedToday: 3 }).ok).toBe(true);
  });

  it("una imagen demasiado pesada es error, y dice cuanto pesa", () => {
    const result = validateNetwork(
      content({ media: [image({ size_bytes: 9 * 1024 * 1024 })] }),
    );

    expect(result.errors[0]).toContain("9 MB");
  });

  it("un carrusel de Instagram con una sola imagen es error", () => {
    const result = validateNetwork(
      content({ media: [image()], options: { contentType: "carousel" } }),
    );

    expect(result.errors.some((e) => e.includes("2 imagenes"))).toBe(true);
  });

  it("TikTok con una privacidad que no sea publica o borrador se rechaza antes de llamar", () => {
    // El proveedor devolveria un error que no explica nada.
    const result = validateNetwork(
      content({ platform: "tiktok", options: { mode: "solo_amigos" } }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("publico o dejarlo como borrador");
  });

  it("LinkedIn no mezcla video con imagenes", () => {
    const result = validateNetwork(
      content({ platform: "linkedin", media: [video(), image()] }),
    );

    expect(result.errors.some((e) => e.includes("no mezcla"))).toBe(true);
  });

  it("LinkedIn y Threads pueden ir sin media", () => {
    expect(validateNetwork(content({ platform: "linkedin", media: [], text: "Solo texto" })).ok).toBe(true);
    expect(validateNetwork(content({ platform: "threads", media: [], text: "Solo texto" })).ok).toBe(true);
  });

  it("la media borrada no cuenta", () => {
    const result = validateNetwork(
      content({ media: [video({ deleted_at: "2026-09-01T00:00:00Z" })] }),
    );

    expect(result.errors[0]).toContain("imagen o un video");
  });

  it("una red que no conocemos se rechaza en vez de dejar publicar a ciegas", () => {
    expect(validateNetwork(content({ platform: "pinterest" })).ok).toBe(false);
  });
});

describe("validar varias redes juntas", () => {
  it("una red con error no frena a las demas", () => {
    // Frenar todo porque falta el titulo de YouTube castiga al resto.
    const result = validateAll([
      content({ platform: "instagram" }),
      content({ platform: "youtube", title: "" }),
      content({ platform: "threads", text: "Corto", media: [] }),
    ]);

    expect(result.schedulable).toEqual(["instagram", "threads"]);
    expect(result.blocked).toEqual(["youtube"]);
  });

  it("el limite diario se consulta por red", () => {
    const result = validateAll(
      [content({ platform: "instagram" }), content({ platform: "threads", media: [] })],
      (platform) => ({ publishedToday: platform === "instagram" ? 100 : 0 }),
    );

    expect(result.blocked).toEqual(["instagram"]);
  });
});
