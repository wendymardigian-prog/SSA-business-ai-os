import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLinkPreviewBot } from "@/lib/attribution/bots";
import { clearLinkPreviewCache, getLinkPreview, LINK_PREVIEW_USER_AGENT, peekLinkPreview } from "./fetch";

// Sin DNS real: cualquier nombre resuelve a una IP publica, salvo los que el test declara internos.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [{ address: host.startsWith("interno.") ? "10.0.0.1" : "93.184.216.34", family: 4 }]),
}));

const html = (status = 200, body = "<title>Hola</title>", type = "text/html; charset=utf-8", headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": type, ...headers } });

function fetcher(...responses: Response[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  return fn;
}

const CARD = { title: "Hola", description: null, image: null, siteName: "a.com" };

beforeEach(() => clearLinkPreviewCache());

describe("getLinkPreview", () => {
  it("devuelve la tarjeta y la segunda vez no vuelve a pedir", async () => {
    const fetchImpl = fetcher(html());
    expect(await getLinkPreview("https://a.com/x", { fetchImpl })).toEqual(CARD);
    expect(await getLinkPreview("https://a.com/x#ancla", { fetchImpl })).toEqual(CARD);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("dos pedidos simultaneos hacen una sola lectura", async () => {
    const fetchImpl = fetcher(html());
    const [a, b] = await Promise.all([getLinkPreview("https://a.com/x", { fetchImpl }), getLinkPreview("https://a.com/x", { fetchImpl })]);
    expect(a).toEqual(CARD);
    expect(b).toEqual(CARD);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("se presenta con un nombre que cuenta como bot: abrir un link medido no es un clic", async () => {
    const fetchImpl = fetcher(html());
    await getLinkPreview("https://a.com/x", { fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers["user-agent"]).toBe(LINK_PREVIEW_USER_AGENT);
    expect(isLinkPreviewBot(LINK_PREVIEW_USER_AGENT)).toBe(true);
  });

  it("toma la direccion final para resolver una imagen relativa", async () => {
    const fetchImpl = fetcher(
      new Response(null, { status: 302, headers: { location: "https://destino.com/nota" } }),
      html(200, '<title>T</title><meta property="og:image" content="/a.png">'),
    );
    expect(await getLinkPreview("https://corto.com/x", { fetchImpl })).toEqual({ title: "T", description: null, image: "https://destino.com/a.png", siteName: "destino.com" });
  });

  it.each([
    ["una direccion interna", "http://127.0.0.1/"],
    ["IPv6 mapeado", "http://[::ffff:7f00:1]/"],
    ["un nombre que resuelve adentro", "https://interno.com/"],
    ["otro puerto", "https://a.com:8443/"],
    ["una ruta /auth/", "https://a.com/auth/confirm?token_hash=x"],
    ["una ruta /api/", "https://a.com/api/algo"],
  ])("no pide %s", async (_label, url) => {
    const fetchImpl = fetcher(html());
    expect(await getLinkPreview(url, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("las mismas reglas valen en cada redireccion", async () => {
    for (const location of ["http://127.0.0.1/", "https://a.com:8443/", "https://b.com/auth/confirm"]) {
      clearLinkPreviewCache();
      const fetchImpl = fetcher(new Response(null, { status: 302, headers: { location } }), html());
      expect(await getLinkPreview("https://a.com/x", { fetchImpl })).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ["un 404", () => html(404)],
    ["un PDF", () => html(200, "%PDF", "application/pdf")],
    ["una pagina sin titulo", () => html(200, "<p>hola</p>")],
  ])("%s no tiene tarjeta, y por una hora no se vuelve a pedir", async (_label, response) => {
    const now = 1_000_000;
    const fetchImpl = fetcher(response());
    expect(await getLinkPreview("https://a.com/x", { fetchImpl, now })).toBeNull();
    expect(peekLinkPreview("https://a.com/x", now + 59 * 60_000)).toBeNull();
    expect(peekLinkPreview("https://a.com/x", now + 61 * 60_000)).toBeUndefined();
  });

  it.each([
    ["un 429", () => Promise.resolve(html(429))],
    ["un 503", () => Promise.resolve(html(503))],
    ["un corte de red", () => Promise.reject(new Error("socket https://a.com/secreto"))],
  ])("%s se vuelve a intentar a los 5 minutos", async (_label, response) => {
    const now = 1_000_000;
    const fetchImpl = vi.fn(response);
    expect(await getLinkPreview("https://a.com/x", { fetchImpl: fetchImpl as never, now })).toBeNull();
    expect(peekLinkPreview("https://a.com/x", now + 4 * 60_000)).toBeNull();
    expect(peekLinkPreview("https://a.com/x", now + 6 * 60_000)).toBeUndefined();
  });

  it("nunca loguea la direccion, ni siquiera si falla", async () => {
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    await getLinkPreview("https://a.com/token-secreto", { fetchImpl: vi.fn().mockRejectedValue(new Error("boom")) as never });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("un link medido con token invalido cae en la app: sin tarjeta", async () => {
    const fetchImpl = fetcher(new Response(null, { status: 302, headers: { location: "https://app.com/" } }), html(200, "<title>Entrar</title>"));
    expect(await getLinkPreview("https://app.com/l/malo.token", { fetchImpl })).toBeNull();
  });

  it("no guarda mas de 500 links", async () => {
    for (let i = 0; i < 501; i++) await getLinkPreview(`https://a.com/${i}`, { fetchImpl: fetcher(html()) });
    expect(peekLinkPreview("https://a.com/0")).toBeUndefined();
    expect(peekLinkPreview("https://a.com/500")).toEqual(CARD);
  });
});
