/**
 * Que pasa cuando la media termino de bajar (F7, F8, FA6).
 *
 * La decision que importa: el audio se transcribe EN EL MOMENTO, y ahora la
 * imagen TAMBIEN se describe en el momento (FA6) -- un flow con el nodo
 * "Respuesta con IA" corre apenas llega el mensaje, antes de que la cola (que
 * corre cada minuto) la hubiera tocado. Si el intento falla por algo
 * transitorio, ahi si se encola, para los dos casos.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { transcribeMessage } = vi.hoisted(() => ({ transcribeMessage: vi.fn() }));
vi.mock("./transcribe-message", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcribe-message")>();
  return { ...actual, transcribeMessage };
});

const { describeMessageMedia } = vi.hoisted(() => ({ describeMessageMedia: vi.fn() }));
vi.mock("@/lib/jobs/handlers/describe-media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs/handlers/describe-media")>();
  return { ...actual, describeMessageMedia };
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
  describeMessageMedia.mockResolvedValue({ kind: "done" });
  scheduleJob.mockResolvedValue({ id: "job-1" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("afterMediaStored: audio (F7)", () => {
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
});

describe("afterMediaStored: imagen (F8, FA6)", () => {
  it("una imagen se describe EN EL MOMENTO, sin pasar por la cola: un flow con IA la necesita ya", async () => {
    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] });

    expect(describeMessageMedia).toHaveBeenCalledWith(expect.anything(), MSG);
    expect(scheduleJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ described: true, descriptionQueued: false });
  });

  it("si el intento inmediato falla por algo transitorio (no bajo el archivo, el modelo fallo), AHI se encola", async () => {
    describeMessageMedia.mockResolvedValue({ kind: "retry", reason: "no pude bajar la imagen" });

    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] });

    expect(scheduleJob).toHaveBeenCalledWith(
      expect.anything(),
      "describe_media",
      { messageId: MSG },
      expect.any(Date),
      "describe:m-1",
    );
    expect(result).toMatchObject({ described: false, descriptionQueued: true });
  });

  it("un fallo PERMANENTE (sin modelo de vision) no se encola: el motivo ya quedo escrito", async () => {
    describeMessageMedia.mockResolvedValue({ kind: "failed", reason: "NO_VISION" });

    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] });

    expect(scheduleJob).not.toHaveBeenCalled();
    expect(result.descriptionQueued).toBe(false);
  });

  it("un sticker o GIF solos (label_only) tampoco se encolan: skipped no mejora reintentando", async () => {
    describeMessageMedia.mockResolvedValue({ kind: "skipped", reason: "sticker o gif: no hace falta describir" });

    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("sticker")] });

    // Un sticker solo no entra a IMAGE_KINDS (FA7): describeMessageMedia ni se
    // llama, porque hasImage ya da false.
    expect(describeMessageMedia).not.toHaveBeenCalled();
    expect(scheduleJob).not.toHaveBeenCalled();
    expect(result.descriptionQueued).toBe(false);
  });

  it("un duplicado de la cola no es un error: ya estaba encolado", async () => {
    describeMessageMedia.mockResolvedValue({ kind: "retry", reason: "no pude bajar la imagen" });
    scheduleJob.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));

    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] });

    expect(result.descriptionQueued).toBe(false);
  });

  it("NUNCA lanza, ni si la cola explota en el reintento: corre dentro del after() del webhook", async () => {
    describeMessageMedia.mockResolvedValue({ kind: "retry", reason: "no pude bajar la imagen" });
    scheduleJob.mockRejectedValue(new Error("la base se cayo"));

    await expect(
      afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("image")] }),
    ).resolves.toMatchObject({ descriptionQueued: false });
  });
});

describe("afterMediaStored: combinados y casos borde", () => {
  it("un mensaje con audio Y foto hace las dos cosas, las dos EN EL MOMENTO", async () => {
    const result = await afterMediaStored({
      supabase: client(),
      messageId: MSG,
      items: [ready("voice"), ready("image")],
    });

    expect(result).toMatchObject({ transcribed: true, described: true });
  });

  it("un video o un documento no disparan nada: no se transcriben ni describen en esta fase", async () => {
    await afterMediaStored({ supabase: client(), messageId: MSG, items: [ready("video"), ready("document")] });

    expect(transcribeMessage).not.toHaveBeenCalled();
    expect(describeMessageMedia).not.toHaveBeenCalled();
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

  it("sin adjuntos no hace nada", async () => {
    const result = await afterMediaStored({ supabase: client(), messageId: MSG, items: [] });

    expect(result).toEqual({ transcribed: false, transcriptionQueued: false, described: false, descriptionQueued: false });
  });
});
