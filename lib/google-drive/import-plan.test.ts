import { describe, it, expect, vi } from "vitest";
import { assetKindForMime, planDriveItem } from "./import-plan";
import { driveCopyMode } from "./copy-mode";
import { readDriveFileBytes, DriveError } from "./client";

const MB = 1024 * 1024;

describe("que se puede hacer con cada archivo de Drive (00374)", () => {
  it("un PDF se copia como documento", () => {
    expect(planDriveItem({ mimeType: "application/pdf", sizeBytes: 2 * MB })).toMatchObject({
      canCopy: true,
      kind: "file",
      copy: { kind: "download" },
    });
  });

  it("un Google Doc, una hoja y una presentacion se exportan a PDF", () => {
    for (const type of ["document", "spreadsheet", "presentation"]) {
      expect(planDriveItem({ mimeType: `application/vnd.google-apps.${type}`, sizeBytes: null })).toMatchObject({
        canCopy: true,
        kind: "file",
        copy: { kind: "export", mimeType: "application/pdf" },
      });
    }
  });

  it("una carpeta o un Form solo se guardan como enlace, y se dice por que", () => {
    expect(planDriveItem({ mimeType: "application/vnd.google-apps.folder", sizeBytes: null })).toMatchObject({
      canCopy: false,
      reason: expect.stringContaining("carpeta"),
    });
    expect(planDriveItem({ mimeType: "application/vnd.google-apps.form", sizeBytes: null }).canCopy).toBe(false);
  });

  it("mas de 16 MB no se copia", () => {
    const plan = planDriveItem({ mimeType: "video/mp4", sizeBytes: 40 * MB });
    expect(plan).toMatchObject({ canCopy: false, reason: expect.stringContaining("16 MB") });
  });

  it("un tipo que Recursos no acepta no se copia", () => {
    expect(planDriveItem({ mimeType: "application/zip", sizeBytes: MB }).canCopy).toBe(false);
  });

  it("cada mime cae en su tipo de recurso", () => {
    expect(assetKindForMime("image/png")).toBe("image");
    expect(assetKindForMime("video/mp4")).toBe("video");
    expect(assetKindForMime("audio/mp4")).toBe("audio");
    expect(assetKindForMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("file");
    expect(assetKindForMime("text/plain")).toBeNull();
  });

  it("un archivo comun se descarga tal cual", () => {
    expect(driveCopyMode("image/jpeg")).toEqual({ kind: "download" });
  });
});

describe("bajar un archivo de Drive", () => {
  it("corta si Drive dice que pesa de mas, sin leer el cuerpo", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("x", { status: 200, headers: { "content-length": String(20 * MB) } }),
    );
    await expect(
      readDriveFileBytes({ token: "t", fileId: "abc1234567", mode: { kind: "download" }, maxBytes: 16 * MB, fetchImpl }),
    ).rejects.toBeInstanceOf(DriveError);
  });

  it("corta mientras lee si el archivo resulta mas grande", async () => {
    const big = new Uint8Array(1000);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(big, { status: 200 }));
    await expect(
      readDriveFileBytes({ token: "t", fileId: "abc1234567", mode: { kind: "download" }, maxBytes: 500, fetchImpl }),
    ).rejects.toThrow("enlace");
  });

  it("exporta un Google Doc pidiendo PDF", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const bytes = await readDriveFileBytes({
      token: "t",
      fileId: "abc1234567",
      mode: { kind: "export", mimeType: "application/pdf" },
      maxBytes: 500,
      fetchImpl,
    });
    expect(bytes.byteLength).toBe(3);
    expect(fetchImpl.mock.calls[0][0]).toContain("/export?mimeType=application%2Fpdf");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer t" } });
  });

  it("un 404 de Drive se explica en palabras", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(
      readDriveFileBytes({ token: "t", fileId: "abc1234567", mode: { kind: "download" }, maxBytes: 500, fetchImpl }),
    ).rejects.toThrow("selector");
  });
});
