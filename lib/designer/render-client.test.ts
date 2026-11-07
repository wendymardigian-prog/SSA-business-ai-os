import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
// La copia del servicio (`render/sign.mjs`) contra la de SSA: tienen que firmar igual.
import * as serviceSign from "../../render/sign.mjs";
import { isRenderConfigured, renderDesign, RenderFailed, renderErrorMessage, RenderNotConfigured, RENDER_NOT_CONFIGURED_MESSAGE } from "./render-client";
import { renderSignatureHeader, signRenderBody, verifyRenderSignature } from "./render-sign";

const ENV = { RENDER_SERVICE_URL: "https://render.test", RENDER_SERVICE_SECRET: "s".repeat(40) };
const ok = (files: unknown[] = [{ page: 0, contentType: "image/png", base64: Buffer.from("png").toString("base64") }]) =>
  new Response(JSON.stringify({ ok: true, version: "1.0.0", files }), { status: 200, headers: { "content-type": "application/json" } });

describe("firma compartida con el servicio (F5)", () => {
  const body = JSON.stringify({ html: "<p>hola</p>", width: 10, height: 10, format: "png" });

  it("la firma coincide con la del servidor para el mismo cuerpo", () => {
    const sign = serviceSign as unknown as { signRenderBody: typeof signRenderBody; renderSignatureHeader: typeof renderSignatureHeader; verifyRenderSignature: typeof verifyRenderSignature };
    for (const t of [0, 1_794_000_000, 1_900_000_123]) {
      expect(signRenderBody(body, "secreto", t)).toBe(sign.signRenderBody(body, "secreto", t));
      expect(renderSignatureHeader(body, "secreto", t)).toBe(sign.renderSignatureHeader(body, "secreto", t));
    }
    const header = renderSignatureHeader(body, "secreto", 1000);
    expect(sign.verifyRenderSignature(header, body, "secreto", 1030)).toBe(true);
    expect(sign.verifyRenderSignature(header, body, "secreto", 1061)).toBe(false);
    expect(verifyRenderSignature(header, body, "otro", 1000)).toBe(false);
  });

  it("las dos copias tienen la misma lógica (solo cambian los tipos)", () => {
    const strip = (src: string) =>
      src
        .replace(/\/\/.*$/gm, "")
        .replace(/: string \| null/g, "")
        .replace(/: (string|number|unknown|boolean)(?=[,)\s{=])/g, "")
        .replace(/\s+/g, "");
    const ts = strip(readFileSync("lib/designer/render-sign.ts", "utf8"));
    const mjs = strip(readFileSync("render/sign.mjs", "utf8"));
    expect(ts).toBe(mjs);
  });
});

describe("cliente del render", () => {
  it("sin variables lanza «Falta conectar el servicio de render»", async () => {
    await expect(renderDesign({ html: "<p/>", width: 10, height: 10, format: "pdf" }, { env: {} })).rejects.toBeInstanceOf(RenderNotConfigured);
    expect(renderErrorMessage(new RenderNotConfigured())).toBe(RENDER_NOT_CONFIGURED_MESSAGE);
    expect(isRenderConfigured({})).toBe(false);
  });

  it("simulado (DESIGNER_FAKE_RENDER=1) devuelve 1×1 sin llamar a nadie", async () => {
    const fetchImpl = vi.fn();
    const r = await renderDesign({ pages: [{ html: "a" }, { html: "b" }], width: 10, height: 10, format: "png", measure: true }, { env: { DESIGNER_FAKE_RENDER: "1" }, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.files).toHaveLength(2);
    expect(Buffer.from(r.files[0].bytes.slice(1, 4)).toString()).toBe("PNG");
    expect(r.measure).toHaveLength(2);
    const pdf = await renderDesign({ html: "a", width: 10, height: 10, format: "pdf" }, { env: { DESIGNER_FAKE_RENDER: "1" } });
    expect(Buffer.from(pdf.files[0].bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("firma el cuerpo exacto que manda", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const header = (init.headers as Record<string, string>)["x-render-signature"];
      expect(verifyRenderSignature(header, init.body as string, ENV.RENDER_SERVICE_SECRET, 2000)).toBe(true);
      return ok();
    });
    const r = await renderDesign({ html: "<p/>", width: 10, height: 10, format: "png" }, { env: ENV, fetchImpl: fetchImpl as never, nowSeconds: () => 2000 });
    expect(fetchImpl).toHaveBeenCalledWith("https://render.test/render", expect.anything());
    expect(Buffer.from(r.files[0].bytes).toString()).toBe("png");
  });

  it("si el servicio está dormido (503) o la red falla, reintenta una vez", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(ok());
    const sleep = vi.fn(async () => {});
    await renderDesign({ html: "<p/>", width: 10, height: 10, format: "png" }, { env: ENV, fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const net = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(renderDesign({ html: "<p/>", width: 10, height: 10, format: "png" }, { env: ENV, fetchImpl: net, sleep })).rejects.toMatchObject({ retryable: true });
    expect(net).toHaveBeenCalledTimes(2);
  });

  it("una firma rechazada (401) no se reintenta y no es reintentable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const err = await renderDesign({ html: "<p/>", width: 10, height: 10, format: "png" }, { env: ENV, fetchImpl, sleep: async () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(RenderFailed);
    expect(err.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rechaza un pedido mal armado sin llamar", async () => {
    await expect(renderDesign({ html: "a", pages: [{ html: "b" }], width: 1, height: 1, format: "png" }, { env: ENV })).rejects.toMatchObject({ retryable: false });
    await expect(renderDesign({ html: "a", width: 1, height: 1, format: "pdf", measure: true }, { env: ENV })).rejects.toMatchObject({ retryable: false });
  });
});
