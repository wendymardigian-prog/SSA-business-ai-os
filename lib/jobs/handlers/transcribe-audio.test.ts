/**
 * El job de transcripcion (F7).
 *
 * Lo central es el CLAIM CONDICIONAL: si otro camino ya tomo la fila, este no
 * llama al proveedor. Sin eso un audio se transcribiria dos veces y se cobraria
 * dos veces.
 *
 * Y la regla del handler: transitorio LANZA (la cola reintenta con backoff),
 * permanente RETORNA (el motivo ya quedo en la fila y gastar los tres intentos
 * no lo arregla).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { transcribeAudio } = vi.hoisted(() => ({ transcribeAudio: vi.fn() }));
vi.mock("@/lib/ai/transcribe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/transcribe")>();
  return { ...actual, transcribeAudio };
});

import { memoryDb } from "@/lib/agent/testing/memory-db";
import { emptyAttachment } from "@/lib/messages/attachments";
import { registerJobHandler, getJobHandler, resetJobHandlers } from "@/lib/jobs/registry";
import { reapStuckTranscriptions, transcribeMessage } from "@/lib/chat-media/transcribe-message";
import { TRANSCRIBE_AUDIO_JOB, registerTranscribeAudioHandler, transcribeDedupeKey, transcribeAssetDedupeKey } from "./transcribe-audio";

const WS = "ws-1";
const CV = "cv-1";
const MSG = "m-1";
const NOW = new Date("2026-09-28T12:00:00.000Z");

/** Una fila de mensaje con una nota de voz ya guardada. */
function messageRow(over: Record<string, unknown> = {}) {
  return {
    id: MSG,
    conversation_id: CV,
    workspace_id: WS,
    text: null,
    created_at: NOW.toISOString(),
    transcript: null,
    transcript_status: "none",
    transcript_error: null,
    transcript_seconds: null,
    transcript_started_at: null,
    interpretability: "unknown",
    attachments: {
      v: 2,
      items: [
        emptyAttachment("voice", {
          status: "ready",
          storagePath: `${WS}/${CV}/${MSG}-0.ogg`,
          mime: "audio/ogg",
          durationSeconds: 12,
        }),
      ],
    },
    ...over,
  };
}

function db(rows = [messageRow()], options: { downloadError?: boolean } = {}) {
  const memory = memoryDb({ messages: rows, conversations: [{ id: CV, last_message_preview: "🎤 Nota de voz" }], agent_runs: [] }, { now: () => NOW });
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      download: async () =>
        options.downloadError
          ? { data: null, error: { message: "Object not found" } }
          : { data: new Blob([new Uint8Array([0x4f, 0x67, 0x67, 0x53])]), error: null },
    }),
  };
  return memory;
}

