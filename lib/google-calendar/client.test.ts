/**
 * El cliente de Google Calendar con `fetch` simulado (F6). Nunca se llama a
 * Google.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { readSecret, storeSecret } = vi.hoisted(() => ({ readSecret: vi.fn(), storeSecret: vi.fn() }));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret, storeSecret };
});

import { getAccessToken, resetTokenCache, TOKEN_MARGIN_MS } from "./auth";
import { buildEventBody, createEvent, deleteEvent, freeBusyChunks, getBusy, listCalendars, updateEvent } from "./client";
import { classifyGoogleError, GoogleCalendarError } from "./errors";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const CONN = "conn-1";

function db(over: Record<string, unknown> = {}) {
  return memoryDb({
    oauth_connections: [
      {
        id: CONN,
        workspace_id: "ws-1",
        user_id: "user-1",
        provider: "google_calendar",
        status: "active",
        vault_secret_prefix: `oauth_google_calendar_${CONN}`,
        token_expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
        account_label: "wendy@ejemplo.com",
        ...over,
      },
    ],
    notifications: [],
  });
}

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: URL, init: RequestInit) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push({ url: url.toString(), init: init ?? {} });
    const res = await handler(url, init ?? {});
    return new Response(res.body === undefined ? "" : JSON.stringify(res.body), { status: res.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenCache();
  storeSecret.mockResolvedValue({ ok: true });
  readSecret.mockImplementation(async (_c: unknown, _ws: string, name: string) => {
    if (name.endsWith("_access_token")) return "access-vigente";
    if (name.endsWith("_refresh_token")) return "refresh-1";
    if (name === "google_client_id") return "client-id";
    if (name === "google_client_secret") return "client-secret";
    return null;
  });
});

describe("freebusy en tramos de 90 dias", () => {
  it("120 dias son 2 llamadas y se unen los resultados", async () => {
    const database = db();
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.pathname.endsWith("/freeBusy")) {
        return { status: 200, body: { calendars: { "cal-a": { busy: [{ start: "2026-10-02T14:00:00Z", end: "2026-10-02T15:00:00Z" }] } } } };
      }
      return { status: 404 };
    });
    const busy = await getBusy({ supabase: database.client, fetchImpl, now: () => NOW }, CONN, ["cal-a"], "2026-10-01T00:00:00.000Z", "2027-01-29T00:00:00.000Z");
    const fb = calls.filter((c) => c.url.includes("/freeBusy"));
    expect(fb).toHaveLength(2);
    expect(busy).toHaveLength(2);
    expect(JSON.parse(fb[0].init.body as string)).toMatchObject({ timeMin: "2026-10-01T00:00:00.000Z", timeMax: "2026-12-30T00:00:00.000Z", items: [{ id: "cal-a" }] });
    expect(JSON.parse(fb[1].init.body as string).timeMax).toBe("2027-01-29T00:00:00.000Z");
    expect(freeBusyChunks("2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z")).toHaveLength(1);
  });

  it("un calendario con errors[] es un error temporal, nunca 'libre'", async () => {
    const database = db();
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { calendars: { "cal-a": { errors: [{ reason: "notFound" }] } } } }));
    await expect(getBusy({ supabase: database.client, fetchImpl, now: () => NOW }, CONN, ["cal-a"], "2026-10-01T00:00:00.000Z", "2026-10-05T00:00:00.000Z")).rejects.toMatchObject({ kind: "temporary" });
  });
});

describe("renovar el token", () => {
  it("con invalid_grant la conexion queda revoked, se avisa a la persona y el error es permanent", async () => {
    const database = db({ token_expires_at: new Date(NOW.getTime() - 1000).toISOString() });
    const { fetchImpl } = fakeFetch((url) => {
      if (url.hostname === "oauth2.googleapis.com") return { status: 400, body: { error: "invalid_grant", error_description: "Token has been revoked" } };
      return { status: 500 };
    });
    await expect(getAccessToken({ supabase: database.client, fetchImpl, now: () => NOW }, CONN)).rejects.toMatchObject({ kind: "permanent", reason: "invalid_grant" });
    expect(database.rows("oauth_connections")[0].status).toBe("revoked");
    const notice = database.rows("notifications")[0];
    expect(notice).toMatchObject({ type: "integration_attention", recipient_id: "user-1", workspace_id: "ws-1" });
    expect(String(notice.title)).toContain("Reconectá tu Google Calendar");
  });

  it("renueva cuando falta menos de un minuto y cachea el token nuevo", async () => {
    const database = db({ token_expires_at: new Date(NOW.getTime() + TOKEN_MARGIN_MS - 1000).toISOString() });
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.hostname === "oauth2.googleapis.com") return { status: 200, body: { access_token: "access-nuevo", expires_in: 3600 } };
      return { status: 500 };
    });
    const deps = { supabase: database.client, fetchImpl, now: () => NOW };
    expect(await getAccessToken(deps, CONN)).toBe("access-nuevo");
    expect(await getAccessToken(deps, CONN)).toBe("access-nuevo");
    expect(calls.filter((c) => c.url.includes("oauth2.googleapis.com"))).toHaveLength(1);
    expect(storeSecret).toHaveBeenCalledWith(expect.anything(), "ws-1", `oauth_google_calendar_${CONN}_access_token`, "access-nuevo");
    expect(database.rows("oauth_connections")[0].token_expires_at).toBe(new Date(NOW.getTime() + 3600_000).toISOString());
  });
});

describe("eventos", () => {
  it("con Meet manda conferenceData.createRequest y conferenceDataVersion=1, y sendUpdates=all", async () => {
    const database = db();
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { id: "ev-1", iCalUID: "ev-1@google.com", hangoutLink: "https://meet.google.com/abc-defg-hij" } }));
    const created = await createEvent({ supabase: database.client, fetchImpl, now: () => NOW }, CONN, "cal-a", {
      bookingUid: "uid-123",
      summary: "Llamada con Ana",
      description: "Detalles",
      startUtc: "2026-10-06T18:00:00.000Z",
      endUtc: "2026-10-06T18:30:00.000Z",
      timeZone: "America/Costa_Rica",
      attendeeEmail: "ana@ejemplo.com",
      attendeeName: "Ana",
      location: { kind: "google_meet" },
    });
    expect(created).toEqual({ eventId: "ev-1", iCalUID: "ev-1@google.com", meetUrl: "https://meet.google.com/abc-defg-hij" });
    const insert = calls.find((c) => c.url.includes("/calendars/cal-a/events"))!;
    const url = new URL(insert.url);
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    const body = JSON.parse(insert.init.body as string);
    expect(body.conferenceData).toEqual({ createRequest: { requestId: "uid-123", conferenceSolutionKey: { type: "hangoutsMeet" } } });
    expect(body.attendees).toEqual([{ email: "ana@ejemplo.com", displayName: "Ana" }]);
    expect(body.extendedProperties).toEqual({ private: { ssaBookingUid: "uid-123" } });
    expect(body.start).toEqual({ dateTime: "2026-10-06T18:00:00.000Z", timeZone: "America/Costa_Rica" });
  });

  it("sin email del invitado no hay attendees; con ubicacion manual va location y no Meet", () => {
    const body = buildEventBody({
      bookingUid: "u",
      summary: "s",
      description: "d",
      startUtc: "2026-10-06T18:00:00.000Z",
      endUtc: "2026-10-06T18:30:00.000Z",
      timeZone: "UTC",
      attendeeEmail: null,
      location: { kind: "manual", text: "Oficina central" },
    });
    expect(body.attendees).toBeUndefined();
    expect(body.conferenceData).toBeUndefined();
    expect(body.location).toBe("Oficina central");
  });

  it("deleteEvent con 410 (o 404) se resuelve sin error; otros errores se propagan", async () => {
    const database = db();
    let status = 410;
    const { fetchImpl, calls } = fakeFetch(() => ({ status, body: { error: { message: "gone", errors: [{ reason: "deleted" }] } } }));
    const deps = { supabase: database.client, fetchImpl, now: () => NOW };
    await expect(deleteEvent(deps, CONN, "cal-a", "ev-1")).resolves.toBeUndefined();
    expect(new URL(calls[0].url).searchParams.get("sendUpdates")).toBe("all");
    status = 404;
    await expect(deleteEvent(deps, CONN, "cal-a", "ev-1")).resolves.toBeUndefined();
    status = 503;
    await expect(deleteEvent(deps, CONN, "cal-a", "ev-1")).rejects.toMatchObject({ kind: "temporary", status: 503 });
  });

  it("updateEvent hace PATCH con sendUpdates=all", async () => {
    const database = db();
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { id: "ev-1" } }));
    await updateEvent({ supabase: database.client, fetchImpl, now: () => NOW }, CONN, "cal-a", "ev-1", { startUtc: "2026-10-07T18:00:00.000Z", endUtc: "2026-10-07T18:30:00.000Z", timeZone: "UTC" });
    expect(calls[0].init.method).toBe("PATCH");
    expect(new URL(calls[0].url).searchParams.get("sendUpdates")).toBe("all");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ start: { dateTime: "2026-10-07T18:00:00.000Z", timeZone: "UTC" }, end: { dateTime: "2026-10-07T18:30:00.000Z", timeZone: "UTC" } });
  });

  it("listCalendars recorre todas las paginas", async () => {
    const database = db();
    const { fetchImpl } = fakeFetch((url) => {
      const token = url.searchParams.get("pageToken");
      if (!token) return { status: 200, body: { items: [{ id: "primary-id", summary: "Wendy", accessRole: "owner", primary: true }], nextPageToken: "p2" } };
      return { status: 200, body: { items: [{ id: "shared", summary: "Equipo", accessRole: "reader", backgroundColor: "#ccc" }] } };
    });
    const items = await listCalendars({ supabase: database.client, fetchImpl, now: () => NOW }, CONN);
    expect(items.map((i) => [i.id, i.accessRole, i.primary])).toEqual([["primary-id", "owner", true], ["shared", "reader", false]]);
  });
});

describe("clasificacion de errores (documentacion de Google, 27/9/2026)", () => {
  it.each([
    [{ status: 429 }, "temporary"],
    [{ status: 503 }, "temporary"],
    [{ status: null, network: true }, "temporary"],
    [{ status: 403, reason: "rateLimitExceeded" }, "temporary"],
    [{ status: 403, reason: "userRateLimitExceeded" }, "temporary"],
    [{ status: 403, reason: "insufficientPermissions" }, "permanent"],
    [{ status: 401 }, "permanent"],
    [{ status: 400, reason: "invalid_grant" }, "permanent"],
    [{ status: 404 }, "not_found"],
    [{ status: 410 }, "not_found"],
  ] as const)("%o → %s", (input, kind) => {
    expect(classifyGoogleError(input as { status: number | null; reason?: string; network?: boolean })).toBe(kind);
  });

  it("GoogleCalendarError conserva kind, status y reason", () => {
    const e = new GoogleCalendarError("x", "permanent", 403, "insufficientPermissions");
    expect(e.name).toBe("GoogleCalendarError");
    expect([e.kind, e.status, e.reason]).toEqual(["permanent", 403, "insufficientPermissions"]);
  });
});
