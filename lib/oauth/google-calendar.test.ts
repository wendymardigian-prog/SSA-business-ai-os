/**
 * Conectar Google Calendar (F4), con Google simulado: los cuatro casos del
 * plano sobre `completeOAuth` y el guardado por persona.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const { readSecret, storeSecret } = vi.hoisted(() => ({ readSecret: vi.fn(), storeSecret: vi.fn() }));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret, storeSecret };
});

import { completeOAuth } from "./flow";
import { signState, STATE_TTL_MS } from "./state";
import { googleCalendarAdapter, GOOGLE_CALENDAR_SCOPES } from "@/lib/social/google-calendar";

const WS = "ws-1";
const USER = "user-1";
const NOW = 1_800_000_000_000;
const CALLBACK = "https://app.test/api/oauth/google_calendar/callback";
const STATE_SECRET = "clave-de-firma";

function db(): MemoryDb {
  // Los dos indices parciales de la 00095, en memoria.
  return memoryDb(
    { oauth_connections: [] },
    {
      unique: {
        oauth_connections: (a, b) =>
          a.workspace_id === b.workspace_id &&
          a.provider === b.provider &&
          ((a.user_id == null && b.user_id == null) ||
            (a.user_id != null && a.user_id === b.user_id && a.external_account_id === b.external_account_id)),
      },
    },
  );
}

/** Google simulado: token + userinfo. */
function google(options: { sub: string; email: string; scopes?: string[] }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      return new Response(JSON.stringify({ access_token: "acc", refresh_token: "ref", expires_in: 3600, scope: (options.scopes ?? GOOGLE_CALENDAR_SCOPES).join(" ") }), { status: 200 });
    }
    if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) {
      return new Response(JSON.stringify({ sub: options.sub, email: options.email, name: "Ana" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

function complete(database: MemoryDb, fetchImpl: typeof fetch, nonce = "nonce-1") {
  const state = signState(STATE_SECRET, { nonce, provider: "google_calendar", userId: USER, workspaceId: WS, redirectTo: "/dashboard/agenda/configuracion/calendarios", exp: NOW + STATE_TTL_MS });
  return completeOAuth({
    supabase: database.client,
    adapter: googleCalendarAdapter,
    workspaceId: WS,
    userId: USER,
    code: "code",
    state,
    cookieNonce: nonce,
    callbackUrl: CALLBACK,
    fetchImpl,
    now: NOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  storeSecret.mockResolvedValue({ ok: true });
  readSecret.mockImplementation(async (_c: unknown, _ws: string, name: string) =>
    ({ google_client_id: "cid", google_client_secret: "csec", oauth_state_secret: STATE_SECRET })[name] ?? null,
  );
});

describe("conectar Google Calendar (F4)", () => {
  it("pide los permisos minimos de Calendar mas openid email, con consentimiento y offline", () => {
    const url = new URL(googleCalendarAdapter.authorizeUrl({ clientId: "cid", redirectUri: CALLBACK, state: "s", loginHint: "w@x.com" }));
    expect(url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("login_hint")).toBe("w@x.com");
    expect(googleCalendarAdapter.perUser).toBe(true);
    expect(googleCalendarAdapter.requiredPermission).toBe("scheduling.use");
  });

  it("se guarda a nombre de la persona, con el sub de Google y los tokens en Vault con el id de la conexion", async () => {
    const database = db();
    const result = await complete(database, google({ sub: "sub-1", email: "ana@ejemplo.com" }));
    expect(result.ok).toBe(true);
    const row = database.rows("oauth_connections")[0];
    expect(row).toMatchObject({ provider: "google_calendar", user_id: USER, external_account_id: "sub-1", account_label: "ana@ejemplo.com", status: "active" });
    expect(row.vault_secret_prefix).toBe(`oauth_google_calendar_${row.id}`);
    expect(storeSecret.mock.calls.map((c) => c[2])).toEqual([`oauth_google_calendar_${row.id}_access_token`, `oauth_google_calendar_${row.id}_refresh_token`]);
    expect(result.ok && result.connectionId).toBe(row.id);
  });

  it("sin calendar.events queda en attention con el motivo, y sirve solo para conflictos", async () => {
    const database = db();
    await complete(database, google({ sub: "sub-1", email: "w@x.com", scopes: GOOGLE_CALENDAR_SCOPES.filter((s) => !s.endsWith("/calendar.events")) }));
    const row = database.rows("oauth_connections")[0];
    // El adaptador no lo marca en attention por scopes (events no es "required"):
    // lo decide la pantalla con calendarConnectionStatus, que mira los scopes.
    expect(row.granted_scopes).not.toContain("https://www.googleapis.com/auth/calendar.events");
    const { calendarConnectionStatus, CONNECTION_STATUS_TEXT } = await import("@/lib/scheduling/bookable");
    const status = calendarConnectionStatus({ id: String(row.id), status: row.status as "active", granted_scopes: row.granted_scopes as string[] });
    expect(status).toBe("attention");
    expect(CONNECTION_STATUS_TEXT[status]).toBe("Falta el permiso para crear eventos");
  });

  it("conectar la misma cuenta dos veces deja una sola fila", async () => {
    const database = db();
    await complete(database, google({ sub: "sub-1", email: "w@x.com" }), "n1");
    await complete(database, google({ sub: "sub-1", email: "w-renombrada@x.com" }), "n2");
    expect(database.rows("oauth_connections")).toHaveLength(1);
    expect(database.rows("oauth_connections")[0].account_label).toBe("w-renombrada@x.com");
  });

  it("una segunda cuenta distinta de la misma persona son dos filas", async () => {
    const database = db();
    await complete(database, google({ sub: "sub-1", email: "trabajo@x.com" }), "n1");
    await complete(database, google({ sub: "sub-2", email: "personal@x.com" }), "n2");
    const rows = database.rows("oauth_connections");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.external_account_id).sort()).toEqual(["sub-1", "sub-2"]);
    expect(new Set(rows.map((r) => r.vault_secret_prefix)).size).toBe(2);
  });
});
