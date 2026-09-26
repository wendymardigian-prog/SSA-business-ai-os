/**
 * El enchufado de publicadores y handlers (F30, F35).
 *
 * Un publicador que nadie registro es una publicacion que falla en
 * produccion y anda en los tests. Esto lo detecta acá.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUBLISHER_IDS } from "@/lib/social/accounts-schema";
import { CONTENT_PUBLISH_JOB, CONTENT_PUBLISH_CHECK_JOB } from "@/lib/content/jobs";
import { METRICS_SYNC_JOB } from "@/lib/jobs/handlers/metrics-sync";
import { getJobHandler, resetJobHandlers } from "@/lib/jobs/registry";
import { hasPublisher, publishersFor, resetPublishers } from "./registry";
import { registerPublishing, resetPublishingBootstrap, signedUrlReader } from "./bootstrap";

beforeEach(() => {
  resetPublishers();
  resetJobHandlers();
  resetPublishingBootstrap();
});

describe("registro de publicadores (F30)", () => {
  it("estan los cinco caminos de publicacion", () => {
    registerPublishing();

    for (const id of PUBLISHER_IDS) {
      expect(hasPublisher(id), `falta el publicador ${id}`).toBe(true);
    }
  });

  it("cada red tiene al menos por donde salir", () => {
    registerPublishing();

    for (const platform of ["instagram", "tiktok", "youtube", "linkedin", "threads"]) {
      expect(publishersFor(platform).length, `${platform} no tiene publicador`).toBeGreaterThan(0);
    }
  });

  it("YouTube tiene dos caminos: Postproxy y la API oficial", () => {
    registerPublishing();

    expect(publishersFor("youtube").map((p) => p.id).sort()).toEqual(["postproxy", "youtube_api"]);
  });

  it("los jobs de contenido tienen quien los ejecute", () => {
    registerPublishing();

    expect(getJobHandler(CONTENT_PUBLISH_JOB)).toBeTypeOf("function");
    expect(getJobHandler(CONTENT_PUBLISH_CHECK_JOB)).toBeTypeOf("function");
  });

  it("la recoleccion de metricas tiene quien la ejecute", () => {
    registerPublishing();

    expect(getJobHandler(METRICS_SYNC_JOB)).toBeTypeOf("function");
  });

  it("bg_task sigue sin hacer nada, pero con handler propio", async () => {
    // Sin handler explicito caeria en "tipo desconocido" y pasaria a fallido,
    // y se encola solo: la lista de jobs se llenaria de rojo por nada.
    registerPublishing();
    const handler = getJobHandler("bg_task");

    expect(handler).toBeTypeOf("function");
    await expect(handler!({} as never)).resolves.toBeUndefined();
  });

  it("registrar dos veces no duplica nada", () => {
    registerPublishing();
    registerPublishing();

    expect(publishersFor("instagram")).toHaveLength(1);
  });
});

describe("leer el video por partes (F33)", () => {
  it("pide el tamaño primero y despues cada rango", async () => {
    const calls: Array<{ url: string; method?: string; range?: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), method: init?.method, range: headers.Range });
      return {
        ok: true,
        status: 200,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === "content-length" ? "100" : k.toLowerCase() === "content-type" ? "video/mp4" : null,
        },
        arrayBuffer: async () => new ArrayBuffer(8),
      } as unknown as Response;
    });

    const reader = await signedUrlReader(fetchImpl as unknown as typeof fetch)("https://signed.test/v.mp4");
    await reader.read(0, 7);

    expect(reader.sizeBytes).toBe(100);
    expect(calls[0].method).toBe("HEAD");
    expect(calls[1].range).toBe("bytes=0-7");
  });

  it("sin tamaño no se intenta subir", async () => {
    // Subir sin saber cuanto pesa deja la sesion de YouTube colgada.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
    })) as unknown as typeof fetch;

    await expect(signedUrlReader(fetchImpl)("https://signed.test/v.mp4")).rejects.toThrow(/cuanto pesa/);
  });
});
