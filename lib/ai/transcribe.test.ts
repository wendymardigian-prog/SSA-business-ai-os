/**
 * Pasar un audio a texto (F6).
 *
 * Nunca se llama a un proveedor de verdad: todo pasa por un `fetch` simulado.
 * Lo que se prueba es lo que decide: cuando se cae al respaldo, cuando NO, y que
 * la extension del archivo se reconstruya del mime (el 400 clasico).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { readSecret } = vi.hoisted(() => ({ readSecret: vi.fn() }));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret };
});

import { memoryDb } from "@/lib/agent/testing/memory-db";
import { audioFilenameForMime, isTranscribableMime, transcribeAudio } from "./transcribe";

const WS = "ws-1";
const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // "OggS"

/** Base con las integraciones que se le pidan. */
function db(providers: Array<{ provider: string; config?: Record<string, unknown> }>) {
  return memoryDb({
    integration_configs: providers.map((p, i) => ({
      id: `ic-${i}`,
      workspace_id: WS,
      type: "ai_provider",
      provider: p.provider,
      is_active: true,
      vault_secret_name: `${p.provider}_api_key`,
      config: p.config ?? {},
    })),
    agent_runs: [],
    model_pricing: [],
  });
}

/** Una cola de respuestas del proveedor; cada llamada consume la siguiente. */
function queue(responses: Array<{ status?: number; body?: unknown; throws?: boolean }>) {
  const calls: Array<{ url: string; auth: string | undefined; form: FormData }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), auth: headers.authorization, form: init.body as FormData });
    const next = responses.shift() ?? { status: 200, body: { text: "ok" } };
    if (next.throws) throw new Error("ECONNRESET");
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body ?? {},
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  readSecret.mockImplementation(async (_db: unknown, _ws: string, name: string) => `key-de-${name}`);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transcribeAudio: el camino feliz (F6)", () => {
  it("transcribe con Groq y devuelve el texto, la duracion y el proveedor", async () => {
    const memory = db([{ provider: "groq" }]);
    const { impl, calls } = queue([{ body: { text: "hola, queria saber el precio", duration: 3.5 } }]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg; codecs=opus",
      fetchImpl: impl,
    });

    expect(result).toEqual({
      ok: true,
      text: "hola, queria saber el precio",
      durationSeconds: 3.5,
      provider: "groq",
      model: "whisper-large-v3-turbo",
    });
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(calls[0].auth).toBe("Bearer key-de-groq_api_key");
  });

  it("pide el idioma español y la duracion, que es lo que cobra el proveedor", async () => {
    const memory = db([{ provider: "groq" }]);
    const { impl, calls } = queue([{ body: { text: "hola", duration: 1 } }]);

    await transcribeAudio({ supabase: memory.client, workspaceId: WS, bytes: AUDIO, mime: "audio/ogg", fetchImpl: impl });

    expect(calls[0].form.get("language")).toBe("es");
    expect(calls[0].form.get("response_format")).toBe("verbose_json");
    expect(calls[0].form.get("model")).toBe("whisper-large-v3-turbo");
  });

  it("respeta el modelo elegido en la integracion", async () => {
    const memory = db([{ provider: "groq", config: { transcription_model: "whisper-large-v3" } }]);
    const { impl, calls } = queue([{ body: { text: "hola", duration: 1 } }]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(calls[0].form.get("model")).toBe("whisper-large-v3");
    expect(result).toMatchObject({ ok: true, model: "whisper-large-v3" });
  });

  it("el nombre del archivo se reconstruye DESDE EL MIME, no del original", async () => {
    // WhatsApp manda nombres inventados y el proveedor decide por la extension:
    // si no coincide con los bytes devuelve 400.
    const memory = db([{ provider: "groq" }]);
    const { impl, calls } = queue([{ body: { text: "hola", duration: 1 } }]);

    await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg; codecs=opus",
      fetchImpl: impl,
    });

    expect((calls[0].form.get("file") as File).name).toBe("audio.ogg");
  });

  it("registra el consumo en segundos de audio, sin guardar el texto", async () => {
    const memory = db([{ provider: "groq" }]);
    const { impl } = queue([{ body: { text: "el contenido del lead", duration: 40 } }]);

    await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      threadId: "m-1",
      fetchImpl: impl,
    });

    const [run] = memory.rows("agent_runs");
    expect(run).toMatchObject({ source: "audio_transcription", provider: "groq", thread_id: "m-1" });
    // El texto es contenido del lead: no entra al run.
    expect(JSON.stringify(run)).not.toContain("el contenido del lead");
  });
});

