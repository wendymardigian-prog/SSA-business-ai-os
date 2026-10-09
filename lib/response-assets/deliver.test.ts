/**
 * Mandar un recurso desde una automatizacion (flow o secuencia).
 *
 * Lo que se fija: el canal decide que se manda (y lo que no, se saltea CON
 * motivo en vez de salir roto), las variables salen de los datos reales, un
 * archivo viaja siempre como COPIA, un audio sale solo, y nada lanza.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { sendChannelMessage, recordSend, copyAssetToChat, touchAssetUsage } = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
  recordSend: vi.fn(async () => undefined),
  copyAssetToChat: vi.fn(),
  touchAssetUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/flow-engine/send", () => ({ sendChannelMessage, recordSend }));
vi.mock("@/lib/response-assets/send-copy", () => ({ copyAssetToChat }));
vi.mock("@/lib/response-assets/usage", () => ({ touchAssetUsage }));

import { deliverAsset, plainAssetText } from "./deliver";

const WS = "ws-1";

const CONTEXT = {
  workspaceId: WS,
  channelId: "ch-1",
  contactId: "c-1",
  conversationId: "cv-1",
  flowId: "f-1",
  nodeId: "n-1",
};

function world(provider: string, assets: Array<Record<string, unknown>>) {
  return memoryDb({
    response_assets: assets,
    channels: [{ id: "ch-1", workspace_id: WS, provider }],
    contacts: [{ id: "c-1", display_name: "Ana Gómez", email: "ana@x.com", phone: "+5491122334455" }],
    workspaces: [{ id: WS, name: "Mi Negocio" }],
  });
}

const asset = (over: Record<string, unknown>) => ({
  id: "a-1", workspace_id: WS, kind: "text", name: "Precio", content: null, url: null, caption: null,
  mime_type: null, transcript: null, transcript_status: "none", is_active: true, deleted_at: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendChannelMessage.mockResolvedValue({ ok: true, platformMessageId: "plat-1" });
});

describe("plainAssetText", () => {
  it("un texto resuelve sus variables con los datos reales", () => {
    const data = { contact: { display_name: "Ana" }, workspace: { name: "Mi Negocio" } };
    expect(plainAssetText({ kind: "text", content: "Hola {{contact.display_name}}, soy de {{workspace.name}}", url: null }, null, data))
      .toBe("Hola Ana, soy de Mi Negocio");
  });

  it("un enlace va con el texto que se le sume y la direccion tal cual", () => {
    expect(plainAssetText({ kind: "link", content: null, url: "https://cal.com/ana" }, "Reservá acá:", {})).toBe("Reservá acá:\nhttps://cal.com/ana");
    expect(plainAssetText({ kind: "link", content: null, url: "https://cal.com/ana" }, null, {})).toBe("https://cal.com/ana");
  });
});

describe("deliverAsset: texto y enlace", () => {
  it("manda el texto ya resuelto y cuenta el uso DESPUES", async () => {
    const db = world("evolution", [asset({ content: "Hola {{contact.display_name}}" })]);
    const result = await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT });

    expect(result).toEqual({ ok: true, kind: "text" });
    expect(sendChannelMessage).toHaveBeenCalledWith(db.client, expect.objectContaining({ conversationId: "cv-1" }), { text: "Hola Ana Gómez" });
    expect(recordSend).toHaveBeenCalledTimes(1);
    expect(touchAssetUsage).toHaveBeenCalledWith(db.client, "a-1");
  });

  it("por email entra un texto y un enlace (lo unico que el email puede mandar)", async () => {
    const db = world("resend", [asset({ content: "Gracias" }), asset({ id: "a-2", kind: "link", url: "https://x.com" })]);
    expect((await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT })).ok).toBe(true);
    expect((await deliverAsset(db.client, { assetId: "a-2", context: CONTEXT })).ok).toBe(true);
  });

  it("un envio rechazado deja el motivo y NO cuenta el uso", async () => {
    sendChannelMessage.mockResolvedValue({ ok: false, failure: { kind: "unknown", message: "se cayo", retryable: false } });
    const db = world("evolution", [asset({ content: "Hola" })]);

    const result = await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT });

    expect(result).toEqual({ ok: false, status: "failed", reason: "se cayo", retryable: false });
    expect(recordSend).toHaveBeenCalledWith(db.client, expect.anything(), "se cayo", expect.objectContaining({ ok: false }));
    expect(touchAssetUsage).not.toHaveBeenCalled();
  });

  it("un canal frenado por el tope de la hora es reintentable", async () => {
    sendChannelMessage.mockResolvedValue({ ok: false, failure: { kind: "rate_limited", message: "tope", retryable: true } });
    const db = world("evolution", [asset({ content: "Hola" })]);
    expect(await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT })).toMatchObject({ status: "failed", retryable: true });
  });
});

describe("deliverAsset: lo que NO se manda, se dice", () => {
  it("el email no manda archivos: se saltea con el motivo, sin copiar ni mandar nada", async () => {
    const db = world("resend", [asset({ kind: "image", mime_type: "image/png" })]);
    const result = await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT });

    expect(result).toMatchObject({ ok: false, status: "skipped", reason: expect.stringContaining("email") });
    expect(copyAssetToChat).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("Instagram no manda un archivo ni un audio webm", async () => {
    const db = world("zernio", [asset({ kind: "file", mime_type: "application/pdf" }), asset({ id: "a-2", kind: "audio", mime_type: "audio/webm" })]);
    expect(await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT })).toMatchObject({ status: "skipped" });
    expect(await deliverAsset(db.client, { assetId: "a-2", context: CONTEXT })).toMatchObject({ status: "skipped" });
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("un recurso borrado, apagado o de otro workspace no se manda", async () => {
    const db = world("evolution", [
      asset({ id: "borrado", deleted_at: "2026-10-01T00:00:00Z" }),
      asset({ id: "apagado", is_active: false }),
      asset({ id: "ajeno", workspace_id: "otro-ws" }),
    ]);
    for (const id of ["borrado", "apagado", "ajeno", "no-existe"]) {
      expect(await deliverAsset(db.client, { assetId: id, context: CONTEXT })).toMatchObject({ ok: false, status: "skipped" });
    }
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("sin conversacion (un flow de agenda) no hay por donde mandarlo", async () => {
    const db = world("evolution", [asset({ content: "Hola" })]);
    expect(await deliverAsset(db.client, { assetId: "a-1", context: { ...CONTEXT, conversationId: null } })).toMatchObject({ status: "skipped" });
    expect(await deliverAsset(db.client, { assetId: "a-1", context: { ...CONTEXT, channelId: null } })).toMatchObject({ status: "skipped" });
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("un texto vacio no se manda en blanco", async () => {
    const db = world("evolution", [asset({ content: "   " })]);
    expect(await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT })).toMatchObject({ status: "skipped" });
  });
});

describe("deliverAsset: con archivo", () => {
  const copy = (assetKind: string, kind: string) => ({
    ok: true as const,
    copy: { assetKind, kind, storagePath: `${WS}/cv-1/library-copia.bin`, mime: "x/y", filename: "Recurso.bin", durationSeconds: 8, sizeBytes: 100, caption: "Mirá esto" },
  });

  it("manda la COPIA a la conversacion, nunca el path de la biblioteca", async () => {
    copyAssetToChat.mockResolvedValue(copy("image", "image"));
    const db = world("evolution", [asset({ kind: "image", mime_type: "image/png" })]);

    const result = await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT });

    expect(result).toEqual({ ok: true, kind: "image" });
    expect(copyAssetToChat).toHaveBeenCalledWith(db.client, { workspaceId: WS, conversationId: "cv-1", assetId: "a-1" });
    expect(sendChannelMessage).toHaveBeenCalledWith(
      db.client,
      expect.anything(),
      expect.objectContaining({ text: "Mirá esto", media: expect.objectContaining({ storagePath: `${WS}/cv-1/library-copia.bin` }) }),
    );
  });

  it("el texto del paso reemplaza al del recurso, con las variables resueltas", async () => {
    copyAssetToChat.mockResolvedValue(copy("image", "image"));
    const db = world("evolution", [asset({ kind: "image", mime_type: "image/png" })]);

    await deliverAsset(db.client, { assetId: "a-1", caption: "Hola {{contact.display_name}}", context: CONTEXT });

    expect(sendChannelMessage).toHaveBeenCalledWith(db.client, expect.anything(), expect.objectContaining({ text: "Hola Ana Gómez" }));
  });

  it("un audio sale SOLO por el canal; su transcripcion queda guardada como texto del mensaje", async () => {
    copyAssetToChat.mockResolvedValue(copy("audio", "audio"));
    const db = world("evolution", [asset({ kind: "audio", mime_type: "audio/mp4", transcript: "Hola, soy Wendy", transcript_status: "ready" })]);

    await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT });

    expect(sendChannelMessage).toHaveBeenCalledWith(db.client, expect.anything(), expect.objectContaining({ text: "" }));
    expect(recordSend).toHaveBeenCalledWith(db.client, expect.anything(), "Hola, soy Wendy", expect.anything(), expect.anything());
  });

  it("si no se pudo copiar el archivo, falla (reintentable) y no manda nada", async () => {
    copyAssetToChat.mockResolvedValue({ ok: false, error: "No pude preparar el recurso" });
    const db = world("evolution", [asset({ kind: "video", mime_type: "video/mp4" })]);

    expect(await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT })).toEqual({
      ok: false, status: "failed", reason: "No pude preparar el recurso", retryable: true,
    });
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });
});

describe("deliverAsset: nunca lanza", () => {
  it("una falla inesperada es un resultado, no una excepcion", async () => {
    sendChannelMessage.mockRejectedValue(new Error("boom"));
    const db = world("evolution", [asset({ content: "Hola" })]);
    expect(await deliverAsset(db.client, { assetId: "a-1", context: CONTEXT })).toMatchObject({ ok: false, status: "failed", retryable: false });
  });
});
