// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./video-url.cases.json";
import { loomIdFromEmbed, loomOembedUrl, normalizeVideoUrl, parseLoomOembed } from "./video-url";

describe("el link de video de una clase", () => {
  for (const c of cases.cases) it(c.name, () => expect(normalizeVideoUrl(c.url)).toMatchObject(c.expected));
  it("hay al menos 15 casos", () => expect(cases.cases.length).toBeGreaterThanOrEqual(15));
  it("Drive y Fathom avisan qué hacer", () => {
    expect(normalizeVideoUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")).toMatchObject({ warning: "El archivo tiene que estar compartido como «Cualquiera con el link»." });
    expect((normalizeVideoUrl("https://fathom.video/calls/123456789") as { warning: string }).warning).toMatch(/Ver la grabación/);
  });
  it("Loom: la miniatura no se inventa; el oEmbed se arma con el id y se lee con cuidado", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(loomIdFromEmbed(`https://www.loom.com/embed/${id}`)).toBe(id);
    expect(loomIdFromEmbed("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBeNull();
    expect(loomIdFromEmbed(null)).toBeNull();
    expect(loomOembedUrl(id)).toBe(`https://www.loom.com/v1/oembed?url=https%3A%2F%2Fwww.loom.com%2Fshare%2F${id}`);
    expect(parseLoomOembed({ thumbnail_url: `https://cdn.loom.com/sessions/thumbnails/${id}-abc.gif`, duration: 1070.9 })).toEqual({ thumbnailUrl: `https://cdn.loom.com/sessions/thumbnails/${id}-abc.gif`, durationSeconds: 1071 });
    expect(parseLoomOembed({ thumbnail_url: "https://otro.com/x.jpg", duration: -3 })).toEqual({ thumbnailUrl: null, durationSeconds: null });
    expect(parseLoomOembed("no es json")).toEqual({ thumbnailUrl: null, durationSeconds: null });
  });
});