const row = (memory: ReturnType<typeof memoryDb>, id = MSG) => memory.rows("messages").find((m) => m.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  transcribeAudio.mockResolvedValue({
    ok: true,
    text: "hola, queria saber el precio",
    durationSeconds: 12,
    provider: "groq",
    model: "whisper-large-v3-turbo",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transcribeMessage: el claim (F7)", () => {
  it("toma la fila, transcribe y guarda el texto con su duracion", async () => {
    const memory = db();

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toEqual({ kind: "done", text: "hola, queria saber el precio" });
    expect(row(memory)).toMatchObject({
      transcript: "hola, queria saber el precio",
      transcript_status: "ready",
      transcript_seconds: 12,
      transcript_error: null,
      // El mensaje pasa a ser interpretable por su transcripcion.
      interpretability: "transcribed",
    });
  });

  it("un mensaje CON caption conserva interpretability 'text': lo que escribio la persona gana", async () => {
    const memory = db([messageRow({ text: "escuchá esto" })]);

    await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(row(memory)).toMatchObject({ transcript_status: "ready", interpretability: "text" });
  });

  it("si otro camino ya la tomo, NO se llama al proveedor", async () => {
    // pending es justo el estado que deja el otro camino al reclamarla.
    const memory = db([messageRow({ transcript_status: "pending" })]);

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toMatchObject({ kind: "skipped" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("una que ya esta lista tampoco se vuelve a transcribir: no se cobra dos veces", async () => {
    const memory = db([messageRow({ transcript_status: "ready", transcript: "ya estaba" })]);

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toMatchObject({ kind: "skipped" });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(row(memory).transcript).toBe("ya estaba");
  });

  it("una que fallo SI se puede retomar: es el reintento manual", async () => {
    const memory = db([messageRow({ transcript_status: "failed", transcript_error: "algo salio mal" })]);

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toMatchObject({ kind: "done" });
    expect(row(memory).transcript_status).toBe("ready");
  });

  it("deja transcript_started_at al reclamar: es lo que mira el reaper", async () => {
    const memory = db();
    transcribeAudio.mockResolvedValue({ ok: false, code: "PROVIDER_DOWN", message: "caido", retryable: true });

    await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(row(memory).transcript_started_at).toBe(NOW.toISOString());
  });
});

describe("transcribeMessage: lo que sale mal (F7)", () => {
  it("un fallo TRANSITORIO devuelve retry y deja la fila reintentable", async () => {
    const memory = db();
    transcribeAudio.mockResolvedValue({ ok: false, code: "RATE_LIMITED", message: "saturado", retryable: true });

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toMatchObject({ kind: "retry" });
    // Vuelve a `failed` y no queda en `pending`: si quedara pending, el
    // reintento se saltearia solo hasta que lo libere el reaper.
    expect(row(memory)).toMatchObject({ transcript_status: "failed", transcript_error: "saturado" });
  });

  it("un fallo PERMANENTE deja el motivo y marca el mensaje como no interpretable", async () => {
    const memory = db();
    transcribeAudio.mockResolvedValue({
      ok: false,
      code: "NO_PROVIDER",
      message: "No hay ningún servicio de transcripción conectado.",
      retryable: false,
    });

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toMatchObject({ kind: "failed" });
    expect(row(memory)).toMatchObject({
      transcript_status: "failed",
      transcript_error: "No hay ningún servicio de transcripción conectado.",
      // Y esto es lo que hace que el agente escale en vez de responder a ciegas.
      interpretability: "unreadable",
    });
  });

  it("si no se puede bajar el archivo, se reintenta", async () => {
    const memory = db([messageRow()], { downloadError: true });

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toMatchObject({ kind: "retry" });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(row(memory).transcript_status).toBe("failed");
  });

  it("un mensaje sin audio listo no se intenta transcribir", async () => {
    const memory = db([
      messageRow({ attachments: { v: 2, items: [emptyAttachment("voice", { status: "pending" })] } }),
    ]);

    const result = await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(result).toMatchObject({ kind: "failed" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("un mensaje que no existe no rompe nada", async () => {
    const memory = db([]);
    await expect(transcribeMessage(memory.client, "no-existe", { now: () => NOW })).resolves.toMatchObject({
      kind: "skipped",
    });
  });
});

describe("el preview de la lista (F15)", () => {
  it("con la transcripcion lista, la lista muestra lo que se dijo", async () => {
    const memory = db();

    await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(memory.rows("conversations")[0].last_message_preview).toBe("hola, queria saber el precio");
  });

  it("si llego otro mensaje despues, NO se pisa el preview con algo viejo", async () => {
    const memory = db([
      messageRow(),
      { ...messageRow({ id: "m-2", text: "y otra cosa" }), created_at: "2026-09-28T12:05:00.000Z" },
    ]);

    await transcribeMessage(memory.client, MSG, { now: () => NOW });

    expect(memory.rows("conversations")[0].last_message_preview).toBe("🎤 Nota de voz");
  });
});

describe("el reaper de las transcripciones colgadas (F7)", () => {
  it("un pending de mas de diez minutos vuelve a failed y queda reintentable", async () => {
    const memory = db([
      messageRow({
        transcript_status: "pending",
        transcript_started_at: new Date(NOW.getTime() - 11 * 60_000).toISOString(),
      }),
    ]);

    const result = await reapStuckTranscriptions(memory.client, NOW);

    expect(result.freed).toBe(1);
    expect(row(memory)).toMatchObject({ transcript_status: "failed" });
    expect(row(memory).transcript_error).toContain("Reintentar");
  });

  it("uno reciente NO se toca: todavia puede estar corriendo", async () => {
    const memory = db([
      messageRow({
        transcript_status: "pending",
        transcript_started_at: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
      }),
    ]);

    await expect(reapStuckTranscriptions(memory.client, NOW)).resolves.toEqual({ freed: 0 });
    expect(row(memory).transcript_status).toBe("pending");
  });

  it("no toca los que ya estan listos ni los que fallaron", async () => {
    const memory = db([
      messageRow({ transcript_status: "ready" }),
      { ...messageRow({ id: "m-2", transcript_status: "failed" }) },
    ]);

    await expect(reapStuckTranscriptions(memory.client, NOW)).resolves.toEqual({ freed: 0 });
  });
});

describe("el handler del job (F7)", () => {
  beforeEach(() => {
    resetJobHandlers();
    registerTranscribeAudioHandler();
  });

  it("se registra con registerJobHandler, no con un case en el switch", () => {
    expect(getJobHandler(TRANSCRIBE_AUDIO_JOB)).toBeTypeOf("function");
  });

  it("un fallo transitorio LANZA para que la cola reintente con su backoff", async () => {
    const memory = db();
    transcribeAudio.mockResolvedValue({ ok: false, code: "PROVIDER_DOWN", message: "caido", retryable: true });
    const handler = getJobHandler(TRANSCRIBE_AUDIO_JOB)!;

    await expect(
      handler({ supabase: memory.client, job: { id: "j-1", type: TRANSCRIBE_AUDIO_JOB, payload: { messageId: MSG }, attempts: 0 } }),
    ).rejects.toThrow(/no pude transcribir/);
  });

  it("un fallo permanente NO lanza: gastar los tres intentos no lo arregla", async () => {
    const memory = db();
    transcribeAudio.mockResolvedValue({ ok: false, code: "NO_PROVIDER", message: "sin clave", retryable: false });
    const handler = getJobHandler(TRANSCRIBE_AUDIO_JOB)!;

    await expect(
      handler({ supabase: memory.client, job: { id: "j-1", type: TRANSCRIBE_AUDIO_JOB, payload: { messageId: MSG }, attempts: 0 } }),
    ).resolves.toBeUndefined();
  });

  it("un job sin messageId no lanza: reintentar no lo va a inventar", async () => {
    const memory = db();
    const handler = getJobHandler(TRANSCRIBE_AUDIO_JOB)!;

    await expect(
      handler({ supabase: memory.client, job: { id: "j-1", type: TRANSCRIBE_AUDIO_JOB, payload: {}, attempts: 0 } }),
    ).resolves.toBeUndefined();
  });

  it("la clave de dedupe es una por mensaje", () => {
    expect(transcribeDedupeKey("m-1")).toBe("transcribe:m-1");
    expect(transcribeDedupeKey("m-1")).not.toBe(transcribeDedupeKey("m-2"));
  });

  it("con assetId en el payload, transcribe la banca y no un mensaje", async () => {
    const memory = memoryDb({
      response_assets: [
        {
          id: "audio-1",
          workspace_id: WS,
          kind: "audio",
          storage_path: `${WS}/library/audio-1.m4a`,
          mime_type: "audio/mp4",
          transcript_status: "none",
          transcript_source: "auto",
        },
      ],
    });
    (memory.client as unknown as { storage: unknown }).storage = {
      from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3, 4])]), error: null }) }),
    };
    const handler = getJobHandler(TRANSCRIBE_AUDIO_JOB)!;

    await expect(
      handler({ supabase: memory.client, job: { id: "j-1", type: TRANSCRIBE_AUDIO_JOB, payload: { assetId: "audio-1" }, attempts: 0 } }),
    ).resolves.toBeUndefined();

    expect(memory.rows("response_assets")[0]).toMatchObject({ transcript_status: "ready" });
  });

  it("con assetId de un recurso kind='text', no transcribe nada y no lanza", async () => {
    const memory = memoryDb({
      response_assets: [
        {
          id: "text-1",
          workspace_id: WS,
          kind: "text",
          content: "Hola",
          transcript_status: "none",
          transcript_source: "auto",
        },
      ],
    });
    const handler = getJobHandler(TRANSCRIBE_AUDIO_JOB)!;

    await expect(
      handler({ supabase: memory.client, job: { id: "j-1", type: TRANSCRIBE_AUDIO_JOB, payload: { assetId: "text-1" }, attempts: 0 } }),
    ).resolves.toBeUndefined();

    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(memory.rows("response_assets")[0].transcript_status).toBe("none");
  });

  it("la clave de dedupe de la banca es distinta de la de un mensaje", () => {
    expect(transcribeAssetDedupeKey("audio-1")).toBe("transcribe-asset:audio-1");
  });
});
