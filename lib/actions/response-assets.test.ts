/**
 * La banca de recursos (seis tipos en response_assets).
 *
 * Lo que importa: crear un recurso valida segun su `kind` (la misma regla que
 * el formulario, lib/response-assets/shape.ts), crear un audio o un video con
 * voz encola la transcripcion y un video sin voz no, un atajo repetido da un
 * mensaje en castellano que dice con quien choca Y ESO VALE ENTRE TODOS LOS
 * TIPOS, reemplazar el archivo descarta la transcripcion y la miniatura
 * anteriores, y administrar pide `templates.manage` (banca v2, F4): un Member
 * no puede, un rol personalizado con la clave si.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getPermissionAction, getWorkspace, logAudit, scheduleJob, createServiceClient } = vi.hoisted(() => ({
  getPermissionAction: vi.fn(),
  getWorkspace: vi.fn(),
  logAudit: vi.fn(async () => "audit-1"),
  scheduleJob: vi.fn(async () => ({ id: "job-1" })),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getPermissionAction }));
vi.mock("@/lib/workspace", () => ({ getWorkspace }));
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, logAudit };
});
vi.mock("@/lib/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduler")>();
  return { ...actual, scheduleJob };
});
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createAsset,
  updateAsset,
  deleteAsset,
  correctTranscript,
  listAssets,
  requestAssetUpload,
  prepareAssetSend,
  setAssetAgentEnabled,
  retryTranscription,
  markAssetUsed,
} from "./response-assets";

const WS = "ws-1";
const USER = "u-1";

function admin(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = memoryDb({ response_assets: [], ...seed });
  getPermissionAction.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
  createServiceClient.mockResolvedValue(db.client);
  return db;
}

const NO_PERMISSION = "No tenés permiso para administrar la banca de recursos. Pedíselo a un Admin.";

/** Un archivo ya subido a la biblioteca, como lo devuelve requestAssetUpload. */
const file = (name: string, mimeType: string, extra: Record<string, unknown> = {}) => ({
  storagePath: `${WS}/library/${name}`,
  mimeType,
  sizeBytes: 1000,
  ...extra,
});

const row = (db: ReturnType<typeof memoryDb>, id?: string) =>
  id ? db.rows("response_assets").find((a) => a.id === id)! : db.rows("response_assets")[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getPermissionAction.mockReset();
  scheduleJob.mockResolvedValue({ id: "job-1" });
});

describe("createAsset: texto", () => {
  it("crea un texto y no encola transcripcion", async () => {
    const db = admin();

    const result = await createAsset({ kind: "text", name: "Precio", content: "Sale X", shortcut: "/precio" });

    expect(result.ok).toBe(true);
    expect(row(db)).toMatchObject({ kind: "text", name: "Precio", content: "Sale X", shortcut: "/precio" });
    expect(scheduleJob).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityType: "response_asset" }));
  });

  it("contenido vacio se rechaza", async () => {
    admin();
    const result = await createAsset({ kind: "text", name: "Precio", content: "   " });
    expect(result).toMatchObject({ ok: false });
  });

  it("una variable inexistente en el contenido se rechaza", async () => {
    admin();
    const result = await createAsset({ kind: "text", name: "Precio", content: "Hola {{contact.saldo}}" });
    expect(result).toMatchObject({ ok: false });
  });

  it("sin templates.manage no se crea: el guard corta antes de tocar la base", async () => {
    getPermissionAction.mockResolvedValue(null);
    const result = await createAsset({ kind: "text", name: "X", content: "y" });
    expect(result).toEqual({ ok: false, error: NO_PERMISSION });
    expect(getPermissionAction).toHaveBeenCalledWith("templates.manage");
  });
});

