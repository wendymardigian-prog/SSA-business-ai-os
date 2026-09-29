/**
 * La ruta de descarga de la media del chat (F2).
 *
 * Lo que importa: que valide el path antes de tocar Storage, que exija sesion,
 * y que firme con el cliente del USUARIO (para que la policy del bucket decida
 * quien puede escuchar que).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { NextRequest } from "next/server";
import { GET } from "./route";

const SIGNED = "https://storage.supabase/object/sign/chat-media/ws-1/cv-1/m-1-0.ogg?token=abc";

function client(options: { user?: boolean; signed?: string | null } = {}) {
  const createSignedUrl = vi.fn(async () =>
    options.signed === null
      ? { data: null, error: { message: "Object not found" } }
      : { data: { signedUrl: options.signed ?? SIGNED }, error: null },
  );
  const from = vi.fn(() => ({ createSignedUrl }));
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "u-1" } } }) },
    storage: { from },
  });
  return { from, createSignedUrl };
}

const call = (query: string) => GET(new NextRequest(`https://app.test/api/v1/chat-media${query}`));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/chat-media (F2)", () => {
  it("con sesion valida responde 302 a una URL firmada de 15 minutos", async () => {
    const { from, createSignedUrl } = client();

    const response = await call("?path=ws-1%2Fcv-1%2Fm-1-0.ogg");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(from).toHaveBeenCalledWith("chat-media");
    expect(createSignedUrl).toHaveBeenCalledWith("ws-1/cv-1/m-1-0.ogg", 900, undefined);
  });

  it("con download=1 firma por 5 minutos y pide la descarga con su nombre", async () => {
    const { createSignedUrl } = client();

    await call("?path=ws-1%2Fcv-1%2Fm-1-0.ogg&download=1&name=nota.ogg");

    expect(createSignedUrl).toHaveBeenCalledWith("ws-1/cv-1/m-1-0.ogg", 300, { download: "nota.ogg" });
  });

  it("un path con .. o que arranca con / responde 400 SIN tocar Storage", async () => {
    const { from } = client();

    expect((await call("?path=ws-1%2F..%2Fws-2%2Fx.ogg")).status).toBe(400);
    expect((await call("?path=%2Fws-1%2Fx.ogg")).status).toBe(400);
    expect((await call("?path=suelto.ogg")).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("sin el parametro responde 400", async () => {
    client();
    expect((await call("")).status).toBe(400);
  });

  it("sin sesion responde 401", async () => {
    const { from } = client({ user: false });

    expect((await call("?path=ws-1%2Fcv-1%2Fm-1-0.ogg")).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("si la RLS no deja firmar responde 404: no se confirma que exista", async () => {
    client({ signed: null });

    const response = await call("?path=ws-9%2Fcv-9%2Fm-9-0.ogg");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "No encontre ese adjunto" });
  });
});
