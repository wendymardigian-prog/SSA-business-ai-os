import { describe, it, expect } from "vitest";
import { assetAttachment, assetFilename, assetOpenUrl, assetThumbUrl } from "./preview";
import { renderPlan } from "@/lib/inbox/media-render";

const base = { name: "Propuesta 2026", sizeBytes: 1000, durationSeconds: null, url: null, previewPath: null };

describe("assetAttachment: el mismo adjunto que pinta la bandeja", () => {
  it("cada tipo con archivo se dibuja con su componente, sin firmar nada todavia", () => {
    const cases = [
      ["audio", "audio/ogg", "audio"],
      ["video", "video/mp4", "video"],
      ["image", "image/png", "image"],
      ["file", "application/pdf", "document"],
    ] as const;
    for (const [kind, mime, component] of cases) {
      const item = assetAttachment({ ...base, kind, mimeType: mime, storagePath: `ws/library/x` });
      expect(item, kind).not.toBeNull();
      const plan = renderPlan(item!);
      expect(plan.component, kind).toBe(component);
      // La URL es la ruta propia que firma al abrir, nunca una URL firmada.
      expect(plan.url, kind).toMatch(/^\/api\/v1\/chat-media\?path=/);
    }
  });

  it("un texto o un enlace no tienen adjunto", () => {
    expect(assetAttachment({ ...base, kind: "text", mimeType: null, storagePath: null })).toBeNull();
    expect(assetAttachment({ ...base, kind: "link", mimeType: null, storagePath: null })).toBeNull();
  });
});

describe("assetOpenUrl", () => {
  it("un PDF se abre en una pestaña; un Word se baja con su nombre", () => {
    expect(assetOpenUrl({ ...base, kind: "file", mimeType: "application/pdf", storagePath: "ws/library/a.pdf" })).toBe(
      "/api/v1/chat-media?path=ws%2Flibrary%2Fa.pdf",
    );
    const word = assetOpenUrl({ ...base, kind: "file", mimeType: "application/msword", storagePath: "ws/library/a.doc" });
    expect(word).toContain("download=1");
    expect(word).toContain("name=Propuesta-2026.doc");
  });

  it("un enlace abre su URL", () => {
    expect(assetOpenUrl({ ...base, kind: "link", mimeType: null, storagePath: null, url: "https://x.com" })).toBe("https://x.com");
  });
});

describe("assetThumbUrl y assetFilename", () => {
  it("la imagen misma o la miniatura del video; nada para lo demas", () => {
    expect(assetThumbUrl({ kind: "image", storagePath: "ws/library/i.png", previewPath: null })).toContain("i.png");
    expect(assetThumbUrl({ kind: "video", storagePath: "ws/library/v.mp4", previewPath: "ws/library/v-preview.jpg" })).toContain("v-preview.jpg");
    expect(assetThumbUrl({ kind: "video", storagePath: "ws/library/v.mp4", previewPath: null })).toBeNull();
    expect(assetThumbUrl({ kind: "file", storagePath: "ws/library/f.pdf", previewPath: null })).toBeNull();
  });

  it("el nombre lleva la extension del mime", () => {
    expect(assetFilename({ name: "Testimonio Ana", mimeType: "video/quicktime" })).toBe("Testimonio-Ana.mov");
  });
});
