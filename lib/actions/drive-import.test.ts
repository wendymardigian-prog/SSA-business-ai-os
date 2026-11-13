/**
 * Importar de Google Drive a Recursos (00374): como enlace usa el link que
 * dice Drive, como archivo baja (o exporta) los bytes, decide el tipo por el
 * contenido, los guarda en la banca y crea el recurso con `createAsset`. Un
 * archivo que falla no frena a los demas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getPermissionAction: vi.fn(),
  createServiceClient: vi.fn(),
  createAsset: vi.fn(),
  getDriveAccessToken: vi.fn(),
  getDriveFileMeta: vi.fn(),
  readDriveFileBytes: vi.fn(),
  findDriveConnection: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: h.getPermissionAction }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: h.createServiceClient }));
vi.mock("./response-assets", () => ({ createAsset: h.createAsset }));
vi.mock("@/lib/google-drive/client", () => ({
  getDriveAccessToken: h.getDriveAccessToken,
  getDriveFileMeta: h.getDriveFileMeta,
  readDriveFileBytes: h.readDriveFileBytes,
  findDriveConnection: h.findDriveConnection,
}));

import { importFromDrive } from "./drive-import";

const WS = "ws-1";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 32)]);

beforeEach(() => {
  vi.clearAllMocks();
  h.getPermissionAction.mockResolvedValue({ workspace: { id: WS }, user: { id: "u-1" } });
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
  h.createServiceClient.mockResolvedValue({
    storage: { from: () => ({ upload: h.upload, remove: h.remove }) },
  });
  h.getDriveAccessToken.mockResolvedValue("token-drive");
  h.createAsset.mockResolvedValue({ ok: true, assetId: "asset-1" });
});

describe("importar de Drive", () => {
  it("sin permiso para la banca no hace nada", async () => {
    h.getPermissionAction.mockResolvedValue(null);
    const result = await importFromDrive([{ fileId: "abcdefghij", mode: "link", name: "x", description: "y" }]);
    expect(result.ok).toBe(false);
    expect(h.getDriveAccessToken).not.toHaveBeenCalled();
  });

  it("como enlace guarda el link de Drive, no el que mande el navegador", async () => {
    h.getDriveFileMeta.mockResolvedValue({
      id: "abcdefghij",
      name: "Propuesta",
      mimeType: "application/vnd.google-apps.folder",
      size: null,
      webViewLink: "https://drive.google.com/drive/folders/abcdefghij",
    });

    const result = await importFromDrive([{ fileId: "abcdefghij", mode: "link", name: "Propuestas", description: "La carpeta" }]);

    expect(result).toMatchObject({ ok: true, results: [{ ok: true, assetId: "asset-1" }] });
    expect(h.createAsset).toHaveBeenCalledWith({
      kind: "link",
      name: "Propuestas",
      description: "La carpeta",
      url: "https://drive.google.com/drive/folders/abcdefghij",
      linkKind: "drive",
    });
    expect(h.readDriveFileBytes).not.toHaveBeenCalled();
  });

  it("un Google Doc como archivo se exporta a PDF y queda como documento de la banca", async () => {
    h.getDriveFileMeta.mockResolvedValue({
      id: "docdocdoc1",
      name: "Guion",
      mimeType: "application/vnd.google-apps.document",
      size: null,
      webViewLink: "https://docs.google.com/document/d/docdocdoc1",
    });
    h.readDriveFileBytes.mockResolvedValue(PDF);

    const result = await importFromDrive([{ fileId: "docdocdoc1", mode: "file", name: "Guion", description: "El guion" }]);

    expect(result).toMatchObject({ ok: true, results: [{ ok: true }] });
    expect(h.readDriveFileBytes.mock.calls[0][0]).toMatchObject({ mode: { kind: "export", mimeType: "application/pdf" } });
    const [path, , options] = h.upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${WS}/library/[0-9a-f-]+\\.pdf$`));
    expect(options).toMatchObject({ contentType: "application/pdf" });
    expect(h.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "file",
        file: expect.objectContaining({ storagePath: path, mimeType: "application/pdf", source: "uploaded" }),
      }),
    );
  });

  it("si Drive dice PDF pero los bytes no lo son, no se guarda", async () => {
    h.getDriveFileMeta.mockResolvedValue({ id: "fakepdf001", name: "x", mimeType: "application/pdf", size: 300, webViewLink: null });
    h.readDriveFileBytes.mockResolvedValue(Buffer.alloc(300, 65));

    const result = await importFromDrive([{ fileId: "fakepdf001", mode: "file", name: "x", description: "y" }]);

    expect(result).toMatchObject({ ok: true, results: [{ ok: false }] });
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.createAsset).not.toHaveBeenCalled();
  });

  it("si el alta falla, el archivo subido se borra", async () => {
    h.getDriveFileMeta.mockResolvedValue({ id: "pdfpdfpdf1", name: "x", mimeType: "application/pdf", size: 300, webViewLink: null });
    h.readDriveFileBytes.mockResolvedValue(PDF);
    h.createAsset.mockResolvedValue({ ok: false, error: "El atajo ya existe" });

    const result = await importFromDrive([{ fileId: "pdfpdfpdf1", mode: "file", name: "x", description: "y" }]);

    expect(result).toMatchObject({ ok: true, results: [{ ok: false, error: "El atajo ya existe" }] });
    expect(h.remove).toHaveBeenCalledWith([h.upload.mock.calls[0][0]]);
  });

  it("un archivo que falla no frena a los demas", async () => {
    h.getDriveFileMeta
      .mockRejectedValueOnce(new Error("Drive no encontró el archivo"))
      .mockResolvedValueOnce({ id: "okokokok01", name: "ok", mimeType: "application/pdf", size: 1, webViewLink: "https://drive.google.com/file/d/okokokok01" });

    const result = await importFromDrive([
      { fileId: "malmalmal1", mode: "link", name: "a", description: "a" },
      { fileId: "okokokok01", mode: "link", name: "b", description: "b" },
    ]);

    expect(result).toMatchObject({
      ok: true,
      results: [
        { fileId: "malmalmal1", ok: false, error: "Drive no encontró el archivo" },
        { fileId: "okokokok01", ok: true },
      ],
    });
  });

  it("un id raro no llega a Drive", async () => {
    const result = await importFromDrive([{ fileId: "../../etc", mode: "link", name: "a", description: "a" }]);
    expect(result).toMatchObject({ ok: true, results: [{ ok: false }] });
    expect(h.getDriveFileMeta).not.toHaveBeenCalled();
  });

  it("sin Drive conectado lo dice", async () => {
    h.getDriveAccessToken.mockResolvedValue(null);
    const result = await importFromDrive([{ fileId: "abcdefghij", mode: "link", name: "a", description: "a" }]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Drive") });
  });
});
