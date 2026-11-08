import { describe, expect, it } from "vitest";
import { NETWORK_FORMATS, getFormat } from "@/lib/content/network-format";
import {
  CONTENT_TARGETS,
  canUseInContent,
  contentTarget,
  designFormatFor,
  filePlan,
  outputSize,
  pageFit,
  targetsForDesignFormat,
  targetsForPlatform,
} from "./content-map";
import { FORMATS, FORMAT_KEYS, MAX_PAGES, type FormatKey } from "./formats";
import { CONTENT_FORMATS } from "./screens/toolbar";

/** Cada combinación del plano (F61): red, formato de Contenido, formatos de diseño, si son varias páginas y qué sale. */
const COMBINATIONS: Array<{ platform: string; format: string; designFormats: FormatKey[]; multiPage: boolean; output: "png" | "pdf" }> = [
  { platform: "instagram", format: "carousel", designFormats: ["v45", "sq"], multiPage: true, output: "png" },
  { platform: "instagram", format: "image", designFormats: ["v45", "sq"], multiPage: false, output: "png" },
  { platform: "instagram", format: "story", designFormats: ["story"], multiPage: true, output: "png" },
  { platform: "tiktok", format: "photos", designFormats: ["story", "v45"], multiPage: true, output: "png" },
  { platform: "linkedin", format: "image", designFormats: ["sq", "v45"], multiPage: false, output: "png" },
  { platform: "linkedin", format: "pdf", designFormats: ["sq", "v45", "carta_v", "wide"], multiPage: true, output: "pdf" },
  { platform: "threads", format: "image", designFormats: ["v45", "sq"], multiPage: false, output: "png" },
  { platform: "threads", format: "carousel", designFormats: ["v45", "sq"], multiPage: true, output: "png" },
];

describe("las combinaciones de Contenido ↔ Diseñador IA (F61)", () => {
  it("la tabla tiene exactamente las combinaciones del plano", () => {
    expect(CONTENT_TARGETS.map((t) => `${t.platform}/${t.format}`)).toEqual(COMBINATIONS.map((c) => `${c.platform}/${c.format}`));
  });

  for (const c of COMBINATIONS) {
    describe(`${c.platform} · ${c.format}`, () => {
      const target = contentTarget(c.platform, c.format)!;

      it("sirve para los formatos de diseño del plano, y el primero es el que se elige por defecto", () => {
        expect(target).not.toBeNull();
        expect([...target.designFormats]).toEqual(c.designFormats);
        expect(target.designFormats).toContain(target.defaultFormat);
        expect(designFormatFor(target)).toEqual({ format: target.defaultFormat, multiPage: c.multiPage });
      });

      it("es un formato que Contenido tiene de verdad, con los mismos límites de archivos y el mismo tipo", () => {
        const def = getFormat(c.platform, c.format);
        expect(def).not.toBeNull();
        expect(target.files).toEqual({ min: def!.min, max: def!.max });
        expect(def!.kinds).toContain(c.output === "pdf" ? "document" : "image");
      });

      for (const designFormat of c.designFormats) {
        it(`con un diseño ${designFormat} ofrece esta publicación y arma ${c.output === "pdf" ? "un PDF" : "un PNG por página"}`, () => {
          expect(targetsForDesignFormat(designFormat).map((t) => `${t.platform}/${t.format}`)).toContain(`${c.platform}/${c.format}`);
          expect(canUseInContent(designFormat)).toBe(true);
          expect(filePlan(target, 5)).toEqual(c.output === "pdf" ? { output: "pdf", count: 1 } : { output: "png", count: 5 });
        });
      }
    });
  }

  it("los formatos de Contenido que se graban o no llevan imagen no se arman con un diseño", () => {
    for (const [platform, format] of [
      ["instagram", "reel"],
      ["tiktok", "video"],
      ["youtube", "video"],
      ["youtube", "short"],
      ["linkedin", "text"],
      ["linkedin", "video"],
      ["threads", "text"],
      ["threads", "video"],
    ] as const) {
      expect(contentTarget(platform, format)).toBeNull();
    }
    expect(contentTarget("instagram", null)).toBeNull();
    expect(contentTarget("instagram", "")).toBeNull();
    expect(contentTarget("facebook", "image")).toBeNull();
  });

  it("todo formato de Contenido que lleva imágenes o un PDF tiene su combinación (no queda uno sin cubrir)", () => {
    for (const [platform, formats] of Object.entries(NETWORK_FORMATS)) {
      for (const f of formats) {
        // Las que llevan solo imágenes o un PDF, más la historia de Instagram (imagen o video).
        const needsDesign = (f.kinds.length === 1 && (f.kinds[0] === "image" || f.kinds[0] === "document")) || (platform === "instagram" && f.id === "story");
        expect(contentTarget(platform, f.id) !== null, `${platform}/${f.id}`).toBe(needsDesign);
      }
    }
  });

  it("targetsForPlatform lista las de una red", () => {
    expect(targetsForPlatform("instagram").map((t) => t.format)).toEqual(["carousel", "image", "story"]);
    expect(targetsForPlatform("linkedin").map((t) => t.format)).toEqual(["image", "pdf"]);
    expect(targetsForPlatform("youtube")).toEqual([]);
  });
});

