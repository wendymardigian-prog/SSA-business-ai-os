/**
 * Transcribir un audio de la banca (F20).
 *
 * Mismo criterio que F7 (lib/chat-media/transcribe-message.test.ts): el claim
 * condicional evita transcribir dos veces. La diferencia: una correccion
 * manual (transcript_source='manual') no la pisa ningun reintento.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { transcribeAudio } = vi.hoisted(() => ({ transcribeAudio: vi.fn() }));
vi.mock("@/lib/ai/transcribe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/transcribe")>();
  return { ...actual, transcribeAudio };
});

import { memoryDb } from "@/lib/agent/testing/memory-db";
import { transcribeAudioAsset, reapStuckAudioAssetTranscriptions } from "./transcribe";

const WS = "ws-1";
const ASSET = "audio-1";
const NOW = new Date("2026-10-01T12:00:00.000Z");

function assetRow(over: Record<string, unknown> = {}) {
  return {
    id: ASSET,
    workspace_id: WS,
    name: "Precio",
    shortcut: "/precio",
    description: "Cuando preguntan el precio",
    storage_path: `${WS}/library/${ASSET}.m4a`,
    mime_type: "audio/mp4",
    duration_seconds: 8,
    transcript: null,
    transcript_status: "none",
    transcript_error: null,
    transcript_source: "auto",
    transcript_started_at: null,
    source: "recorded",
    agent_enabled: false,
    is_active: true,
    ...over,
  };
}

function db(rows = [assetRow()], options: { downloadError?: boolean } = {}) {
  const memory = memoryDb({ audio_assets: rows }, { now: () => NOW });
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      download: async () =>
        options.downloadError
          ? { data: null, error: { message: "not found" } }
          : { data: new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])]), error: null },
    }),
  };
  return memory;
}

const row = (memory: ReturnType<typeof memoryDb>) => memory.rows("audio_assets")[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  transcribeAudio.mockResolvedValue({ ok: true, text: "Cuesta tanto por mes", durationSeconds: 8, provider: "groq", model: "whisper" });
});

afterEach(() => vi.restoreAllMocks());

describe("transcribeAudioAsset: el claim (F20)", () => {
  it("toma la fila, transcribe y guarda", async () => {
    const memory = db();
    const result = await transcribeAudioAsset(memory.client, ASSET, { now: () => NOW });

    expect(result).toEqual({ kind: "done", text: "Cuesta tanto por mes" });
    expect(row(memory)).toMatchObject({ transcript: "Cuesta tanto por mes", transcript_status: "ready", transcript_source: "auto" });
  });

  it("una correccion MANUAL no se vuelve a transcribir, aunque este en 'failed'", async () => {
    const memory = db([assetRow({ transcript_status: "failed", transcript_source: "manual", transcript: "lo corregi a mano" })]);

    const result = await transcribeAudioAsset(memory.client, ASSET, { now: () => NOW });

    expect(result).toMatchObject({ kind: "skipped" });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(row(memory).transcript).toBe("lo corregi a mano");
  });

  it("si otro camino ya la tomo (pending), no se llama al proveedor", async () => {
    const memory = db([assetRow({ transcript_status: "pending" })]);
    const result = await transcribeAudioAsset(memory.client, ASSET, { now: () => NOW });
    expect(result).toMatchObject({ kind: "skipped" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("una que fallo por algo transitorio SI se puede retomar", async () => {
    const memory = db([assetRow({ transcript_status: "failed", transcript_source: "auto" })]);
    const result = await transcribeAudioAsset(memory.client, ASSET, { now: () => NOW });
    expect(result).toMatchObject({ kind: "done" });
  });
});

describe("transcribeAudioAsset: lo que sale mal (F20)", () => {
  it("un fallo transitorio deja la fila reintentable, no en pending", async () => {
    const memory = db();
    transcribeAudio.mockResolvedValue({ ok: false, code: "RATE_LIMITED", message: "saturado", retryable: true });

    const result = await transcribeAudioAsset(memory.client, ASSET, { now: () => NOW });

    expect(result).toMatchObject({ kind: "retry" });
    expect(row(memory)).toMatchObject({ transcript_status: "failed", transcript_error: "saturado" });
  });

  it("un fallo permanente deja el motivo escrito", async () => {
    const memory = db();
    transcribeAudio.mockResolvedValue({ ok: false, code: "NO_PROVIDER", message: "sin clave", retryable: false });

    const result = await transcribeAudioAsset(memory.client, ASSET, { now: () => NOW });

    expect(result).toMatchObject({ kind: "failed" });
    expect(row(memory)).toMatchObject({ transcript_status: "failed", transcript_error: "sin clave" });
  });

  it("si no se puede bajar el archivo, se reintenta", async () => {
    const memory = db([assetRow()], { downloadError: true });
    const result = await transcribeAudioAsset(memory.client, ASSET, { now: () => NOW });
    expect(result).toMatchObject({ kind: "retry" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});

describe("reapStuckAudioAssetTranscriptions (F20)", () => {
  it("un pending de mas de diez minutos vuelve a failed", async () => {
    const memory = db([assetRow({ transcript_status: "pending", transcript_started_at: new Date(NOW.getTime() - 11 * 60_000).toISOString() })]);

    const result = await reapStuckAudioAssetTranscriptions(memory.client, NOW);

    expect(result.freed).toBe(1);
    expect(row(memory).transcript_status).toBe("failed");
  });

  it("uno reciente no se toca", async () => {
    const memory = db([assetRow({ transcript_status: "pending", transcript_started_at: new Date(NOW.getTime() - 2 * 60_000).toISOString() })]);
    await expect(reapStuckAudioAssetTranscriptions(memory.client, NOW)).resolves.toEqual({ freed: 0 });
  });
});
