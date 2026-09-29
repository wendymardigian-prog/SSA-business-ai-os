/**
 * Pedir la transcripcion a mano (F13).
 *
 * Lo que importa: que la RLS decida (se lee con el cliente del USUARIO), que un
 * mensaje que no se puede ver devuelva 404 y no 403, y que pedirla dos veces no
 * sea un error.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClient, createServiceClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient, createServiceClient }));

const { scheduleJob } = vi.hoisted(() => ({ scheduleJob: vi.fn() }));
vi.mock("@/lib/scheduler", () => ({ scheduleJob }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const MSG = "m-1";

const voiceReady = {
  v: 2,
  items: [{ kind: "voice", status: "ready", storagePath: "ws-1/cv-1/m-1-0.ogg", mime: "audio/ogg" }],
};

/** El cliente del usuario: devuelve el mensaje que la RLS deje ver. */
function userClient(options: { user?: boolean; message?: Record<string, unknown> | null } = {}) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "u-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: options.message ?? null, error: null }) }),
      }),
    }),
  });
  createServiceClient.mockResolvedValue({});
}

const call = () =>
  POST(new NextRequest(`https://app.test/api/v1/messages/${MSG}/transcribe`, { method: "POST" }), {
    params: Promise.resolve({ id: MSG }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  scheduleJob.mockResolvedValue({ id: "job-1" });
});

describe("POST /api/v1/messages/[id]/transcribe (F13)", () => {
  it("encola la transcripcion y responde 200", async () => {
    userClient({ message: { id: MSG, transcript_status: "none", attachments: voiceReady } });

    const response = await call();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: "queued" });
    expect(scheduleJob).toHaveBeenCalledWith(
      expect.anything(),
      "transcribe_audio",
      { messageId: MSG },
      expect.any(Date),
      "transcribe:m-1",
    );
  });

  it("una que fallo se puede reintentar", async () => {
    userClient({ message: { id: MSG, transcript_status: "failed", attachments: voiceReady } });

    expect((await call()).status).toBe(200);
    expect(scheduleJob).toHaveBeenCalled();
  });

  it("si la RLS no lo deja ver responde 404, NO 403: no se confirma que exista", async () => {
    userClient({ message: null });

    const response = await call();

    expect(response.status).toBe(404);
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("si ya esta transcribiendo responde 200 con already_running, no un error", async () => {
    userClient({ message: { id: MSG, transcript_status: "pending", attachments: voiceReady } });

    const response = await call();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: "already_running" });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un job ya encolado tampoco es un error", async () => {
    userClient({ message: { id: MSG, transcript_status: "failed", attachments: voiceReady } });
    scheduleJob.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "23505" }));

    const response = await call();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: "already_running" });
  });

  it("sin sesion responde 401", async () => {
    userClient({ user: false });

    expect((await call()).status).toBe(401);
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un mensaje sin audio disponible responde 409: el boton fallaria siempre", async () => {
    userClient({
      message: {
        id: MSG,
        transcript_status: "none",
        attachments: { v: 2, items: [{ kind: "voice", status: "failed", storagePath: null }] },
      },
    });

    expect((await call()).status).toBe(409);
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("un mensaje de texto tampoco se transcribe", async () => {
    userClient({ message: { id: MSG, transcript_status: "none", attachments: null } });

    expect((await call()).status).toBe(409);
  });
});
