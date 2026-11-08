// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./video-url.cases.json";
import { normalizeVideoUrl } from "./video-url";

describe("el link de video de una clase", () => {
  for (const c of cases.cases) it(c.name, () => expect(normalizeVideoUrl(c.url)).toMatchObject(c.expected));
  it("hay al menos 15 casos", () => expect(cases.cases.length).toBeGreaterThanOrEqual(15));
  it("Drive y Fathom avisan qué hacer", () => {
    expect(normalizeVideoUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")).toMatchObject({ warning: "El archivo tiene que estar compartido como «Cualquiera con el link»." });
    expect((normalizeVideoUrl("https://fathom.video/share/x") as { warning: string }).warning).toMatch(/Ver la grabación/);
  });
});
