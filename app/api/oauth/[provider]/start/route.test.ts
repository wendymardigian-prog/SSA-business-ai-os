/**
 * Quien puede empezar cada conexion (F4, §4.3): un Member conecta su Google
 * Calendar, y sigue recibiendo 403 en google, linkedin y threads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const guards = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  getPermissionAction: vi.fn(),
}));
vi.mock("@/lib/auth/guards", () => guards);
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/webhook-url", () => ({ oauthCallbackUrl: (p: string) => `https://app.test/api/oauth/${p}/callback` }));
const startOAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/oauth/flow", () => ({ startOAuth }));

import { GET } from "./route";

const memberCtx = { workspace: { id: "ws-1" }, user: { id: "member-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  guards.getAdminContext.mockResolvedValue(null); // es Member
  guards.getPermissionAction.mockImplementation(async (key: string) => (key === "scheduling.use" ? memberCtx : null));
  startOAuth.mockResolvedValue({ ok: true, authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1", nonce: "n" });
});

const call = (provider: string, qs = "") =>
  GET(new NextRequest(`https://app.test/api/oauth/${provider}/start${qs}`), { params: Promise.resolve({ provider }) });

describe("empezar una conexion como Member", () => {
  it.each(["google", "linkedin", "threads"])("%s sigue siendo de Owner/Admin: 403", async (provider) => {
    const res = await call(provider);
    expect(res.status).toBe(403);
    expect(startOAuth).not.toHaveBeenCalled();
  });

  it("google_calendar se puede con scheduling.use, a nombre de la persona", async () => {
    const res = await call("google_calendar", "?login_hint=wendy%40ejemplo.com");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("accounts.google.com");
    expect(startOAuth).toHaveBeenCalledWith(expect.objectContaining({ userId: "member-1", workspaceId: "ws-1", loginHint: "wendy@ejemplo.com" }));
    expect(startOAuth.mock.calls[0][0].adapter.provider).toBe("google_calendar");
  });

  it("sin scheduling.use, google_calendar tambien da 403", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    const res = await call("google_calendar");
    expect(res.status).toBe(403);
  });

  it("un proveedor desconocido da 404", async () => {
    expect((await call("outlook")).status).toBe(404);
  });
});
