/** La serie de reuniones en Google (00524) con `fetch` simulado: nunca se llama a Google. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { readSecret, storeSecret } = vi.hoisted(() => ({ readSecret: vi.fn(), storeSecret: vi.fn() }));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret, storeSecret };
});

import { resetTokenCache } from "./auth";
import { createRecurringEvent, cutRecurringEvent, listInstances } from "./client";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const CONN = "conn-1";
const db = () =>
  memoryDb({
    oauth_connections: [
      { id: CONN, workspace_id: "ws-1", user_id: "user-1", provider: "google_calendar", status: "active", vault_secret_prefix: `oauth_google_calendar_${CONN}`, token_expires_at: new Date(NOW.getTime() + 3600_000).toISOString(), account_label: "ana@ejemplo.com" },
    ],
    notifications: [],
  });

type Call = { url: URL; init: RequestInit };
function fakeFetch(handler: (url: URL, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push({ url, init: init ?? {} });
    const res = handler(url, init ?? {});
    return new Response(res.body === undefined ? "" : JSON.stringify(res.body), { status: res.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenCache();
  storeSecret.mockResolvedValue({ ok: true });
  readSecret.mockImplementation(async (_c: unknown, _ws: string, name: string) => (name.endsWith("_access_token") ? "access-vigente" : name.endsWith("_refresh_token") ? "refresh-1" : "x"));
});

describe("la serie en Google", () => {
  it("crea UN evento con su regla, Meet e invitación", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { id: "ev-1", iCalUID: "ical-1", hangoutLink: "https://meet.google.com/abc" } }));
    const r = await createRecurringEvent({ supabase: db().client, fetchImpl, now: () => NOW }, CONN, "primary", {
      bookingUid: "uid-1",
      summary: "Sesión con Ana",
      description: "…",
      startUtc: "2026-11-26T15:00:00.000Z",
      endUtc: "2026-11-26T15:30:00.000Z",
      timeZone: "America/Costa_Rica",
      attendeeEmail: "ana@ejemplo.com",
      location: { kind: "google_meet" },
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=TH",
    });
    expect(r).toEqual({ eventId: "ev-1", iCalUID: "ical-1", meetUrl: "https://meet.google.com/abc" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
    expect(body.attendees).toEqual([{ email: "ana@ejemplo.com" }]);
    expect(calls[0].url.searchParams.get("sendUpdates")).toBe("all");
    expect(calls[0].url.searchParams.get("conferenceDataVersion")).toBe("1");
  });

  it("lee las fechas (también las borradas y las movidas), de a páginas", async () => {
    const { fetchImpl, calls } = fakeFetch((url) =>
      url.searchParams.get("pageToken")
        ? { status: 200, body: { items: [{ id: "ev-1_3", status: "cancelled", start: { dateTime: "2026-12-10T15:00:00Z" }, end: { dateTime: "2026-12-10T15:30:00Z" } }] } }
        : { status: 200, body: { nextPageToken: "p2", items: [{ id: "ev-1_1", status: "confirmed", start: { dateTime: "2026-11-26T15:00:00Z" }, end: { dateTime: "2026-11-26T15:30:00Z" } }, { id: "ev-1_2", start: { dateTime: "2026-12-04T16:00:00Z" }, end: { dateTime: "2026-12-04T16:30:00Z" }, originalStartTime: { dateTime: "2026-12-03T15:00:00Z" } }] } },
    );
    const list = await listInstances({ supabase: db().client, fetchImpl, now: () => NOW }, CONN, "primary", "ev-1", { timeMin: NOW.toISOString(), timeMax: "2027-01-25T00:00:00.000Z" });
    expect(list.map((i) => [i.id, i.status, i.originalStartUtc])).toEqual([
      ["ev-1_1", "confirmed", null],
      ["ev-1_2", "confirmed", "2026-12-03T15:00:00.000Z"],
      ["ev-1_3", "cancelled", null],
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.pathname).toContain("/events/ev-1/instances");
    expect(calls[0].url.searchParams.get("showDeleted")).toBe("true");
  });

  it("corta la regla con UNTIL; un evento que ya no existe cuenta como cortado", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { id: "ev-1" } }));
    await cutRecurringEvent({ supabase: db().client, fetchImpl, now: () => NOW }, CONN, "primary", "ev-1", "RRULE:FREQ=WEEKLY;BYDAY=TH", "2026-11-25T12:00:00.000Z");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261125T120000Z"] });
    const gone = fakeFetch(() => ({ status: 404, body: { error: { message: "Not Found" } } }));
    await expect(cutRecurringEvent({ supabase: db().client, fetchImpl: gone.fetchImpl, now: () => NOW }, CONN, "primary", "ev-1", "RRULE:FREQ=DAILY", NOW.toISOString())).resolves.toBeUndefined();
  });
});