describe("qué formatos de diseño ofrecen «Usar en contenido»", () => {
  it("carta horizontal, A4 y página web no se usan en contenido", () => {
    for (const key of ["carta_h", "a4_v", "a4_h", "web"] as const) {
      expect(canUseInContent(key), key).toBe(false);
      expect(targetsForDesignFormat(key)).toEqual([]);
    }
  });

  it("carta vertical y presentación solo ofrecen el PDF de LinkedIn", () => {
    for (const key of ["carta_v", "wide"] as const) {
      expect(targetsForDesignFormat(key).map((t) => `${t.platform}/${t.format}`)).toEqual(["linkedin/pdf"]);
    }
  });

  it("la historia 9:16 ofrece la historia de Instagram y las fotos de TikTok", () => {
    expect(targetsForDesignFormat("story").map((t) => t.label)).toEqual(["Instagram · Historia", "TikTok · Carrusel de fotos"]);
  });

  it("coincide con lo que el editor ya deja pasar: el botón se ofrece para los mismos formatos", () => {
    const contentable = FORMAT_KEYS.filter((key) => canUseInContent(key));
    expect([...contentable].sort()).toEqual([...CONTENT_FORMATS].sort());
  });
});

describe("designFormatFor", () => {
  const instagramCarousel = contentTarget("instagram", "carousel")!;

  it("respeta el formato que la pieza ya tenía en mente si sirve", () => {
    expect(designFormatFor(instagramCarousel, "sq")).toEqual({ format: "sq", multiPage: true });
  });

  it("y si no sirve, usa el de siempre", () => {
    expect(designFormatFor(instagramCarousel, "story")).toEqual({ format: "v45", multiPage: true });
    expect(designFormatFor(instagramCarousel, null)).toEqual({ format: "v45", multiPage: true });
  });

  it("una imagen suelta nace con una sola página", () => {
    expect(designFormatFor(contentTarget("instagram", "image")!)).toEqual({ format: "v45", multiPage: false });
  });
});

describe("la conversión a archivos", () => {
  it("un PNG por página, en el orden de las páginas", () => {
    expect(filePlan(contentTarget("instagram", "carousel")!, 7)).toEqual({ output: "png", count: 7 });
  });

  it("un diseño de una página da un solo PNG", () => {
    expect(filePlan(contentTarget("instagram", "image")!, 1)).toEqual({ output: "png", count: 1 });
  });

  it("el carrusel PDF de LinkedIn es un solo PDF con todas las páginas, sin importar cuántas sean", () => {
    expect(filePlan(contentTarget("linkedin", "pdf")!, 12)).toEqual({ output: "pdf", count: 1 });
    expect(filePlan(contentTarget("linkedin", "pdf")!, 1)).toEqual({ output: "pdf", count: 1 });
  });

  it("una cantidad rara de páginas no rompe: al menos una", () => {
    expect(filePlan(contentTarget("instagram", "carousel")!, 0)).toEqual({ output: "png", count: 1 });
    expect(filePlan(contentTarget("instagram", "carousel")!, 3.9)).toEqual({ output: "png", count: 3 });
  });

  it("cada archivo mide lo que el diseño, sin ampliar", () => {
    expect(outputSize("v45")).toEqual({ width: 1080, height: 1350 });
    expect(outputSize("story")).toEqual({ width: 1080, height: 1920 });
    for (const key of FORMAT_KEYS) expect(outputSize(key)).toEqual({ width: FORMATS[key].width, height: FORMATS[key].height });
  });
});

describe("pageFit: si las páginas cuadran con la publicación", () => {
  const carousel = contentTarget("instagram", "carousel")!;

  it("un carrusel de 5 páginas está bien", () => {
    expect(pageFit(carousel, 5)).toEqual({ level: "ok", message: null });
    expect(pageFit(carousel, 2).level).toBe("ok");
    expect(pageFit(carousel, 10).level).toBe("ok");
  });

  it("un carrusel con una sola página avisa que no se programa", () => {
    const fit = pageFit(carousel, 1);
    expect(fit.level).toBe("warn");
    expect(fit.message).toContain("al menos 2 imágenes");
    expect(fit.message).toContain("no se programa");
  });

  it("más páginas de las que admite la red avisa cuántas", () => {
    const fit = pageFit(carousel, 12);
    expect(fit.level).toBe("warn");
    expect(fit.message).toContain("Instagram admite hasta 10 imágenes en un carrusel");
    expect(fit.message).toContain("12 páginas");
  });

  it("una imagen con varias páginas avisa que queda una", () => {
    const fit = pageFit(contentTarget("instagram", "image")!, 3);
    expect(fit.level).toBe("warn");
    expect(fit.message).toContain("3 páginas");
  });

  it("una historia con varias páginas explica que cada una es una historia", () => {
    const fit = pageFit(contentTarget("instagram", "story")!, 4);
    expect(fit.level).toBe("warn");
    expect(fit.message).toContain("Cada página del diseño es una historia");
  });

  it("el PDF de LinkedIn nunca avisa: una página o veinte, es un archivo", () => {
    const pdf = contentTarget("linkedin", "pdf")!;
    expect(pageFit(pdf, 1).level).toBe("ok");
    expect(pageFit(pdf, MAX_PAGES).level).toBe("ok");
  });

  it("TikTok admite hasta 35 y un diseño llega a 20: nunca avisa por de más, y la red lleva su aviso fijo", () => {
    const tiktok = contentTarget("tiktok", "photos")!;
    expect(pageFit(tiktok, MAX_PAGES).level).toBe("ok");
    expect(tiktok.note).toContain("35 fotos");
    expect(tiktok.note).toContain(String(MAX_PAGES));
    expect(contentTarget("instagram", "carousel")!.note).toBeUndefined();
  });
});
