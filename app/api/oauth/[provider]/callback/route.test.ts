/**
 * Caracterizacion del retorno OAuth (Llamadas, §4.3): fija lo que hace hoy,
 * ANTES de sumar Fathom. Una conexion del workspace exige Owner/Admin y
 * sincroniza las redes sociales; una por persona (Google Calendar) exige su
 * permiso, sincroniza calendarios y vuelve a Agenda > Calendarios.
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
const completeOAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/oauth/flow", () => ({ completeOAuth }));
const syncSocialAccounts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/social/accounts", () => ({ syncSocialAccounts }));
const queueFirstRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/social/sync-hook", () => ({ queueFirstRead }));
const syncCalendars = vi.hoisted(() => vi.fn());
vi.mock("@/lib/scheduling/data/calendars", () => ({ syncCalendars }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://app.test" }));

import { GET } from "./route";

const adminCtx = { workspace: { id: "ws-1" }, user: { id: "admin-1" } };
const memberCtx = { workspace: { id: "ws-1" }, user: { id: "member-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  guards.getAdminContext.mockResolvedValue(null);
  guards.getPermissionAction.mockImplementation(async (key: string) => (key === "scheduling.use" ? memberCtx : null));
  completeOAuth.mockResolvedValue({ ok: true, connectionId: "conn-1", redirectTo: "/dashboard/settings/integrations" });
  syncSocialAccounts.mockResolvedValue({ newAccountIds: ["a1"] });
  syncCalendars.mockResolvedValue(undefined);
  queueFirstRead.mockResolvedValue(undefined);
});

const call = (provider: string, qs = "?code=c&state=s") =>
  GET(new NextRequest(`https://app.test/api/oauth/${provider}/callback${qs}`), { params: Promise.resolve({ provider }) });

describe("retorno OAuth: quien puede completarlo", () => {
  it.each(["google", "linkedin", "threads"])("%s es de Owner/Admin: un Member recibe 403", async (provider) => {
    const res = await call(provider);
    expect(res.status).toBe(403);
    expect(completeOAuth).not.toHaveBeenCalled();
  });

  it("google_calendar sin scheduling.use da 403", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    expect((await call("google_calendar")).status).toBe(403);
    expect(completeOAuth).not.toHaveBeenCalled();
  });

  it("un proveedor desconocido da 404", async () => {
    expect((await call("outlook")).status).toBe(404);
  });
});

describe("retorno OAuth: una conexion del workspace", () => {
  beforeEach(() => guards.getAdminContext.mockResolvedValue(adminCtx));

  it("sincroniza las redes, encola la primera lectura y vuelve con ?connected=<proveedor>", async () => {
    const res = await call("google");
    expect(syncSocialAccounts).toHaveBeenCalledTimes(1);
    expect(queueFirstRead).toHaveBeenCalledWith("ws-1", ["a1"], "oauth google");
    expect(syncCalendars).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/settings/integrations");
    expect(location.searchParams.get("connected")).toBe("google");
  });

  it("borra siempre la cookie del state", async () => {
    const res = await call("google");
    expect(res.headers.get("set-cookie")).toContain("oauth_nonce=;");
  });

  it("si falla, vuelve con ?error= y no sincroniza nada", async () => {
    completeOAuth.mockResolvedValue({ ok: false, error: "state vencido", redirectTo: "/dashboard/settings/integrations" });
    const res = await call("google");
    expect(syncSocialAccounts).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("state vencido");
    expect(location.searchParams.get("connected")).toBeNull();
  });
});

describe("retorno OAuth: una conexion por persona (Google Calendar)", () => {
  it("sincroniza los calendarios y vuelve a Agenda > Calendarios con ?connected=1", async () => {
    const res = await call("google_calendar");
    expect(syncCalendars).toHaveBeenCalledWith({ supabase: {} }, "conn-1");
    expect(syncSocialAccounts).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/agenda/configuracion/calendarios");
    expect(location.searchParams.get("connected")).toBe("1");
    expect(completeOAuth.mock.calls[0][0]).toMatchObject({ userId: "member-1", workspaceId: "ws-1" });
  });

  it("una falla al sincronizar no rompe la vuelta", async () => {
    syncCalendars.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call("google_calendar");
    expect(res.status).toBe(307);
    spy.mockRestore();
  });
});
