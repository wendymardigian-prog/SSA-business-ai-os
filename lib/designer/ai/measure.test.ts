import { describe, expect, it, vi } from "vitest";
import { RenderFailed, RenderNotConfigured, type RenderRequest, type RenderResult } from "../render-client";
import { makeMeasure, unavailableNotice } from "./measure";
import { carousel, WS } from "./test-fixtures";

const db = { storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://firmado.example/${path}` })), error: null }) }) } } as never;

describe("ai/measure: medir con el servicio de render (simulado)", () => {
  it("manda una página por cada una del diseño, con medición y a media escala", async () => {
    const requests: RenderRequest[] = [];
    const render = async (req: RenderRequest): Promise<RenderResult> => {
      requests.push(req);
      return {
        version: "t",
        measure: [{ page: 0, elements: [] }],
        files: [
          { page: 1, contentType: "image/png", bytes: new Uint8Array([2]) },
          { page: 0, contentType: "image/png", bytes: new Uint8Array([1]) },
        ],
      };
    };
    const out = await makeMeasure({ db, workspaceId: WS, render })(carousel());
    expect(out.status).toBe("ok");
    expect(requests[0]).toMatchObject({ width: 1080, height: 1350, format: "png", scale: 0.5, measure: true });
    expect(requests[0].pages).toHaveLength(3);
    expect(requests[0].html).toBeUndefined();
    if (out.status === "ok") expect(out.images.map((i) => i[0])).toEqual([1, 2]);
  });

  it("el HTML que se manda no lleva scripts", async () => {
    let sent: RenderRequest | null = null;
    await makeMeasure({
      db,
      workspaceId: WS,
      render: async (req) => ((sent = req), { version: "t", measure: [], files: [] }),
    })(carousel());
    expect(JSON.stringify(sent)).not.toMatch(/<script/i);
  });

  it("sin servicio de render, no está disponible (y no llama a nadie)", async () => {
    const render = vi.fn(async () => {
      throw new RenderNotConfigured();
    });
    const out = await makeMeasure({ db, workspaceId: WS, render })(carousel());
    expect(out).toEqual({ status: "unavailable", reason: "not_configured" });
  });

  it("si el servicio falla, no lanza: dice que no está disponible", async () => {
    const out = await makeMeasure({
      db,
      workspaceId: WS,
      render: async () => {
        throw new RenderFailed("caído", { retryable: true });
      },
    })(carousel());
    expect(out).toEqual({ status: "unavailable", reason: "failed" });
  });

  it("una respuesta sin medición tampoco sirve", async () => {
    const out = await makeMeasure({ db, workspaceId: WS, render: async () => ({ version: "t", files: [] }) })(carousel());
    expect(out).toEqual({ status: "unavailable", reason: "failed" });
  });

  it("los avisos: nada si el render está simulado; el motivo si no", () => {
    expect(unavailableNotice("fake")).toBeNull();
    expect(unavailableNotice("not_configured")).toMatch(/falta conectar el servicio de render/);
    expect(unavailableNotice("failed")).toMatch(/no respondió/);
  });
});
