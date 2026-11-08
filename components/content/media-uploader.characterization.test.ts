/**
 * Caracterización de `MediaUploader` ANTES de que la biblioteca agrupe los archivos de un diseño (DS8, F65).
 *
 * Fija lo que dibuja hoy (el botón de subir, lo que acepta, «Quitar», «Sin usar» y «Se usa en…») y lo que llama: pedir la
 * subida con los primeros bytes, subir directo a Storage, anotar el archivo y, al quitar, avisar antes. Los archivos que
 * no vienen de un diseño se ven y se comportan igual después del cambio: sus aserciones no se tocan.
 *
 * Se renderiza en el servidor (sin navegador); lo que llama se lee del código, porque sin navegador no hay clics.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaEntry } from "@/lib/content/media";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/actions/content-media", () => ({
  attachMedia: async () => ({ ok: true }),
  removeMedia: async () => ({ ok: true, data: { removedFrom: [] } }),
  requestMediaUpload: async () => ({ ok: false, error: "no" }),
}));

const { MediaUploader } = await import("./media-uploader");

const source = readFileSync(resolve(__dirname, "media-uploader.tsx"), "utf8");

const file = (id: string, name: string, extra: Partial<MediaEntry> = {}): MediaEntry => ({
  id,
  name,
  storage_path: `ws/post/${id}.jpg`,
  mime_type: "image/jpeg",
  kind: "image",
  size_bytes: 1024 * 1024,
  width: 1080,
  height: 1080,
  ...extra,
});

const render = (props: { media?: MediaEntry[]; usage?: Record<string, string[]>; canEdit?: boolean }) =>
  renderToStaticMarkup(createElement(MediaUploader, { postId: "post-1", media: props.media ?? [], usage: props.usage ?? {}, canEdit: props.canEdit ?? true }));

describe("MediaUploader, como está hoy (antes de DS8)", () => {
  it("con permiso ofrece subir archivos, de los tipos que Contenido admite", () => {
    const html = render({ media: [file("a", "a.jpg")] });

    expect(html).toContain("Subir archivos");
    expect(html).toContain('aria-label="Elegir archivos para subir"');
    expect(html).toContain('accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.pdf"');
    expect(html).toContain("multiple");
  });

  it("una lista de archivos con su nombre accesible y una tarjeta por archivo, en el orden de la biblioteca", () => {
    const html = render({ media: [file("b", "segundo.jpg"), file("a", "primero.jpg")] });

    expect(html).toContain('aria-label="Archivos de la pieza"');
    expect(html.indexOf("segundo.jpg")).toBeLessThan(html.indexOf("primero.jpg"));
    expect((html.match(/Quitar/g) ?? []).length).toBe(2);
  });

  it("cada archivo dice si lo usa una red o está sin usar", () => {
    const html = render({ media: [file("a", "a.jpg"), file("b", "b.jpg")], usage: { a: ["instagram", "linkedin"] } });

    expect(html).toContain("Se usa en Instagram, LinkedIn");
    expect(html).toContain("Sin usar");
  });

  it("un PDF y un video se describen por su tipo, no como imagen", () => {
    const html = render({
      media: [
        file("p", "guia.pdf", { storage_path: "ws/post/p.pdf", mime_type: "application/pdf", kind: "document", width: null, height: null }),
        file("v", "clip.mp4", { storage_path: "ws/post/v.mp4", mime_type: "video/mp4", kind: "video", width: 1080, height: 1920 }),
      ],
    });

    expect(html).toContain("Documento · 1.0 MB");
    expect(html).toContain("Video · 1.0 MB · 9:16");
  });

  it("sin permiso no hay botón de subir ni de quitar, pero se ve la lista", () => {
    const html = render({ media: [file("a", "a.jpg")], canEdit: false });

    expect(html).toContain("a.jpg");
    expect(html).not.toContain("Quitar");
    expect(html).not.toContain("Subir archivos");
    expect(html).not.toContain('type="file"');
  });

  it("vacía, lo explica", () => {
    expect(render({})).toContain("Todavía no hay archivos. Subilos una vez y después elegís cuáles publica cada red.");
  });

  it("no dibuja los archivos ya borrados", () => {
    const html = render({ media: [file("a", "a.jpg"), file("z", "borrado.jpg", { deleted_at: "2026-10-01T00:00:00Z" })] });

    expect(html).not.toContain("borrado.jpg");
  });

  it("lo que llama: pide la subida con los primeros bytes, sube directo a Storage y anota el archivo", () => {
    expect(source).toContain('import { attachMedia, removeMedia, requestMediaUpload } from "@/lib/actions/content-media"');
    // Los primeros 16 bytes, que es con lo que el servidor decide el tipo.
    expect(source).toContain("file.slice(0, 16)");
    expect(source).toContain("requestMediaUpload({");
    expect(source).toContain("headBase64:");
    // Dos caminos de subida y la anotación en la biblioteca, en ese orden.
    expect(source.indexOf("requestMediaUpload({")).toBeLessThan(source.indexOf("attachMedia({"));
    expect(source).toContain("uploadResumable(");
    expect(source).toContain("uploadSimple(");
    expect(source).toContain('.from("content-media")');
    expect(source).toContain("router.refresh()");
  });

  it("lo que llama al quitar: avisa antes (y dice qué redes lo usan) y recién después pide sacarlo", () => {
    expect(source).toContain("window.confirm(message)");
    expect(source).toContain("Si lo quitás, también se saca de ahí. ¿Seguís?");
    expect(source).toContain("¿Quitar");
    expect(source.indexOf("window.confirm(message)")).toBeLessThan(source.indexOf("removeMedia({ postId, fileId: id })"));
    expect(source).toContain("onRemoved?.(id, result.data.removedFrom)");
  });
});
