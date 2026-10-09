/**
 * Cuando se transcribe un audio de la banca de recursos: en el momento, sin
 * hacer esperar a quien guarda, y con la cola solo como respaldo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { transcribeAsset, scheduleJob, after } = vi.hoisted(() => ({
  transcribeAsset: vi.fn(),
  scheduleJob: vi.fn(async () => ({ id: "job-1" })),
  after: vi.fn(),
}));

vi.mock("./transcribe", () => ({ transcribeAsset }));
vi.mock("@/lib/scheduler", () => ({ scheduleJob }));
vi.mock("next/server", () => ({ after }));

import { enqueueAssetTranscription, transcribeAssetNow, transcribeAssetSoon } from "./transcribe-now";

const db = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Por defecto, `after` ejecuta el callback ahi mismo, como lo haria despues de responder.
  after.mockImplementation((fn: () => Promise<void>) => fn());
});

describe("transcribeAssetNow", () => {
  it("lista: no encola nada", async () => {
    transcribeAsset.mockResolvedValue({ kind: "done", text: "hola" });
    expect(await transcribeAssetNow(db, "a-1")).toEqual({ kind: "done", text: "hola" });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("fallo transitorio (retry): encola con su clave de dedupe", async () => {
    transcribeAsset.mockResolvedValue({ kind: "retry", reason: "429" });
    await transcribeAssetNow(db, "a-1");
    expect(scheduleJob).toHaveBeenCalledWith(db, "transcribe_audio", { assetId: "a-1" }, expect.any(Date), "transcribe-asset:a-1");
  });

  it("fallo permanente o ya tomada: no encola (reintentar no lo arregla)", async () => {
    transcribeAsset.mockResolvedValue({ kind: "failed", reason: "formato no soportado" });
    await transcribeAssetNow(db, "a-1");
    transcribeAsset.mockResolvedValue({ kind: "skipped", reason: "ya lo tomo otro" });
    await transcribeAssetNow(db, "a-1");
    expect(scheduleJob).not.toHaveBeenCalled();
  });
});

describe("transcribeAssetSoon", () => {
  it("transcribe dentro del after(), no antes", async () => {
    transcribeAsset.mockResolvedValue({ kind: "done", text: "hola" });
    let scheduled: (() => Promise<void>) | null = null;
    after.mockImplementation((fn: () => Promise<void>) => {
      scheduled = fn;
    });

    await transcribeAssetSoon(db, "a-1");

    expect(transcribeAsset).not.toHaveBeenCalled();
    expect(scheduleJob).not.toHaveBeenCalled();

    await scheduled!();
    expect(transcribeAsset).toHaveBeenCalledWith(db, "a-1");
  });

  it("si lo de adentro revienta, cae al respaldo: encola", async () => {
    transcribeAsset.mockRejectedValue(new Error("boom"));
    let scheduled: (() => Promise<void>) | null = null;
    after.mockImplementation((fn: () => Promise<void>) => {
      scheduled = fn;
    });

    await transcribeAssetSoon(db, "a-1");
    await scheduled!();

    expect(scheduleJob).toHaveBeenCalledTimes(1);
  });

  it("sin un request en curso (after() lanza), cae al respaldo de antes: encola", async () => {
    after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    await transcribeAssetSoon(db, "a-1");
    expect(transcribeAsset).not.toHaveBeenCalled();
    expect(scheduleJob).toHaveBeenCalledWith(db, "transcribe_audio", { assetId: "a-1" }, expect.any(Date), "transcribe-asset:a-1");
  });
});

describe("enqueueAssetTranscription", () => {
  it("un duplicado (23505) no es un error: ya estaba encolada", async () => {
    scheduleJob.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    await expect(enqueueAssetTranscription(db, "a-1")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("cualquier otro error se loguea pero no lanza", async () => {
    scheduleJob.mockRejectedValueOnce(new Error("sin conexion"));
    await expect(enqueueAssetTranscription(db, "a-1")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
