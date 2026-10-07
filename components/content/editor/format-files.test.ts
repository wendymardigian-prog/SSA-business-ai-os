/**
 * F92/F93: lo que se ve en la biblioteca y en el selector de archivos de cada
 * red. Se renderiza en el servidor (sin navegador): alcanza para fijar la
 * estructura, el orden, las etiquetas y los botones, que es donde estan los
 * criterios del plano.
 */

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaEntry } from "@/lib/content/media";
import type { NetworkEntry } from "@/lib/content/redistribution";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/actions/content-media", () => ({
  attachMedia: async () => ({ ok: true }),
  removeMedia: async () => ({ ok: true, data: { removedFrom: [] } }),
  requestMediaUpload: async () => ({ ok: false, error: "no" }),
}));

const { FormatFiles } = await import("./format-files");
const { MediaUploader } = await import("../media-uploader");

const img = (id: string, name: string): MediaEntry => ({
  id,
  name,
  storage_path: `ws/post/${id}.jpg`,
  mime_type: "image/jpeg",
  kind: "image",
  size_bytes: 2 * 1024 * 1024,
  width: 1080,
  height: 1350,
});
const video = (id: string, name: string): MediaEntry => ({
  id,
  name,
  storage_path: `ws/post/${id}.mp4`,
  mime_type: "video/mp4",
  kind: "video",
  size_bytes: 30 * 1024 * 1024,
  width: 1080,
  height: 1920,
});

const LIB = [img("i1", "uno.jpg"), img("i2", "dos.jpg"), img("i3", "tres.jpg"), video("v1", "clip.mp4")];

