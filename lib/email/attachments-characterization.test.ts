/**
 * Caracterización de los adjuntos de RECURSOS de «Enviar email», escrita ANTES de sumar el adjunto de un diseño
 * (Diseñador IA, F59). Fija lo que hacen hoy el parseo, el presupuesto, los problemas al publicar y la carga.
 *
 * Estas aserciones no se tocan: el adjunto de un diseño es una rama NUEVA; un paso con recursos tiene que seguir
 * comportándose igual, byte por byte.
 */

import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { loadEmailAttachments } from "./flow-attachments";
import { attachmentBudget, emailAttachmentProblems, MAX_EMAIL_ATTACHMENT_BYTES, MAX_EMAIL_ATTACHMENTS, parseEmailAttachments } from "./attachment-limits";

const MB = 1024 * 1024;

describe("parseEmailAttachments (recursos, como hoy)", () => {
  it("conserva el orden, el nombre y el tamaño; saca repetidos, basura y tamaños inválidos", () => {
    expect(
      parseEmailAttachments([
        { assetId: "a1", name: "Propuesta.pdf", sizeBytes: 100 },
        { assetId: "a2" },
        { assetId: "a1", name: "repetido" },
        { assetId: "" },
        { assetId: 7 },
        null,
        "a3",
        { assetId: "a4", name: 9, sizeBytes: "200" },
        { assetId: "a5", sizeBytes: 0 },
        { assetId: "a6", sizeBytes: -3 },
        { assetId: "a7", sizeBytes: "x" },
      ]),
    ).toEqual([
      { assetId: "a1", name: "Propuesta.pdf", sizeBytes: 100 },
      { assetId: "a2" },
      { assetId: "a4", sizeBytes: 200 },
      { assetId: "a5" },
      { assetId: "a6" },
      { assetId: "a7" },
    ]);
  });

  it("lo que no es una lista da una lista vacía", () => {
    for (const value of [undefined, null, {}, "a1", 3]) expect(parseEmailAttachments(value)).toEqual([]);
  });
});

describe("attachmentBudget (como hoy)", () => {
  it("dentro del tope", () => {
    expect(attachmentBudget([MB, null, undefined, 2 * MB])).toEqual({ ok: true, totalBytes: 3 * MB, problem: null });
    expect(attachmentBudget([])).toEqual({ ok: true, totalBytes: 0, problem: null });
    expect(attachmentBudget([MAX_EMAIL_ATTACHMENT_BYTES])).toEqual({ ok: true, totalBytes: MAX_EMAIL_ATTACHMENT_BYTES, problem: null });
  });

  it("más de 10 archivos gana sobre el peso; más de 25 MB después", () => {
    expect(attachmentBudget(Array(MAX_EMAIL_ATTACHMENTS + 1).fill(30 * MB))).toEqual({
      ok: false,
      totalBytes: 11 * 30 * MB,
      problem: "Hasta 10 adjuntos por email.",
    });
    expect(attachmentBudget([MAX_EMAIL_ATTACHMENT_BYTES, 1])).toEqual({
      ok: false,
      totalBytes: MAX_EMAIL_ATTACHMENT_BYTES + 1,
      problem: "Los adjuntos pasan de 25 MB en total: sacá alguno o usá un recurso más liviano.",
    });
  });
});

describe("emailAttachmentProblems (al publicar, como hoy)", () => {
  it("junta los problemas sin repetir y no mira pasos sin adjuntos", () => {
    const big = { data: { attachments: [{ assetId: "a", sizeBytes: 20 * MB }, { assetId: "b", sizeBytes: 10 * MB }] } };
    const many = { data: { attachments: Array.from({ length: 11 }, (_, i) => ({ assetId: `x${i}` })) } };
    expect(emailAttachmentProblems([big, big, many, { data: {} }, { data: { attachments: [] } }, null, "x"])).toEqual([
      "Los adjuntos pasan de 25 MB en total: sacá alguno o usá un recurso más liviano.",
      "Hasta 10 adjuntos por email.",
    ]);
    expect(emailAttachmentProblems(undefined)).toEqual([]);
    expect(emailAttachmentProblems([{ data: { attachments: [{ assetId: "a", sizeBytes: MB }] } }])).toEqual([]);
  });
});

