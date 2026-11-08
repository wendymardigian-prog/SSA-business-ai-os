import { describe, expect, it } from "vitest";
import { FORMAT_KEYS, FORMATS, canExport, exportOptions, formatsForNew, isPrintFormat, PRINT_FORMATS } from "./formats";

describe("formatos (F9)", () => {
  it("las medidas del plano", () => {
    expect([FORMATS.carta_v.width, FORMATS.carta_v.height]).toEqual([816, 1056]);
    expect([FORMATS.carta_h.width, FORMATS.carta_h.height]).toEqual([1056, 816]);
    expect([FORMATS.a4_v.width, FORMATS.a4_v.height]).toEqual([794, 1123]);
    expect([FORMATS.a4_h.width, FORMATS.a4_h.height]).toEqual([1123, 794]);
    expect([FORMATS.sq.width, FORMATS.sq.height]).toEqual([1080, 1080]);
    expect([FORMATS.v45.width, FORMATS.v45.height]).toEqual([1080, 1350]);
    expect([FORMATS.story.width, FORMATS.story.height]).toEqual([1080, 1920]);
    expect([FORMATS.wide.width, FORMATS.wide.height]).toEqual([1920, 1080]);
    expect(FORMATS.web.width).toBe(1280);
  });

  it("web no exporta y no admite varias páginas", () => {
    expect(canExport("web")).toBe(false);
    expect(exportOptions("web")).toEqual([]);
    expect(FORMATS.web.multiPage).toBe(false);
  });

  it("el resto exporta PDF, imágenes y una página", () => {
    for (const key of FORMAT_KEYS.filter((k) => k !== "web")) expect(exportOptions(key)).toEqual(["pdf", "zip", "png"]);
  });

  it("toda zona segura está dentro de la página", () => {
    for (const key of FORMAT_KEYS) {
      const z = FORMATS[key].safeZone;
      for (const side of [z.top, z.right, z.bottom, z.left]) {
        expect(side).toBeGreaterThanOrEqual(0);
        expect(side).toBeLessThan(50);
      }
      expect(z.top + z.bottom).toBeLessThan(100);
      expect(z.left + z.right).toBeLessThan(100);
    }
  });

  it("las historias dejan 250 px arriba y 340 px abajo", () => {
    expect((FORMATS.story.safeZone.top / 100) * 1920).toBeCloseTo(250, 0);
    expect((FORMATS.story.safeZone.bottom / 100) * 1920).toBeCloseTo(340, 0);
  });

  it("impresos ×1 y redes ×2 al exportar", () => {
    for (const key of PRINT_FORMATS) expect(FORMATS[key].exportScale).toBe(1);
    expect(FORMATS.v45.exportScale).toBe(2);
    expect(FORMATS.story.exportScale).toBe(2);
  });

  it("los impresos son carta y A4", () => {
    expect(FORMAT_KEYS.filter(isPrintFormat)).toEqual(["carta_v", "carta_h", "a4_v", "a4_h"]);
  });

  it("al crear: web solo con una página y nunca en plantillas", () => {
    expect(formatsForNew({ multiPage: false, template: false })).toContain("web");
    expect(formatsForNew({ multiPage: true, template: false })).not.toContain("web");
    expect(formatsForNew({ multiPage: false, template: true })).not.toContain("web");
  });
});
