/**
 * Que pasa cuando la media termino de bajar (F7, F8).
 *
 * La decision que importa: el audio se transcribe EN EL MOMENTO y la imagen se
 * encola. El agente tiene 90 segundos antes de escalar y el cron corre cada
 * minuto: esperar la cola para el audio dejaria la transcripcion siempre al
 * filo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { transcribeMessage } = vi.hoisted(() => ({ transcribeMessage: vi.fn() }));
vi.mock("./transcribe-message", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcribe-message")>();
  return { ...actual, transcribeMessage };
});

const { scheduleJob } = vi.hoisted(() => ({ scheduleJob: vi.fn() }));
vi.mock("@/lib/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduler")>();
  return { ...actual, scheduleJob };
});

import { memoryDb } from "@/lib/agent/testing/memory-db";
import { emptyAttachment } from "@/lib/messages/attachments";
import { afterMediaStored } from "./after-stored";

const MSG = "m-1";
const ready = (kind: Parameters<typeof emptyAttachment>[0]) =>
  emptyAttachment(kind, { status: "ready", storagePath: `ws-1/cv-1/${MSG}-0.bin` });

const client = () => memoryDb({ messages: [], scheduled_jobs: [] }).client;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  transcribeMessage.mockResolvedValue({ kind: "done", text: "hola" });
  scheduleJob.mockResolvedValue({ id: "job-1" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("afterMediaStored (F7, F8)", () => {
  it("una nota de voz se transcribe en el momento, sin pasar por la cola", async () => {
    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("voice")] });

    expect(transcribeMessage).toHaveBeenCalledWith(expect.anything(), MSG, expect.anything());
    expect(scheduleJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ transcribed: true, transcriptionQueued: false });
  });

  it("un audio adjunto (no nota de voz) tambien se transcribe", async () => {
    await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("audio")] });
    expect(transcribeMessage).toHaveBeenCalled();
  });

  it("si el intento inmediato falla por algo transitorio, AHI se encola", async () => {
    transcribeMessage.mockResolvedValue({ kind: "retry", reason: "PROVIDER_DOWN" });

    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("voice")] });

    expect(scheduleJob).toHaveBeenCalledWith(
      expect.anything(),
      "transcribe_audio",
      { messageId: MSG },
      expect.any(Date),
      "transcribe:m-1",
    );
    expect(result).toMatchObject({ transcribed: false, transcriptionQueued: true });
  });

  it("un fallo PERMANENTE no se encola: el motivo ya quedo escrito", async () => {
    transcribeMessage.mockResolvedValue({ kind: "failed", reason: "NO_PROVIDER" });

    await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("voice")] });

    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("si otro camino ya la tomo tampoco se encola", async () => {
    transcribeMessage.mockResolvedValue({ kind: "skipped", reason: "ya la tomo otro" });

    await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("voice")] });

    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("una imagen se ENCOLA para describir: no hay apuro y cuesta una llamada al modelo", async () => {
    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] });

    expect(transcribeMessage).not.toHaveBeenCalled();
    expect(scheduleJob).toHaveBeenCalledWith(
      expect.anything(),
      "describe_media",
      { messageId: MSG },
      expect.any(Date),
      "describe:m-1",
    );
    expect(result.descriptionQueued).toBe(true);
  });

  it("un mensaje con audio Y foto hace las dos cosas", async () => {
    const result = await afterMediaStored({
      supabase: client(),
      messageId: MSG,
      items: [ready("voice"), ready("image")],
    });

    expect(result).toMatchObject({ transcribed: true, descriptionQueued: true });
  });

  it("un video o un documento no disparan nada: no se transcriben en esta fase", async () => {
    await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("video"), ready("document")] });

    expect(transcribeMessage).not.toHaveBeenCalled();
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un adjunto que no llego a bajarse no dispara nada", async () => {
    await afterMediaStored({
      supabase: client(),
      messageId: MSG,
      items: [emptyAttachment("voice", { status: "failed", error: "404" })],
    });

    expect(transcribeMessage).not.toHaveBeenCalled();
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un duplicado de la cola no es un error: ya estaba encolado", async () => {
    scheduleJob.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));

    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] });

    expect(result.descriptionQueued).toBe(false);
  });

  it("NUNCA lanza, ni si la cola explota: corre dentro del after() del webhook", async () => {
    scheduleJob.mockRejectedValue(new Error("la base se cayo"));

    await expect(
      afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] }),
    ).resolves.toMatchObject({ descriptionQueued: false });
  });

  it("sin adjuntos no hace nada", async () => {
    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [] });

    expect(result).toEqual({ transcribed: false, transcriptionQueued: false, descriptionQueued: false });
  });
});
