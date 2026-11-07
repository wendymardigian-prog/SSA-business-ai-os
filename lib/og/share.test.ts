import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShareData, shareMetadata } from "./share";

const text = { title: "1:1 · Wendy", description: "30 min con Wendy.", imageTitle: "1:1", imageSubtitle: "30 min · con Wendy" };
const workspace = { brand_name: "Negocio Dos", brand_logo_path: "ws-1/logo/a.png", brand_color: "#aabbcc", scheduling_public_base_url: "https://agenda.negocio.com" };

afterEach(() => vi.unstubAllEnvs());

describe("buildShareData", () => {
  it("usa la marca y el dominio del negocio", () => {
    const share = buildShareData(workspace, "/calendario/wendy/uno", text);
    expect(share.brand.name).toBe("Negocio Dos");
    expect(share.brand.colorHex).toBe("#aabbcc");
    expect(share.pageUrl).toBe("https://agenda.negocio.com/calendario/wendy/uno");
  });
  it("un negocio con nombre y sin logo nunca toma el de la instalación", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND_LOGO_URL", "https://x/instalacion.png");
    expect(buildShareData({ ...workspace, brand_logo_path: null }, "/f/uno", text).brand.logoUrl).toBeNull();
  });
  it("cambia de versión si cambia el logo, el color o el título", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co");
    const base = buildShareData(workspace, "/f/uno", text).version;
    expect(buildShareData({ ...workspace, brand_logo_path: "ws-1/logo/b.png" }, "/f/uno", text).version).not.toBe(base);
    expect(buildShareData({ ...workspace, brand_color: "#112233" }, "/f/uno", text).version).not.toBe(base);
    expect(buildShareData(workspace, "/f/uno", { ...text, imageTitle: "Otro" }).version).not.toBe(base);
    expect(buildShareData(workspace, "/f/uno", text).version).toBe(base);
  });
});

describe("shareMetadata", () => {
  it("arma las etiquetas con una imagen absoluta y versionada en el dominio del negocio", () => {
    const share = buildShareData(workspace, "/f/uno", text);
    const meta = shareMetadata(share);
    const image = `https://agenda.negocio.com/f/uno/preview.png?v=${share.version}`;
    expect(meta.openGraph).toMatchObject({
      url: "https://agenda.negocio.com/f/uno",
      siteName: "Negocio Dos",
      title: "1:1 · Wendy",
      description: "30 min con Wendy.",
      images: [{ url: image, width: 1200, height: 630, type: "image/png" }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [image] });
  });
  it("sin descripción no manda la etiqueta vacía", () => {
    const { description: _description, ...withoutDescription } = text;
    const meta = shareMetadata(buildShareData(workspace, "/f/uno", withoutDescription));
    expect(meta.openGraph).not.toHaveProperty("description");
    expect(meta.twitter).not.toHaveProperty("description");
  });
});

describe("lo que hace falta para que un lector de vista previa vea las etiquetas", () => {
  it("Next las manda en el <head> a cualquier lector", () => {
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).toContain("htmlLimitedBots: /.*/");
  });
  it("la imagen no pasa por el middleware de la sesión", () => {
    expect(readFileSync(join(process.cwd(), "middleware.ts"), "utf8")).toContain("svg|png|jpg");
  });
});
