import { describe, expect, it, vi } from "vitest";
import { chatBlockUrl, CHAT_BLOCK_ROUTE, fetchChatBlock } from "./block-client";

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("chatBlockUrl", () => {
  it("suma el bloque a los filtros de la URL", () => {
    const url = new URL(chatBlockUrl("team", "channel=abc&range=7d", false), "http://x");
    expect(url.pathname).toBe(CHAT_BLOCK_ROUTE);
    expect(url.searchParams.get("block")).toBe("team");
    expect(url.searchParams.get("channel")).toBe("abc");
    expect(url.searchParams.get("range")).toBe("7d");
    expect(url.searchParams.has("fresh")).toBe(false);
  });

  it("un reintento pide saltear lo guardado", () => {
    expect(new URL(chatBlockUrl("team", "", true), "http://x").searchParams.get("fresh")).toBe("1");
  });

  it("los filtros no pueden pisar el bloque", () => {
    expect(new URL(chatBlockUrl("team", "block=cards", false), "http://x").searchParams.getAll("block")).toEqual(["team"]);
  });
});

describe("fetchChatBlock", () => {
  it("devuelve lo que manda la ruta", async () => {
    const payload = { ok: true, data: [], loadedAt: "2026-11-06T00:00:00.000Z" };
    await expect(fetchChatBlock("team", "", { fetchImpl: respond(200, payload) })).resolves.toEqual(payload);
  });

  it("el error de un bloque llega tal cual", async () => {
    const payload = { ok: false, error: "La base de datos no pudo responder." };
    await expect(fetchChatBlock("team", "", { fetchImpl: respond(200, payload) })).resolves.toEqual(payload);
  });

  it("sin sesion lo dice, en vez de romperse con el HTML del login", async () => {
    const r = await fetchChatBlock("team", "", { fetchImpl: respond(401, { error: "No autorizado" }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("sesión");
  });

  it("sin permiso lo dice", async () => {
    const r = await fetchChatBlock("team", "", { fetchImpl: respond(403, { error: "Sin permiso" }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("permiso");
  });

  it("una respuesta que no es JSON es un error, no una excepcion", async () => {
    const r = await fetchChatBlock("team", "", { fetchImpl: respond(200, "<html>") });
    expect(r.ok).toBe(false);
  });

  it("una respuesta sin la forma esperada es un error", async () => {
    const r = await fetchChatBlock("team", "", { fetchImpl: respond(200, { hola: 1 }) });
    expect(r.ok).toBe(false);
  });

  it("sin red no lanza", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const r = await fetchChatBlock("team", "", { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("conexión");
  });
});
