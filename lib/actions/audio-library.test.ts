/**
 * La banca de audios (F20).
 *
 * Lo que importa: crear encola la transcripcion, un atajo repetido da un
 * mensaje en castellano (no el error crudo de Postgres), reemplazar el
 * archivo descarta la transcripcion anterior y vuelve a encolar, y un Member
 * no puede administrar nada de esto (la RLS lo corta, pero getAdminContext
 * ya lo corta antes).
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
  createAudioAsset,
  updateAudioAsset,
  deleteAudioAsset,
  correctAudioTranscript,
  listAudioAssets,
  requestAudioAssetUpload,
} from "./audio-library";

const WS = "ws-1";
const USER = "u-1";

function admin(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = memoryDb({ audio_assets: [], ...seed });
  getAdminContext.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
  createServiceClient.mockResolvedValue(db.client);
  return db;
}

const row = (db: ReturnType<typeof memoryDb>, id?: string) =>
  id ? db.rows("audio_assets").find((a) => a.id === id)! : db.rows("audio_assets")[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getAdminContext.mockReset();
  scheduleJob.mockResolvedValue({ id: "job-1" });
});

describe("createAudioAsset (F20)", () => {
  it("crea el audio y encola la transcripcion", async () => {
    const db = admin();

    const result = await createAudioAsset({
      name: "Precio",
      description: "Cuando preguntan el precio",
      shortcut: "/precio",
      storagePath: `${WS}/library/x.m4a`,
      mimeType: "audio/mp4",
      durationSeconds: 8,
      source: "recorded",
    });

    expect(result.ok).toBe(true);
    expect(row(db)).toMatchObject({ name: "Precio", description: "Cuando preguntan el precio", shortcut: "/precio" });
    expect(scheduleJob).toHaveBeenCalledWith(
      db.client,
      "transcribe_audio",
      { audioAssetId: row(db).id },
      expect.any(Date),
      `transcribe-asset:${row(db).id}`,
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityType: "audio_asset" }));
  });

  it("sin descripcion, se rechaza: es obligatoria para la IA", async () => {
    admin();
    const result = await createAudioAsset({
      name: "Precio",
      description: "",
      storagePath: `${WS}/library/x.m4a`,
      mimeType: "audio/mp4",
      source: "recorded",
    });
    expect(result).toMatchObject({ ok: false });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un atajo duplicado da el mensaje en castellano, no el error crudo de Postgres", async () => {
    const db = memoryDb(
      { audio_assets: [] },
      { unique: { audio_assets: (a, b) => a.workspace_id === b.workspace_id && a.shortcut === b.shortcut && a.shortcut != null } },
    );
    getAdminContext.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
    createServiceClient.mockResolvedValue(db.client);

    await createAudioAsset({ name: "Uno", description: "desc", shortcut: "/precio", storagePath: "p1", mimeType: "audio/mp4", source: "recorded" });
    const result = await createAudioAsset({ name: "Dos", description: "desc", shortcut: "/precio", storagePath: "p2", mimeType: "audio/mp4", source: "recorded" });

    expect(result).toMatchObject({ ok: false, error: "No pude crear el audio: Ya hay un audio con ese atajo" });
  });

  it("un Member no puede crear: getAdminContext ya corta antes de tocar la base", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await createAudioAsset({ name: "X", description: "y", storagePath: "p", mimeType: "audio/mp4", source: "recorded" });
    expect(result).toEqual({ ok: false, error: "Solo Owner y Admin pueden crear audios" });
    expect(scheduleJob).not.toHaveBeenCalled();
  });
});

describe("updateAudioAsset (F20)", () => {
  it("edita nombre y descripcion sin tocar el archivo", async () => {
    const db = admin({
      audio_assets: [{ id: "a-1", workspace_id: WS, name: "Viejo", description: "d", shortcut: null, storage_path: "p", agent_enabled: false, is_active: true }],
    });

    const result = await updateAudioAsset("a-1", { name: "Nuevo", description: "d2" });

    expect(result.ok).toBe(true);
    expect(row(db, "a-1")).toMatchObject({ name: "Nuevo", description: "d2" });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("reemplazar el archivo descarta la transcripcion anterior y vuelve a encolar", async () => {
    const db = admin({
      audio_assets: [{
        id: "a-1", workspace_id: WS, name: "X", description: "d", shortcut: null,
        storage_path: "old.m4a", transcript: "lo viejo", transcript_status: "ready", transcript_source: "auto",
        agent_enabled: false, is_active: true,
      }],
    });

    const result = await updateAudioAsset("a-1", {
      name: "X", description: "d",
      replacement: { storagePath: "new.m4a", mimeType: "audio/mp4", durationSeconds: 5 },
    });

    expect(result.ok).toBe(true);
    expect(row(db, "a-1")).toMatchObject({ storage_path: "new.m4a", transcript: null, transcript_status: "none" });
    expect(scheduleJob).toHaveBeenCalledWith(db.client, "transcribe_audio", { audioAssetId: "a-1" }, expect.any(Date), "transcribe-asset:a-1");
  });

  it("habilitar para el agente es parte del update", async () => {
    const db = admin({
      audio_assets: [{ id: "a-1", workspace_id: WS, name: "X", description: "d", shortcut: null, storage_path: "p", agent_enabled: false, is_active: true }],
    });

    await updateAudioAsset("a-1", { name: "X", description: "d", agentEnabled: true });

    expect(row(db, "a-1").agent_enabled).toBe(true);
  });

  it("un Member no puede editar", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await updateAudioAsset("a-1", { name: "X", description: "d" });
    expect(result).toEqual({ ok: false, error: "Solo Owner y Admin pueden editar audios" });
  });
});

describe("deleteAudioAsset (F20)", () => {
  it("borrado logico: deja deleted_at, no borra la fila", async () => {
    const db = admin({
      audio_assets: [{ id: "a-1", workspace_id: WS, name: "X", description: "d", shortcut: null, storage_path: "p", deleted_at: null }],
    });

    const result = await deleteAudioAsset("a-1");

    expect(result.ok).toBe(true);
    expect(row(db, "a-1").deleted_at).toBeTruthy();
  });

  it("un Member no puede dar de baja", async () => {
    getAdminContext.mockResolvedValue(null);
    expect(await deleteAudioAsset("a-1")).toEqual({ ok: false, error: "Solo Owner y Admin pueden eliminar audios" });
  });
});

describe("correctAudioTranscript (F20)", () => {
  it("corrige a mano: queda transcript_source='manual'", async () => {
    const db = admin({
      audio_assets: [{ id: "a-1", workspace_id: WS, transcript: "mal transcripto", transcript_source: "auto" }],
    });

    const result = await correctAudioTranscript("a-1", "texto correcto");

    expect(result.ok).toBe(true);
    expect(row(db, "a-1")).toMatchObject({ transcript: "texto correcto", transcript_source: "manual", transcript_status: "ready" });
  });

  it("vacio se rechaza", async () => {
    admin({ audio_assets: [{ id: "a-1", workspace_id: WS }] });
    expect(await correctAudioTranscript("a-1", "   ")).toMatchObject({ ok: false });
  });
});

describe("listAudioAssets", () => {
  it("cualquier miembro puede listar (no pasa por getAdminContext)", async () => {
    const db = memoryDb({
      audio_assets: [
        { id: "a-1", workspace_id: WS, name: "X", deleted_at: null },
        { id: "a-2", workspace_id: WS, name: "Y", deleted_at: new Date().toISOString() },
      ],
    });
    getWorkspace.mockResolvedValue({ workspace: { id: WS }, supabase: db.client });

    const result = await listAudioAssets();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("X");
  });
});

describe("requestAudioAssetUpload (F20)", () => {
  const M4A_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]).toString("base64");

  it("firma la subida a chat-media/<ws>/library/<id>.<ext>", async () => {
    const db = admin();
    (db.client as unknown as { storage: unknown }).storage = {
      from: () => ({ createSignedUploadUrl: async () => ({ data: { token: "tok-1" }, error: null }) }),
    };

    const result = await requestAudioAssetUpload({ sizeBytes: 1000, headBase64: M4A_HEAD });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ticket.path).toMatch(new RegExp(`^${WS}/library/[0-9a-f-]+\\.m4a$`));
      expect(result.ticket.mime).toBe("audio/mp4");
    }
  });

  it("un archivo que no es audio se rechaza", async () => {
    admin();
    const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
    const result = await requestAudioAssetUpload({ sizeBytes: 1000, headBase64: jpegHead });
    expect(result).toMatchObject({ ok: false });
  });

  it("un Member no puede subir", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await requestAudioAssetUpload({ sizeBytes: 1000, headBase64: M4A_HEAD });
    expect(result).toEqual({ ok: false, error: "Solo Owner y Admin pueden administrar la banca de audios" });
  });
});