describe("createAsset: audio", () => {
  it("crea el audio y encola la transcripcion", async () => {
    const db = admin();

    const result = await createAsset({
      kind: "audio",
      name: "Precio",
      description: "Cuando preguntan el precio",
      shortcut: "/precio-audio",
      file: file("x.m4a", "audio/mp4", { durationSeconds: 8, source: "recorded" }),
    });

    expect(result.ok).toBe(true);
    expect(row(db)).toMatchObject({ kind: "audio", name: "Precio", description: "Cuando preguntan el precio" });
    expect(scheduleJob).toHaveBeenCalledWith(
      db.client,
      "transcribe_audio",
      { assetId: row(db).id },
      expect.any(Date),
      `transcribe-asset:${row(db).id}`,
    );
  });

  it("sin descripcion, se rechaza: es obligatoria para la IA", async () => {
    admin();
    const result = await createAsset({
      kind: "audio", name: "Precio", description: "",
      file: file("x.m4a", "audio/mp4", { source: "recorded" }),
    });
    expect(result).toMatchObject({ ok: false });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un archivo de otro workspace se rechaza", async () => {
    admin();
    const result = await createAsset({
      kind: "audio", name: "X", description: "d",
      file: { storagePath: "otro-ws/library/x.m4a", mimeType: "audio/mp4" },
    });
    expect(result).toEqual({ ok: false, error: "Ese archivo no es de la banca de este negocio" });
  });
});