describe("transcribeAudio: el respaldo (F6)", () => {
  it("un 429 de Groq cae a OpenAI y lo dice en el resultado", async () => {
    const memory = db([{ provider: "groq" }, { provider: "openai" }]);
    const { impl, calls } = queue([
      { status: 429, body: { error: "rate limit" } },
      { body: { text: "transcripto por el respaldo", duration: 2 } },
    ]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ ok: true, provider: "openai", model: "whisper-1" });
    expect(calls[1].url).toBe("https://api.openai.com/v1/audio/transcriptions");
    // Con la clave de OpenAI que el workspace ya tenia, no una nueva.
    expect(calls[1].auth).toBe("Bearer key-de-openai_api_key");
  });

  it("un 5xx y una caida de red tambien caen al respaldo", async () => {
    for (const first of [{ status: 503, body: {} }, { throws: true }]) {
      const memory = db([{ provider: "groq" }, { provider: "openai" }]);
      const { impl } = queue([first, { body: { text: "ok", duration: 1 } }]);

      await expect(
        transcribeAudio({ supabase: memory.client, workspaceId: WS, bytes: AUDIO, mime: "audio/ogg", fetchImpl: impl }),
      ).resolves.toMatchObject({ ok: true, provider: "openai" });
    }
  });

  it("una key RECHAZADA no cae al respaldo: probar de nuevo daria el mismo error", async () => {
    const memory = db([{ provider: "groq" }, { provider: "openai" }]);
    const { impl, calls } = queue([{ status: 401, body: {} }, { body: { text: "no deberia llegar" } }]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ ok: false, code: "REJECTED_KEY", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("un audio que el proveedor no puede abrir tampoco cae al respaldo", async () => {
    const memory = db([{ provider: "groq" }, { provider: "openai" }]);
    const { impl, calls } = queue([{ status: 400, body: {} }]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ ok: false, code: "INVALID_AUDIO", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("si los dos fallan devuelve el ultimo motivo, marcado como reintentable", async () => {
    const memory = db([{ provider: "groq" }, { provider: "openai" }]);
    const { impl } = queue([{ status: 503, body: {} }, { status: 503, body: {} }]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ ok: false, code: "PROVIDER_DOWN", retryable: true });
  });
});

describe("transcribeAudio: lo que no se intenta (F6)", () => {
  it("sin ninguna clave configurada devuelve NO_PROVIDER y no reintenta", async () => {
    const memory = db([]);
    const { impl, calls } = queue([]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ ok: false, code: "NO_PROVIDER", retryable: false });
    expect(calls).toHaveLength(0);
    // Y el mensaje dice donde se arregla.
    expect(result.ok === false && result.message).toContain("Ajustes");
  });

  it("un audio de mas de 25 MB no se manda: el 413 es un error conocido", async () => {
    const memory = db([{ provider: "groq" }]);
    const { impl, calls } = queue([]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: new Uint8Array(26 * 1024 * 1024),
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ ok: false, code: "FILE_TOO_LARGE", retryable: false });
    expect(calls).toHaveLength(0);
  });

  it("un archivo vacio tampoco", async () => {
    const memory = db([{ provider: "groq" }]);
    const { impl, calls } = queue([]);

    await expect(
      transcribeAudio({ supabase: memory.client, workspaceId: WS, bytes: new Uint8Array(0), mime: "audio/ogg", fetchImpl: impl }),
    ).resolves.toMatchObject({ ok: false, code: "EMPTY_AUDIO" });
    expect(calls).toHaveLength(0);
  });

  it("un audio sin palabras no es un fallo del sistema, pero no hay nada que leer", async () => {
    const memory = db([{ provider: "groq" }]);
    const { impl } = queue([{ body: { text: "   ", duration: 1 } }]);

    await expect(
      transcribeAudio({ supabase: memory.client, workspaceId: WS, bytes: AUDIO, mime: "audio/ogg", fetchImpl: impl }),
    ).resolves.toMatchObject({ ok: false, code: "EMPTY_AUDIO", retryable: false });
  });

  it("si no se puede leer la clave del Vault, ese proveedor se saltea", async () => {
    const memory = db([{ provider: "groq" }, { provider: "openai" }]);
    readSecret.mockImplementation(async (_db: unknown, _ws: string, name: string) => {
      if (name === "groq_api_key") throw new Error("forbidden");
      return "key-de-openai";
    });
    const { impl, calls } = queue([{ body: { text: "ok", duration: 1 } }]);

    const result = await transcribeAudio({
      supabase: memory.client,
      workspaceId: WS,
      bytes: AUDIO,
      mime: "audio/ogg",
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ ok: true, provider: "openai" });
    expect(calls).toHaveLength(1);
  });

  it("NUNCA lanza, incluso si el proveedor devuelve algo que no es JSON", async () => {
    const memory = db([{ provider: "groq" }]);
    const impl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("no es json");
      },
    })) as unknown as typeof fetch;

    await expect(
      transcribeAudio({ supabase: memory.client, workspaceId: WS, bytes: AUDIO, mime: "audio/ogg", fetchImpl: impl }),
    ).resolves.toMatchObject({ ok: false, code: "UNKNOWN" });
  });
});

describe("la extension desde el mime (F6)", () => {
  it("cada formato que llega de verdad tiene su extension", () => {
    expect(audioFilenameForMime("audio/ogg; codecs=opus")).toBe("audio.ogg");
    expect(audioFilenameForMime("audio/opus")).toBe("audio.ogg");
    expect(audioFilenameForMime("audio/mp4")).toBe("audio.m4a");
    expect(audioFilenameForMime("audio/x-m4a")).toBe("audio.m4a");
    expect(audioFilenameForMime("audio/webm")).toBe("audio.webm");
    expect(audioFilenameForMime("audio/mpeg")).toBe("audio.mp3");
    expect(audioFilenameForMime("audio/wav")).toBe("audio.wav");
  });

  it("lo desconocido cae en m4a, que es el que mas aceptan", () => {
    expect(audioFilenameForMime("audio/loquesea")).toBe("audio.m4a");
    expect(audioFilenameForMime(null)).toBe("audio.m4a");
    expect(audioFilenameForMime("")).toBe("audio.m4a");
  });

  it("solo los audios se transcriben", () => {
    expect(isTranscribableMime("audio/ogg")).toBe(true);
    expect(isTranscribableMime("video/mp4")).toBe(false);
    expect(isTranscribableMime("image/jpeg")).toBe(false);
    expect(isTranscribableMime(null)).toBe(false);
  });
});
