/**
 * La prueba de publicacion directa en YouTube (F38).
 *
 * Todo simulado: la prueba de verdad sube un video a la cuenta real y solo
 * se aprieta a mano.
 */

import { describe, it, expect, vi } from "vitest";
import type { PublisherEntry } from "@/lib/social/accounts-schema";
import { applyProbe, outcomeFrom, runYouTubeProbe } from "./youtube-probe";
import { probeVideo } from "./probe-asset";

function fakeFetch(...responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; method?: string }> = [];
  const queue = [...responses];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    const next = queue.shift() ?? { status: 500 };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      headers: { get: (k: string) => next.headers?.[k.toLowerCase()] ?? null },
      json: async () => next.body ?? {},
      text: async () => "",
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const video = { sizeBytes: 4, contentType: "video/mp4", read: async () => new ArrayBuffer(4) };

describe("como queda el publicador (F38)", () => {
  it("si el video quedo como se pidio, queda disponible", () => {
    expect(outcomeFrom({ videoId: "yt-1", actualVisibility: "unlisted", cleanedUp: true })).toMatchObject({
      ok: true,
      status: "available",
    });
  });

  it("si YouTube lo dejo privado, queda deshabilitado con el motivo", () => {
    // Es el sintoma de un proyecto de Google sin auditar: sin esta prueba se
    // descubre cuando el cliente pregunta por que no ve el video.
    const outcome = outcomeFrom({ videoId: "yt-1", actualVisibility: "private", cleanedUp: true });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("unavailable");
    expect(outcome.message).toContain("auditoria");
  });

  it("si no se pudo borrar, avisa que hay que borrarlo a mano", () => {
    const outcome = outcomeFrom({ videoId: "yt-1", actualVisibility: "unlisted", cleanedUp: false });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("YouTube Studio");
  });

  it("si la subida fallo, el motivo es el del error", () => {
    expect(outcomeFrom({ videoId: null, cleanedUp: true, actualVisibility: null, error: "Cuota agotada" })).toMatchObject(
      { ok: false, status: "unavailable", message: "Cuota agotada" },
    );
  });
});

describe("escribir el resultado en la cuenta (F38)", () => {
  const entries: PublisherEntry[] = [
    {
      publisher: "youtube_api",
      account_ref: "ch-1",
      status: "unverified",
      status_reason: null,
      verified_at: null,
      manually_enabled: false,
    },
    {
      publisher: "postproxy",
      account_ref: null,
      status: "available",
      status_reason: null,
      verified_at: null,
      manually_enabled: false,
    },
  ];

  it("una prueba buena deja la fecha y limpia el motivo", () => {
    const result = applyProbe(
      entries,
      { ok: true, status: "available", message: "ok", cleanedUp: true, videoId: "y" },
      "2026-10-01T00:00:00Z",
    );

    expect(result[0]).toMatchObject({ status: "available", verified_at: "2026-10-01T00:00:00Z" });
  });

  it("no toca los otros publicadores", () => {
    const result = applyProbe(
      entries,
      { ok: false, status: "unavailable", message: "no", cleanedUp: true, videoId: null },
      "2026-10-01T00:00:00Z",
    );

    expect(result[1]).toEqual(entries[1]);
  });

  it("una prueba fallida no deshace una habilitacion manual", () => {
    // Si alguien decidio usarlo igual, la prueba informa pero no manda.
    const manual = [{ ...entries[0], manually_enabled: true }];
    const result = applyProbe(
      manual,
      { ok: false, status: "unavailable", message: "no", cleanedUp: true, videoId: null },
      "2026-10-01T00:00:00Z",
    );

    expect(result[0].manually_enabled).toBe(true);
  });
});

describe("correr la prueba (F38)", () => {
  it("sube, lee como quedo y borra", async () => {
    const f = fakeFetch(
      { status: 200, headers: { location: "https://upload.test/s" } },
      { status: 200, body: { id: "yt-1" } },
      { status: 200, body: { items: [{ status: { privacyStatus: "unlisted" } }] } },
      { status: 204 },
    );

    const outcome = await runYouTubeProbe({ accessToken: "t", video, fetchImpl: f.impl });

    expect(outcome).toMatchObject({ ok: true, status: "available", cleanedUp: true, videoId: "yt-1" });
    expect(f.calls[3].method).toBe("DELETE");
  });

  it("se pide unlisted, nunca public: la prueba no le aparece a nadie", async () => {
    const f = fakeFetch(
      { status: 200, headers: { location: "https://upload.test/s" } },
      { status: 200, body: { id: "yt-1" } },
      { status: 200, body: { items: [{ status: { privacyStatus: "unlisted" } }] } },
      { status: 204 },
    );

    await runYouTubeProbe({ accessToken: "t", video, fetchImpl: f.impl });

    const body = JSON.parse(
      String(((f.impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body),
    );
    expect(body.status.privacyStatus).toBe("unlisted");
  });

  it("si quedo privado sin pedirlo, lo deshabilita igual y borra el video", async () => {
    const f = fakeFetch(
      { status: 200, headers: { location: "https://upload.test/s" } },
      { status: 200, body: { id: "yt-1" } },
      { status: 200, body: { items: [{ status: { privacyStatus: "private" } }] } },
      { status: 204 },
    );

    const outcome = await runYouTubeProbe({ accessToken: "t", video, fetchImpl: f.impl });

    expect(outcome.ok).toBe(false);
    expect(outcome.cleanedUp).toBe(true);
  });

  it("si falla la subida, no deja nada tirado", async () => {
    const f = fakeFetch({ status: 403, body: {} });

    const outcome = await runYouTubeProbe({ accessToken: "t", video, fetchImpl: f.impl });

    expect(outcome).toMatchObject({ ok: false, videoId: null, cleanedUp: true });
  });
});

describe("el video de prueba (F38)", () => {
  it("esta en el repo y pesa poco", async () => {
    // Si no estuviera, la prueba fallaria por el motivo equivocado.
    const asset = await probeVideo();

    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.sizeBytes).toBeLessThan(100_000);
    expect(asset.contentType).toBe("video/mp4");
  });

  it("se lee por rangos, como cualquier video", async () => {
    const asset = await probeVideo();
    const chunk = await asset.read(0, 3);

    expect(chunk.byteLength).toBe(4);
  });
});