describe("createAsset: los tipos nuevos", () => {
  it("un video con voz encola la transcripcion y guarda su miniatura", async () => {
    const db = admin();
    const result = await createAsset({
      kind: "video", name: "Testimonio", description: "Ana cuenta su resultado", caption: "Mirá a Ana",
      file: file("v.mp4", "video/mp4", { durationSeconds: 40, previewPath: `${WS}/library/v-preview.jpg` }),
    });
    expect(result.ok).toBe(true);
    expect(row(db)).toMatchObject({
      kind: "video", source: "uploaded", caption: "Mirá a Ana", duration_seconds: 40,
      preview_path: `${WS}/library/v-preview.jpg`, mime_type: "video/mp4",
    });
    expect(scheduleJob).toHaveBeenCalledWith(db.client, "transcribe_audio", { assetId: row(db).id }, expect.any(Date), `transcribe-asset:${row(db).id}`);
  });

  it("un video sin voz NO se encola: no hay nada que transcribir ni que cobrar", async () => {
    admin();
    const result = await createAsset({
      kind: "video", name: "Demo muda", description: "Recorrido por el panel", hasVoice: false,
      file: file("v.mp4", "video/mp4"),
    });
    expect(result.ok).toBe(true);
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("una imagen y un archivo no se encolan nunca, y no guardan duracion", async () => {
    const db = admin();
    await createAsset({ kind: "image", name: "Flyer", description: "d", file: file("i.png", "image/png", { durationSeconds: 3 }) });
    await createAsset({ kind: "file", name: "Propuesta", description: "d", file: file("f.pdf", "application/pdf") });
    expect(scheduleJob).not.toHaveBeenCalled();
    expect(db.rows("response_assets").map((r) => [r.kind, r.duration_seconds])).toEqual([["image", null], ["file", null]]);
  });

  it("un enlace guarda la URL normalizada y su clase, sin archivo", async () => {
    const db = admin();
    const result = await createAsset({ kind: "link", name: "Agenda", description: "Reservar", url: "calendly.com/wendy", linkKind: "agenda" });
    expect(result.ok).toBe(true);
    expect(row(db)).toMatchObject({ kind: "link", url: "https://calendly.com/wendy", link_kind: "agenda" });
    expect(row(db).storage_path).toBeUndefined();
  });

  it("un enlace con una URL que no es http se rechaza", async () => {
    admin();
    const result = await createAsset({ kind: "link", name: "X", description: "d", url: "javascript:alert(1)", linkKind: "otro" });
    expect(result.ok).toBe(false);
  });

  it("un archivo que no corresponde al tipo se rechaza (un audio como imagen)", async () => {
    admin();
    const result = await createAsset({ kind: "image", name: "X", description: "d", file: file("x.m4a", "audio/mp4") });
    expect(result).toEqual({ ok: false, error: "El archivo no corresponde a este tipo de recurso" });
  });

  it("solo un audio se graba", async () => {
    admin();
    const result = await createAsset({ kind: "video", name: "X", description: "d", file: file("x.mp4", "video/mp4", { source: "recorded" }) });
    expect(result.ok).toBe(false);
  });

  it("un tipo que no existe se rechaza", async () => {
    admin();
    const result = await createAsset({ kind: "gif" as never, name: "X" });
    expect(result).toEqual({ ok: false, error: "Ese tipo de recurso no existe" });
  });
});

describe("el atajo es unico ENTRE TODOS LOS TIPOS", () => {
  it("un texto y un audio no pueden compartir atajo, y el error dice con quien choca", async () => {
    const db = memoryDb(
      { response_assets: [] },
      { unique: { response_assets: (a, b) => a.workspace_id === b.workspace_id && a.shortcut === b.shortcut && a.shortcut != null } },
    );
    getPermissionAction.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
    createServiceClient.mockResolvedValue(db.client);

    const text = await createAsset({ kind: "text", name: "Uno", content: "contenido", shortcut: "/zz-test" });
    expect(text.ok).toBe(true);

    const audio = await createAsset({
      kind: "audio", name: "Dos", description: "desc", shortcut: "/zz-test",
      file: file("p2.m4a", "audio/mp4", { source: "recorded" }),
    });

    expect(audio).toMatchObject({
      ok: false,
      error: 'No pude crear el recurso: El atajo /zz-test ya lo usa "Uno" (texto). Elegí uno distinto.',
    });
  });
});

describe("updateAsset", () => {
  it("edita nombre y contenido de un texto sin tocar transcripcion", async () => {
    const db = admin({
      response_assets: [{ id: "t-1", workspace_id: WS, kind: "text", name: "Viejo", content: "c", shortcut: null, agent_enabled: false, is_active: true }],
    });

    const result = await updateAsset("t-1", { name: "Nuevo", content: "c2" });

    expect(result.ok).toBe(true);
    expect(row(db, "t-1")).toMatchObject({ name: "Nuevo", content: "c2" });
    expect(scheduleJob).not.toHaveBeenCalled();
    // El audit log compara contra el valor de ANTES, no el ya actualizado.
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ name: { old: "Viejo", new: "Nuevo" } }) }),
    );
  });

  it("edita nombre y descripcion de un audio sin tocar el archivo", async () => {
    const db = admin({
      response_assets: [{
        id: "a-1", workspace_id: WS, kind: "audio", name: "Viejo", description: "d", shortcut: null,
        storage_path: "p", agent_enabled: false, is_active: true,
      }],
    });

    const result = await updateAsset("a-1", { name: "Nuevo", description: "d2" });

    expect(result.ok).toBe(true);
    expect(row(db, "a-1")).toMatchObject({ name: "Nuevo", description: "d2" });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("reemplazar el archivo de un audio descarta la transcripcion anterior, vuelve a encolar y borra el archivo VIEJO del bucket", async () => {
    const db = admin({
      response_assets: [{
        id: "a-1", workspace_id: WS, kind: "audio", name: "X", description: "d", shortcut: null,
        storage_path: "old.m4a", transcript: "lo viejo", transcript_status: "ready", transcript_source: "auto",
        agent_enabled: false, is_active: true,
      }],
    });
    const remove = vi.fn(async () => ({ error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };

    const result = await updateAsset("a-1", {
      name: "X", description: "d",
      replacement: file("new.m4a", "audio/mp4", { durationSeconds: 5 }),
    });

    expect(result.ok).toBe(true);
    expect(row(db, "a-1")).toMatchObject({ storage_path: `${WS}/library/new.m4a`, transcript: null, transcript_status: "none" });
    expect(scheduleJob).toHaveBeenCalledWith(db.client, "transcribe_audio", { assetId: "a-1" }, expect.any(Date), "transcribe-asset:a-1");
    // El archivo que se borra es el VIEJO, no el nuevo: nadie mas lo referencia.
    expect(remove).toHaveBeenCalledWith(["old.m4a"]);
  });

  it("editar un audio sin reemplazar el archivo no borra nada del bucket", async () => {
    const db = admin({
      response_assets: [{
        id: "a-1", workspace_id: WS, kind: "audio", name: "Viejo", description: "d", shortcut: null,
        storage_path: "p.m4a", agent_enabled: false, is_active: true,
      }],
    });
    const remove = vi.fn(async () => ({ error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };

    await updateAsset("a-1", { name: "Nuevo", description: "d" });

    expect(remove).not.toHaveBeenCalled();
  });

  it("reemplazar un video borra el archivo y la miniatura viejos", async () => {
    const db = admin({
      response_assets: [{
        id: "v-1", workspace_id: WS, kind: "video", name: "X", description: "d", shortcut: null,
        storage_path: "old.mp4", preview_path: "old-preview.jpg", transcript: "t", transcript_status: "ready",
        agent_enabled: false, is_active: true,
      }],
    });
    const remove = vi.fn(async () => ({ error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };

    const result = await updateAsset("v-1", {
      name: "X", description: "d",
      replacement: { ...file("new.mp4", "video/mp4"), previewPath: `${WS}/library/new-preview.jpg`, hasVoice: false },
    });

    expect(result.ok).toBe(true);
    expect(row(db, "v-1")).toMatchObject({ preview_path: `${WS}/library/new-preview.jpg`, transcript_status: "none" });
    expect(remove).toHaveBeenCalledWith(["old.mp4", "old-preview.jpg"]);
    // Sin voz: no se encola.
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("habilitar para el agente es parte del update, en los dos tipos", async () => {
    const db = admin({
      response_assets: [{ id: "t-1", workspace_id: WS, kind: "text", name: "X", content: "c", shortcut: null, agent_enabled: false, is_active: true }],
    });

    await updateAsset("t-1", { name: "X", content: "c", agentEnabled: true });

    expect(row(db, "t-1").agent_enabled).toBe(true);
  });

  it("sin templates.manage no se edita", async () => {
    getPermissionAction.mockResolvedValue(null);
    const result = await updateAsset("a-1", { name: "X" });
    expect(result).toEqual({ ok: false, error: NO_PERMISSION });
  });
});

describe("deleteAsset", () => {
  it("borrado logico: deja deleted_at, no borra la fila", async () => {
    const db = admin({
      response_assets: [{ id: "a-1", workspace_id: WS, kind: "text", name: "X", content: "c", shortcut: null, deleted_at: null }],
    });

    const result = await deleteAsset("a-1");

    expect(result.ok).toBe(true);
    expect(row(db, "a-1").deleted_at).toBeTruthy();
  });

  it("sin templates.manage no se da de baja", async () => {
    getPermissionAction.mockResolvedValue(null);
    expect(await deleteAsset("a-1")).toEqual({ ok: false, error: NO_PERMISSION });
  });

  it("borrar un video borra su archivo y su miniatura", async () => {
    const db = admin({
      response_assets: [{ id: "v-1", workspace_id: WS, kind: "video", name: "X", description: "d", shortcut: null, storage_path: "v.mp4", preview_path: "v-preview.jpg", deleted_at: null }],
    });
    const remove = vi.fn(async () => ({ error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };

    await deleteAsset("v-1");

    expect(remove).toHaveBeenCalledWith(["v.mp4", "v-preview.jpg"]);
  });

  it("borrar un enlace no toca el bucket", async () => {
    const db = admin({
      response_assets: [{ id: "l-1", workspace_id: WS, kind: "link", name: "X", url: "https://x.com", deleted_at: null }],
    });
    const remove = vi.fn(async () => ({ error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };

    await deleteAsset("l-1");

    expect(remove).not.toHaveBeenCalled();
  });

  it("borrar un audio borra su archivo del bucket en el momento", async () => {
    const db = admin({
      response_assets: [{ id: "a-1", workspace_id: WS, kind: "audio", name: "X", description: "d", shortcut: null, storage_path: "p.m4a", deleted_at: null }],
    });
    const remove = vi.fn(async () => ({ error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };

    const result = await deleteAsset("a-1");

    expect(result.ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(["p.m4a"]);
  });

  it("borrar un texto no toca el bucket (no tiene archivo)", async () => {
    const db = admin({
      response_assets: [{ id: "t-1", workspace_id: WS, kind: "text", name: "X", content: "c", shortcut: null, deleted_at: null }],
    });
    const remove = vi.fn(async () => ({ error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: () => ({ remove }) };

    await deleteAsset("t-1");

    expect(remove).not.toHaveBeenCalled();
  });
});

describe("correctTranscript", () => {
  it("corrige a mano: queda transcript_source='manual'", async () => {
    const db = admin({
      response_assets: [{ id: "a-1", workspace_id: WS, kind: "audio", transcript: "mal transcripto", transcript_source: "auto" }],
    });

    const result = await correctTranscript("a-1", "texto correcto");

    expect(result.ok).toBe(true);
    expect(row(db, "a-1")).toMatchObject({ transcript: "texto correcto", transcript_source: "manual", transcript_status: "ready" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { transcript: { old: "mal transcripto", new: "texto correcto" } } }),
    );
  });

  it("vacio se rechaza", async () => {
    admin({ response_assets: [{ id: "a-1", workspace_id: WS, kind: "audio" }] });
    expect(await correctTranscript("a-1", "   ")).toMatchObject({ ok: false });
  });

  it("un texto no tiene transcripcion que corregir", async () => {
    admin({ response_assets: [{ id: "t-1", workspace_id: WS, kind: "text", content: "c" }] });
    expect(await correctTranscript("t-1", "algo")).toMatchObject({ ok: false, error: "Solo un audio o un video tiene transcripción" });
  });

  it("un video tambien se corrige a mano", async () => {
    const db = admin({ response_assets: [{ id: "v-1", workspace_id: WS, kind: "video", transcript: "mal" }] });
    expect((await correctTranscript("v-1", "bien")).ok).toBe(true);
    expect(row(db, "v-1")).toMatchObject({ transcript: "bien", transcript_source: "manual" });
  });
});

describe("setAssetAgentEnabled", () => {
  it("un audio sin transcripcion lista no se puede habilitar", async () => {
    admin({ response_assets: [{ id: "a-1", workspace_id: WS, kind: "audio", transcript_status: "pending", agent_enabled: false }] });
    expect((await setAssetAgentEnabled("a-1", true)).ok).toBe(false);
  });

  it("un video sin voz ('none') si: lo usa por su descripcion", async () => {
    const db = admin({ response_assets: [{ id: "v-1", workspace_id: WS, kind: "video", transcript_status: "none", agent_enabled: false }] });
    expect((await setAssetAgentEnabled("v-1", true)).ok).toBe(true);
    expect(row(db, "v-1").agent_enabled).toBe(true);
  });

  it("un video con la transcripcion fallida no", async () => {
    admin({ response_assets: [{ id: "v-1", workspace_id: WS, kind: "video", transcript_status: "failed", agent_enabled: false }] });
    expect((await setAssetAgentEnabled("v-1", true)).ok).toBe(false);
  });

  it("una imagen, un archivo y un enlace siempre, y apagar siempre", async () => {
    const db = admin({
      response_assets: [
        { id: "i-1", workspace_id: WS, kind: "image", transcript_status: "none", agent_enabled: false },
        { id: "a-1", workspace_id: WS, kind: "audio", transcript_status: "pending", agent_enabled: true },
      ],
    });
    expect((await setAssetAgentEnabled("i-1", true)).ok).toBe(true);
    expect((await setAssetAgentEnabled("a-1", false)).ok).toBe(true);
    expect(row(db, "a-1").agent_enabled).toBe(false);
  });
});

describe("retryTranscription", () => {
  it("vuelve a encolar una transcripcion fallida", async () => {
    const db = admin({ response_assets: [{ id: "v-1", workspace_id: WS, kind: "video", transcript_status: "failed" }] });
    expect((await retryTranscription("v-1")).ok).toBe(true);
    expect(scheduleJob).toHaveBeenCalledWith(db.client, "transcribe_audio", { assetId: "v-1" }, expect.any(Date), "transcribe-asset:v-1");
  });

  it("una que no fallo, no", async () => {
    admin({ response_assets: [{ id: "a-1", workspace_id: WS, kind: "audio", transcript_status: "ready" }] });
    expect((await retryTranscription("a-1")).ok).toBe(false);
    expect(scheduleJob).not.toHaveBeenCalled();
  });
});

describe("listAssets", () => {
  it("cualquier miembro puede listar (no pasa por el permiso de administrar)", async () => {
    const db = memoryDb({
      response_assets: [
        { id: "t-1", workspace_id: WS, kind: "text", name: "X", deleted_at: null },
        { id: "a-1", workspace_id: WS, kind: "audio", name: "Y", deleted_at: null },
        { id: "a-2", workspace_id: WS, kind: "audio", name: "Z", deleted_at: new Date().toISOString() },
      ],
    });
    getWorkspace.mockResolvedValue({ workspace: { id: WS }, supabase: db.client });

    const result = await listAssets();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name).sort()).toEqual(["X", "Y"]);
  });
});

describe("requestAssetUpload", () => {
  const M4A_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]).toString("base64");

  it("firma la subida a chat-media/<ws>/library/<id>.<ext>", async () => {
    const db = admin();
    (db.client as unknown as { storage: unknown }).storage = {
      from: () => ({ createSignedUploadUrl: async () => ({ data: { token: "tok-1" }, error: null }) }),
    };

    const result = await requestAssetUpload({ kind: "audio", sizeBytes: 1000, headBase64: M4A_HEAD });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ticket.path).toMatch(new RegExp(`^${WS}/library/[0-9a-f-]+\\.m4a$`));
      expect(result.ticket.mime).toBe("audio/mp4");
    }
  });

  it("un archivo que no es del tipo elegido se rechaza, por su contenido", async () => {
    admin();
    const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
    const result = await requestAssetUpload({ kind: "audio", sizeBytes: 1000, headBase64: jpegHead, declaredMime: "audio/mpeg" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("no es un audio reconocible") });
  });

  it("una imagen entra como imagen y un docx como archivo", async () => {
    const db = admin();
    (db.client as unknown as { storage: unknown }).storage = {
      from: () => ({ createSignedUploadUrl: async () => ({ data: { token: "tok" }, error: null }) }),
    };
    const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
    const zipHead = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const image = await requestAssetUpload({ kind: "image", sizeBytes: 1000, headBase64: jpegHead });
    const doc = await requestAssetUpload({ kind: "file", sizeBytes: 1000, headBase64: zipHead, declaredMime: DOCX });

    expect(image).toMatchObject({ ok: true, ticket: { mime: "image/jpeg" } });
    expect(doc).toMatchObject({ ok: true, ticket: { mime: DOCX } });
    if (doc.ok) expect(doc.ticket.path).toMatch(/\.docx$/);
  });

  it("un enlace o un texto no llevan archivo", async () => {
    admin();
    const result = await requestAssetUpload({ kind: "link", sizeBytes: 1000, headBase64: M4A_HEAD });
    expect(result).toEqual({ ok: false, error: "Ese tipo de recurso no lleva archivo" });
  });

  it("sin templates.manage no se sube", async () => {
    getPermissionAction.mockResolvedValue(null);
    const result = await requestAssetUpload({ kind: "audio", sizeBytes: 1000, headBase64: M4A_HEAD });
    expect(result).toEqual({ ok: false, error: NO_PERMISSION });
  });
});

describe("prepareAssetSend", () => {
  it("copia el audio a la conversacion y devuelve el path nuevo", async () => {
    const db = memoryDb({
      response_assets: [{ id: "a-1", workspace_id: WS, kind: "audio", name: "Precio", storage_path: `${WS}/library/a-1.m4a`, mime_type: "audio/mp4", duration_seconds: 8, deleted_at: null }],
      conversations: [{ id: "c-1", workspace_id: WS }],
    });
    getWorkspace.mockResolvedValue({ workspace: { id: WS }, supabase: db.client });
    createServiceClient.mockResolvedValue(db.client);
    (db.client as unknown as { storage: unknown }).storage = {
      from: () => ({ copy: async () => ({ data: { path: "copied" }, error: null }) }),
    };

    const result = await prepareAssetSend("c-1", "a-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.copy.storagePath).toMatch(new RegExp(`^${WS}/c-1/library-`));
      expect(result.copy.filename).toBe("Precio.m4a");
    }
  });

  it("una conversacion que no es del workspace (o fuera del scope de leads) se rechaza", async () => {
    const db = memoryDb({ response_assets: [], conversations: [] });
    getWorkspace.mockResolvedValue({ workspace: { id: WS }, supabase: db.client });

    const result = await prepareAssetSend("c-inexistente", "a-1");

    expect(result).toEqual({ ok: false, error: "No encontré esa conversación" });
  });
});

describe("markAssetUsed", () => {
  it("cuenta el uso por la funcion de la base, con el cliente del usuario", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    getWorkspace.mockResolvedValue({ workspace: { id: WS }, supabase: { rpc } });
    await markAssetUsed("a-1");
    expect(rpc).toHaveBeenCalledWith("touch_response_asset", { p_asset_id: "a-1" });
  });

  it("si la base falla, no lanza: el envio ya salio", async () => {
    getWorkspace.mockResolvedValue({ workspace: { id: WS }, supabase: { rpc: async () => ({ error: { message: "boom" } }) } });
    await expect(markAssetUsed("a-1")).resolves.toBeUndefined();
    getWorkspace.mockRejectedValue(new Error("sin sesion"));
    await expect(markAssetUsed("a-1")).resolves.toBeUndefined();
  });
});
