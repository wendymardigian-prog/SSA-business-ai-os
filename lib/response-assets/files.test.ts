import { describe, it, expect } from "vitest";
import { fileRejection, formatBytes, formatLabel, mimeMatchesKind, MAX_ASSET_BYTES } from "./files";

describe("mimeMatchesKind", () => {
  it("cada tipo acepta su familia y nada mas", () => {
    expect(mimeMatchesKind("audio", "audio/ogg")).toBe(true);
    expect(mimeMatchesKind("audio", "video/mp4")).toBe(false);
    expect(mimeMatchesKind("video", "video/webm")).toBe(true);
    expect(mimeMatchesKind("video", "audio/webm")).toBe(false);
    expect(mimeMatchesKind("image", "image/png")).toBe(true);
    expect(mimeMatchesKind("image", "image/heic")).toBe(false);
    expect(mimeMatchesKind("file", "application/pdf")).toBe(true);
    expect(mimeMatchesKind("file", "application/zip")).toBe(false);
    expect(mimeMatchesKind("file", "image/png")).toBe(false);
  });
});

describe("fileRejection", () => {
  it("acepta un archivo valido", () => {
    expect(fileRejection("file", "application/pdf", 1000)).toBeNull();
  });

  it("vacio y demasiado grande", () => {
    expect(fileRejection("image", "image/png", 0)).toBe("El archivo está vacío");
    expect(fileRejection("image", "image/png", MAX_ASSET_BYTES + 1)).toMatch(/máximo es 16 MB/);
  });

  it("HEIC tiene su propio mensaje, con que hacer", () => {
    expect(fileRejection("image", "image/heic", 1000)).toMatch(/Convertila a JPG o PNG/);
  });

  it("un archivo de otro tipo dice que formatos entran", () => {
    expect(fileRejection("video", "audio/ogg", 1000)).toBe("Ese archivo no es un video reconocible. Se aceptan MP4, MOV o WebM.");
    expect(fileRejection("file", null, 1000)).toMatch(/PDF, Word, Excel o PowerPoint/);
  });
});

describe("formatos", () => {
  it("peso legible", () => {
    expect(formatBytes(2_500_000)).toBe("2,4 MB");
    expect(formatBytes(800)).toBe("1 KB");
    expect(formatBytes(null)).toBe("");
  });

  it("nombre del formato", () => {
    expect(formatLabel("application/pdf")).toBe("PDF");
    expect(formatLabel("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("Excel");
    expect(formatLabel("application/msword")).toBe("Word");
    expect(formatLabel("video/mp4")).toBe("MP4");
  });
});