describe("loadEmailAttachments (recursos, como hoy)", () => {
  function world(downloads: Record<string, number | "fail">) {
    const db = memoryDb({
      response_assets: [
        { id: "pdf", workspace_id: "ws", kind: "file", name: "Guía de inicio.pdf", storage_path: "ws/library/pdf.pdf", mime_type: "application/pdf", size_bytes: 5, is_active: true, deleted_at: null },
        { id: "img", workspace_id: "ws", kind: "image", name: "Portada", storage_path: "ws/library/img.png", mime_type: "image/png", size_bytes: 5, is_active: true, deleted_at: null },
        { id: "txt", workspace_id: "ws", kind: "text", name: "Saludo", storage_path: null, mime_type: null, size_bytes: null, is_active: true, deleted_at: null },
        { id: "sin-archivo", workspace_id: "ws", kind: "file", name: "Sin archivo", storage_path: null, mime_type: "application/pdf", size_bytes: null, is_active: true, deleted_at: null },
        { id: "roto", workspace_id: "ws", kind: "file", name: "Roto", storage_path: "ws/library/roto.pdf", mime_type: "application/pdf", size_bytes: 5, is_active: true, deleted_at: null },
      ],
    });
    const download = vi.fn(async (path: string) => {
      const size = downloads[path];
      if (size === undefined || size === "fail") return { data: null, error: { message: "no existe" } };
      return { data: new Blob([new Uint8Array(size).fill(65)]), error: null };
    });
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ download }) };
    return { db, download };
  }

  it("un archivo por recurso, en el orden pedido; los faltantes con el nombre del paso o el del recurso", async () => {
    const { db, download } = world({ "ws/library/pdf.pdf": 3, "ws/library/img.png": 2, "ws/library/roto.pdf": "fail" });
    const out = await loadEmailAttachments(db.client as never, {
      workspaceId: "ws",
      refs: [
        { assetId: "img", name: "lo que dice el paso" },
        { assetId: "pdf" },
        { assetId: "txt", name: "Texto" },
        { assetId: "sin-archivo" },
        { assetId: "roto", name: "nombre del paso" },
        { assetId: "no-existe" },
      ],
    });
    expect(out.files).toEqual([
      { filename: "Portada.png", content: "QUE=" },
      { filename: "Guia-de-inicio.pdf", content: "QUFB" },
    ]);
    // Un texto no es un archivo (no se consulta), uno sin archivo y uno que no existe usan el nombre del paso o
    // «un adjunto»; uno que no se pudo bajar usa el nombre del RECURSO.
    expect(out.missing).toEqual(["Texto", "un adjunto", "Roto", "un adjunto"]);
    expect(download).toHaveBeenCalledTimes(3);
  });

  it("después del décimo, los demás quedan como faltantes sin bajarse", async () => {
    const { db, download } = world({ "ws/library/pdf.pdf": 1 });
    const refs = [...Array.from({ length: 10 }, () => ({ assetId: "pdf" })), { assetId: "img", name: "once" }, { assetId: "img" }];
    const out = await loadEmailAttachments(db.client as never, { workspaceId: "ws", refs });
    expect(out.missing.slice(0, 2)).toEqual(["once", "un adjunto"]);
    expect(out.files).toHaveLength(10);
    expect(download).toHaveBeenCalledTimes(10);
  });

  it("sin adjuntos no consulta nada", async () => {
    const { db, download } = world({});
    expect(await loadEmailAttachments(db.client as never, { workspaceId: "ws", refs: [] })).toEqual({ files: [], missing: [] });
    expect(download).not.toHaveBeenCalled();
  });
});