const render = (network: NetworkEntry, over: { editable?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(FormatFiles, {
      network,
      library: LIB,
      editable: over.editable ?? true,
      onChange: () => undefined,
    }),
  );

describe("el selector de formato y archivos (F93)", () => {
  it("una red sin formato dice que usa toda la biblioteca y pide elegir uno", () => {
    const html = render({ platform: "instagram" });

    expect(html).toContain("Elegí un formato");
    expect(html).toContain("usa todos los archivos de la biblioteca");
  });

  // C9: el formato ya no arranca vacio. Cuando se agrega una red hereda el
  // de la pieza (suggestFormat + changeFormat, ver piece-drawer.tsx), asi que
  // esta tarjeta ya no necesita ofrecer un sugerido: si la red no tiene
  // formato es porque viene de antes de F93, y el chip desaparecio.
  it("sin formato no ofrece ningun sugerido: lo hereda al agregarla, no aca", () => {
    expect(render({ platform: "instagram" })).not.toContain("Usar el sugerido");
  });

  it("ofrece los formatos de ESA red", () => {
    const html = render({ platform: "linkedin" });

    expect(html).toContain("Solo texto");
    expect(html).toContain("Carrusel PDF");
    expect(html).not.toContain("Reel");
  });

  it("CRITERIO: los archivos elegidos van numerados en el orden elegido", () => {
    const html = render({ platform: "instagram", format: "carousel", files: ["i3", "i1"] });

    // tres.jpg es el 1, uno.jpg es el 2.
    expect(html.indexOf("tres.jpg")).toBeLessThan(html.indexOf("uno.jpg"));
    expect(html).toMatch(/>1<\/span>[\s\S]*tres\.jpg[\s\S]*>2<\/span>[\s\S]*uno\.jpg/);
  });

  it("CRITERIO: con un solo archivo en un carrusel, la verificacion esta en ROJO", () => {
    const html = render({ platform: "instagram", format: "carousel", files: ["i1"] });

    expect(html).toContain("Faltan archivos: este formato pide entre 2 y 10");
    expect(html).toContain("bg-red-500/10");
    expect(html).not.toContain("bg-emerald-500/10");
  });

  it("con 2 imagenes, en VERDE, y dice que publica en ese orden", () => {
    const html = render({ platform: "instagram", format: "carousel", files: ["i2", "i1"] });

    expect(html).toContain("Publica 2 imágenes en ese orden");
    expect(html).toContain("bg-emerald-500/10");
  });

  it("el selector se filtra por el formato: un carrusel no ofrece el video", () => {
    const html = render({ platform: "instagram", format: "carousel", files: [] });

    expect(html).toContain("dos.jpg");
    expect(html).not.toContain("clip.mp4");
  });

  it("un Reel ofrece el video y no las imagenes", () => {
    const html = render({ platform: "instagram", format: "reel", files: [] });

    expect(html).toContain("clip.mp4");
    expect(html).not.toContain("uno.jpg");
  });

  it("los archivos ya elegidos no se vuelven a ofrecer para agregar", () => {
    const html = render({ platform: "instagram", format: "carousel", files: ["i1", "i2"] });

    // Solo tres.jpg queda para agregar.
    expect(html).toContain("+ tres.jpg");
    expect(html).not.toContain("+ uno.jpg");
  });

  it("↑ ↓ y sacar: el primero no tiene ↑ habilitado y el ultimo no tiene ↓", () => {
    const html = render({ platform: "instagram", format: "carousel", files: ["i1", "i2"] });

    // `disabled=""` es el atributo; "disabled:opacity-30" es una clase y no cuenta.
    expect(html).toMatch(/aria-label="Subir uno\.jpg"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Bajar dos\.jpg"[^>]*disabled=""/);
    expect(html).not.toMatch(/aria-label="Bajar uno\.jpg"[^>]*disabled=""/);
    expect(html).not.toMatch(/aria-label="Subir dos\.jpg"[^>]*disabled=""/);
    expect(html).toContain('aria-label="Sacar uno.jpg de instagram"');
  });

  it("un formato de un solo archivo no ofrece reordenar (no hay nada que ordenar)", () => {
    const html = render({ platform: "instagram", format: "reel", files: ["v1"] });

    expect(html).not.toContain("Subir clip.mp4");
    expect(html).toContain("Publica 1 video");
  });

  it("Solo texto no lleva archivos y esta en verde sin ellos", () => {
    const html = render({ platform: "threads", format: "text", files: [] });

    expect(html).toContain("Publica solo texto");
    expect(html).not.toContain("Agregá archivos");
  });

  it("sin permiso de edicion no hay botones para cambiar nada", () => {
    const html = render({ platform: "instagram", format: "carousel", files: ["i1", "i2"] }, { editable: false });

    expect(html).not.toContain("Subir uno.jpg");
    expect(html).not.toContain("+ tres.jpg");
    expect(html).toMatch(/<select[^>]*disabled=""/);
  });

  it("una red con archivos propios del modelo anterior lo dice", () => {
    const html = render({ platform: "instagram", media: [{ storage_path: "x" }, { storage_path: "y" }] });

    expect(html).toContain("2 archivos propios del formato anterior");
  });

  it("un id elegido que ya no esta en la biblioteca no se dibuja", () => {
    const html = render({ platform: "instagram", format: "carousel", files: ["i1", "fantasma"] });

    expect(html).toContain("uno.jpg");
    expect(html).not.toContain("fantasma");
  });
});

describe("la biblioteca de archivos (F92)", () => {
  const renderLibrary = (usage: Record<string, string[]>, canEdit = true) =>
    renderToStaticMarkup(
      createElement(MediaUploader, { postId: "post-1", media: LIB, usage, canEdit }),
    );

  it("cada archivo muestra nombre, tipo, peso y proporcion", () => {
    const html = renderLibrary({});

    expect(html).toContain("uno.jpg");
    expect(html).toContain("Imagen · 2.0 MB · 4:5");
    expect(html).toContain("Video · 30.0 MB · 9:16");
  });

  it("CRITERIO: un archivo que ninguna red usa dice 'Sin usar', en naranja", () => {
    const html = renderLibrary({ i1: ["instagram"] });

    expect(html).toContain("Sin usar");
    expect(html).toContain("text-amber-700");
  });

  it("y el que usan las redes dice cuales", () => {
    const html = renderLibrary({ i1: ["instagram", "tiktok"] });

    expect(html).toContain("Se usa en Instagram, TikTok");
  });

  it("una biblioteca vacia lo explica en vez de quedar en blanco", () => {
    const html = renderToStaticMarkup(
      createElement(MediaUploader, { postId: "post-1", media: [], usage: {}, canEdit: true }),
    );

    expect(html).toContain("Todavía no hay archivos");
  });

  it("sin permiso de edicion no hay Quitar ni Subir", () => {
    const html = renderLibrary({}, false);

    expect(html).not.toContain("Quitar");
    expect(html).not.toContain("Subir archivos");
  });

  it("no muestra los archivos ya borrados", () => {
    const html = renderToStaticMarkup(
      createElement(MediaUploader, {
        postId: "post-1",
        media: [{ ...img("i9", "borrada.jpg"), deleted_at: "2026-10-01T00:00:00Z" }],
        usage: {},
        canEdit: true,
      }),
    );

    expect(html).not.toContain("borrada.jpg");
  });
});
