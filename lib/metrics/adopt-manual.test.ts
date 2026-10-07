import { describe, expect, it } from "vitest";
import { normalizePostUrl, pickManualMatch } from "./adopt-manual";

describe("C3 · normalizar el link de un post", () => {
  it("instagram: /p/, /reel/ y /reels/ con el mismo codigo son el mismo post", () => {
    const a = normalizePostUrl("https://www.instagram.com/p/CODE123/");
    const b = normalizePostUrl("https://instagram.com/reel/CODE123");
    const c = normalizePostUrl("https://instagram.com/reels/CODE123/?igsh=xyz");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("instagram: el codigo distingue mayusculas", () => {
    expect(normalizePostUrl("https://instagram.com/p/AbC/")).not.toBe(
      normalizePostUrl("https://instagram.com/p/abc/"),
    );
  });

  it("youtube: youtu.be, /shorts/ y ?v= con el mismo id son el mismo video", () => {
    const a = normalizePostUrl("https://youtu.be/XYZ999");
    const b = normalizePostUrl("https://www.youtube.com/shorts/XYZ999");
    const c = normalizePostUrl("https://www.youtube.com/watch?v=XYZ999&feature=share");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("dos posts distintos no normalizan igual", () => {
    expect(normalizePostUrl("https://instagram.com/p/AAA/")).not.toBe(
      normalizePostUrl("https://instagram.com/p/BBB/"),
    );
  });

  it("sin link, o un texto que no es un link, da null", () => {
    expect(normalizePostUrl(null)).toBeNull();
    expect(normalizePostUrl("")).toBeNull();
    expect(normalizePostUrl("no es un link")).toBeNull();
  });
});

describe("C3 · cual fila manual es este post", () => {
  it("por el link: una sola coincidencia se adopta", () => {
    const result = pickManualMatch(
      [
        { id: "m-1", url: "https://instagram.com/p/CODE/", published_at: null },
        { id: "m-2", url: "https://instagram.com/p/OTRO/", published_at: null },
      ],
      { url: "https://www.instagram.com/p/CODE/?igsh=1", publishedAt: null },
    );
    expect(result).toEqual({ id: "m-1", ambiguous: false });
  });

  it("dos manuales con el MISMO link: no se adivina", () => {
    const result = pickManualMatch(
      [
        { id: "m-1", url: "https://instagram.com/p/CODE/", published_at: null },
        { id: "m-2", url: "https://instagram.com/p/CODE/", published_at: null },
      ],
      { url: "https://instagram.com/p/CODE/", publishedAt: null },
    );
    expect(result).toEqual({ id: null, ambiguous: true });
  });

  it("sin link: una sola manual sin link, publicada a menos de 24 horas, se adopta", () => {
    const result = pickManualMatch(
      [{ id: "m-1", url: null, published_at: "2026-10-01T12:00:00.000Z" }],
      { url: null, publishedAt: "2026-10-01T15:00:00.000Z" },
    );
    expect(result).toEqual({ id: "m-1", ambiguous: false });
  });

  it("sin link: fuera de la ventana de 24 horas no se adopta", () => {
    const result = pickManualMatch(
      [{ id: "m-1", url: null, published_at: "2026-09-20T12:00:00.000Z" }],
      { url: null, publishedAt: "2026-10-01T15:00:00.000Z" },
    );
    expect(result).toEqual({ id: null, ambiguous: false });
  });

  it("sin link: dos candidatas cerca de la fecha, no se adivina ninguna", () => {
    const result = pickManualMatch(
      [
        { id: "m-1", url: null, published_at: "2026-10-01T14:00:00.000Z" },
        { id: "m-2", url: null, published_at: "2026-10-01T16:00:00.000Z" },
      ],
      { url: null, publishedAt: "2026-10-01T15:00:00.000Z" },
    );
    expect(result).toEqual({ id: null, ambiguous: true });
  });

  it("una manual CON link distinto no se confunde con una sin link cercana en fecha", () => {
    const result = pickManualMatch(
      [
        { id: "m-1", url: "https://instagram.com/p/OTRO/", published_at: "2026-10-01T15:00:00.000Z" },
      ],
      { url: null, publishedAt: "2026-10-01T15:01:00.000Z" },
    );
    expect(result).toEqual({ id: null, ambiguous: false });
  });

  it("sin candidatas no hay nada que adoptar", () => {
    expect(pickManualMatch([], { url: null, publishedAt: null })).toEqual({ id: null, ambiguous: false });
  });
});
