/**
 * La banca de recursos (textos + audios en response_assets).
 *
 * Lo que importa: crear un texto o un audio valida segun su `kind`, crear un
 * audio encola la transcripcion, un atajo repetido da un mensaje en
 * castellano (no el error crudo de Postgres) Y ESO VALE ENTRE LOS DOS TIPOS
 * (un texto y un audio no pueden compartir atajo), reemplazar el archivo de
 * un audio descarta la transcripcion anterior y vuelve a encolar, y un
 * Member no puede administrar nada de esto (la RLS lo corta, pero
 * getAdminContext ya lo corta antes).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getAdminContext, getWorkspace, logAudit, scheduleJob, createServiceClient } = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  getWorkspace: vi.fn(),
  logAudit: vi.fn(async () => "audit-1"),
  scheduleJob: vi.fn(async () => ({ id: "job-1" })),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getAdminContext }));
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
} from "./response-assets";

const WS = "ws-1";
const USER = "u-1";

function admin(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = memoryDb({ response_assets: [], ...seed });
  getAdminContext.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
  createServiceClient.mockResolvedValue(db.client);
  return db;
}

const row = (db: ReturnType<typeof memoryDb>, id?: string) =>
  id ? db.rows("response_assets").find((a) => a.id === id)! : db.rows("response_assets")[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getAdminContext.mockReset();
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

  it("un Member no puede crear: getAdminContext ya corta antes de tocar la base", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await createAsset({ kind: "text", name: "X", content: "y" });
    expect(result).toEqual({ ok: false, error: "Solo Owner y Admin pueden crear recursos" });
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
      storagePath: `${WS}/library/x.m4a`,
      mimeType: "audio/mp4",
      durationSeconds: 8,
      source: "recorded",
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
      storagePath: `${WS}/library/x.m4a`, mimeType: "audio/mp4", source: "recorded",
    });
    expect(result).toMatchObject({ ok: false });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un Member no puede crear", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await createAsset({ kind: "audio", name: "X", description: "y", storagePath: "p", mimeType: "audio/mp4", source: "recorded" });
    expect(result).toEqual({ ok: false, error: "Solo Owner y Admin pueden crear recursos" });
    expect(scheduleJob).not.toHaveBeenCalled();
  });
});

describe("el atajo es unico ENTRE LOS DOS TIPOS", () => {
  it("un texto y un audio no pueden compartir atajo", async () => {
    const db = memoryDb(
      { response_assets: [] },
      { unique: { response_assets: (a, b) => a.workspace_id === b.workspace_id && a.shortcut === b.shortcut && a.shortcut != null } },
    );
    getAdminContext.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
    createServiceClient.mockResolvedValue(db.client);

    const text = await createAsset({ kind: "text", name: "Uno", content: "contenido", shortcut: "/zz-test" });
    expect(text.ok).toBe(true);

    const audio = await createAsset({
      kind: "audio", name: "Dos", description: "desc", shortcut: "/zz-test",
      storagePath: "p2", mimeType: "audio/mp4", source: "recorded",
    });

    expect(audio).toMatchObject({ ok: false, error: "No pude crear el recurso: Ya hay un recurso con ese atajo. Elegí uno distinto." });
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
      replacement: { storagePath: "new.m4a", mimeType: "audio/mp4", durationSeconds: 5 },
    });

    expect(result.ok).toBe(true);
    expect(row(db, "a-1")).toMatchObject({ storage_path: "new.m4a", transcript: null, transcript_status: "none" });
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

  it("habilitar para el agente es parte del update, en los dos tipos", async () => {
    const db = admin({
      response_assets: [{ id: "t-1", workspace_id: WS, kind: "text", name: "X", content: "c", shortcut: null, agent_enabled: false, is_active: true }],
    });

    await updateAsset("t-1", { name: "X", content: "c", agentEnabled: true });

    expect(row(db, "t-1").agent_enabled).toBe(true);
  });

  it("un Member no puede editar", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await updateAsset("a-1", { name: "X" });
    expect(result).toEqual({ ok: false, error: "Solo Owner y Admin pueden editar recursos" });
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

  it("un Member no puede dar de baja", async () => {
    getAdminContext.mockResolvedValue(null);
    expect(await deleteAsset("a-1")).toEqual({ ok: false, error: "Solo Owner y Admin pueden eliminar recursos" });
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
    expect(await correctTranscript("t-1", "algo")).toMatchObject({ ok: false, error: "Solo un audio tiene transcripción" });
  });
});

describe("listAssets", () => {
  it("cualquier miembro puede listar (no pasa por getAdminContext), de los dos tipos", async () => {
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

    const result = await requestAssetUpload({ sizeBytes: 1000, headBase64: M4A_HEAD });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ticket.path).toMatch(new RegExp(`^${WS}/library/[0-9a-f-]+\\.m4a$`));
      expect(result.ticket.mime).toBe("audio/mp4");
    }
  });

  it("un archivo que no es audio se rechaza", async () => {
    admin();
    const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
    const result = await requestAssetUpload({ sizeBytes: 1000, headBase64: jpegHead });
    expect(result).toMatchObject({ ok: false });
  });

  it("un Member no puede subir", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await requestAssetUpload({ sizeBytes: 1000, headBase64: M4A_HEAD });
    expect(result).toEqual({ ok: false, error: "Solo Owner y Admin pueden administrar la banca de recursos" });
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
