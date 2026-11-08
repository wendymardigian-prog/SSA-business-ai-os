import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, precheckImage, SVG_NOT_ALLOWED } from "./uploads";

describe("revisión de una imagen antes de subirla (F22)", () => {
  it("un SVG se rechaza con «Usá PNG o JPG», sea por la extensión o por el tipo", () => {
    expect(precheckImage({ name: "logo.svg", size: 1000, type: "image/svg+xml" })).toBe(SVG_NOT_ALLOWED);
    expect(precheckImage({ name: "logo.SVG", size: 1000, type: "" })).toBe(SVG_NOT_ALLOWED);
    expect(SVG_NOT_ALLOWED).toContain("Usá PNG o JPG");
  });

  it("PNG, JPG y WebP pasan", () => {
    for (const [name, type] of [["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.webp", "image/webp"]] as const) {
      expect(precheckImage({ name, size: 5000, type })).toBeNull();
    }
  });

  it("vacío, de más de 20 MB u otro tipo se rechaza", () => {
    expect(precheckImage({ name: "a.png", size: 0, type: "image/png" })).toBe("El archivo está vacío.");
    expect(precheckImage({ name: "a.png", size: MAX_UPLOAD_BYTES + 1, type: "image/png" })).toBe("La imagen pesa más de 20 MB.");
    expect(precheckImage({ name: "a.gif", size: 1000, type: "image/gif" })).toContain("Usá PNG o JPG");
    expect(precheckImage({ name: "a.pdf", size: 1000, type: "application/pdf" })).toContain("Usá PNG o JPG");
  });
});
