import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getMemberAction = vi.fn();
const checkLimit = vi.fn();
const getLinkPreview = vi.fn();
const peekLinkPreview = vi.fn();

vi.mock("@/lib/auth/guards", () => ({ getMemberAction: () => getMemberAction() }));
vi.mock("@/lib/antispam/rate-limit", () => ({ checkLimit: (...args: unknown[]) => checkLimit(...args) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/link-preview/fetch", () => ({
  MAX_LINK_PREVIEW_URL_LENGTH: 2000,
  getLinkPreview: (...args: unknown[]) => getLinkPreview(...args),
  peekLinkPreview: (...args: unknown[]) => peekLinkPreview(...args),
}));

import { POST } from "./route";

const member = { user: { id: "u1" }, permissions: { channels: { mode: "all", all: { scope: "own", reply: true } } } };
const CARD = { title: "T", description: null, image: null, siteName: "a.com" };

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/v1/link-preview", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getMemberAction.mockResolvedValue(member);
  peekLinkPreview.mockReturnValue(undefined);
  checkLimit.mockResolvedValue({ allowed: true, count: 1, max: 60 });
  getLinkPreview.mockResolvedValue(CARD);
});

describe("POST /api/v1/link-preview", () => {
  it("sin sesion no pide nada", async () => {
    getMemberAction.mockResolvedValue(null);
    expect((await post({ url: "https://a.com" })).status).toBe(401);
    expect(getLinkPreview).not.toHaveBeenCalled();
  });

  it("sin acceso a la bandeja no pide nada", async () => {
    getMemberAction.mockResolvedValue({ ...member, permissions: { channels: { mode: "custom", byChannel: {} } } });
    expect((await post({ url: "https://a.com" })).status).toBe(403);
    expect(getLinkPreview).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ url: 123 }], [{ url: "" }], [{ url: "x".repeat(2001) }], ["no es json"]])("rechaza un pedido invalido: %j", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(getLinkPreview).not.toHaveBeenCalled();
  });

  it("devuelve la tarjeta, contando el tope por persona", async () => {
    const response = await post({ url: "https://a.com" });
    expect(await response.json()).toEqual({ preview: CARD });
    expect(checkLimit.mock.calls[0][1]).toEqual({ key: "link-preview:u1", max: 60, windowMs: 60_000 });
  });

  it("lo que ya se sabe no cuenta para el tope, tampoco un link sin tarjeta", async () => {
    peekLinkPreview.mockReturnValue(null);
    expect(await (await post({ url: "https://a.com" })).json()).toEqual({ preview: null });
    expect(checkLimit).not.toHaveBeenCalled();
    expect(getLinkPreview).not.toHaveBeenCalled();
  });

  it("pasado el tope, 429 y sin pedir la pagina", async () => {
    checkLimit.mockResolvedValue({ allowed: false, count: 61, max: 60 });
    expect((await post({ url: "https://a.com" })).status).toBe(429);
    expect(getLinkPreview).not.toHaveBeenCalled();
  });
});
