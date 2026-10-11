import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { fathomSyncDedupeKey } from "./queue";
import { syncFathomConnection, FIRST_PAGE, INITIAL_WINDOW_MS, WATERMARK_OVERLAP_MS, type IngestDeps } from "./ingest";

const WS = "ws-1";
const CONN = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-10T18:00:00.000Z");

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

interface Meeting { recording_id: number | null; created_at: string; recorded_by: { email: string }; calendar_invitees?: unknown[]; title?: string }
const meeting = (i: number, email = "ana@negocio.io"): Meeting => ({
  recording_id: i,
  created_at: `2026-10-10T${String(10 + (i % 8)).padStart(2, "0")}:00:00Z`,
  recorded_by: { email },
  title: `Llamada ${i}`,
  calendar_invitees: [{ name: "Lead", email: "lead@x.com", is_external: true }],
});

function world(opts: { watermark?: string | null; cursor?: string | null; closers?: boolean; status?: string; callsPre?: string[] } = {}) {
  const conn = {
    id: CONN, workspace_id: WS, user_id: "user-ana", status: opts.status ?? "active", vault_secret_prefix: "oauth_fathom_c1",
    token_expires_at: "2026-10-10T19:00:00Z", account_label: "ana@negocio.io",
    sync_watermark: opts.watermark ?? null, sync_cursor: opts.cursor ?? null, sync_last_error: null as string | null, last_synced_at: null as string | null,
  };
  const calls: Array<Record<string, unknown>> = (opts.callsPre ?? []).map((id) => ({ external_id: id }));
  const jobs: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const db = fakeDb(
    {
      "oauth_connections:select": () => ({ data: { ...conn } }),
      "oauth_connections:update": (c) => { Object.assign(conn, c.values); return { data: null }; },
      "workspace_members:select": () => ({
        data: opts.closers === false
          ? [{ user_id: "user-ana", is_closer: false, closer_emails: [] }]
          : [{ user_id: "user-ana", is_closer: true, closer_emails: ["ana.personal@gmail.com"] }, { user_id: "user-beto", is_closer: false, closer_emails: [] }],
      }),
      "calls:select": (c) => {
        const ids = (c.filters.find((f) => f.method === "in")?.value ?? []) as string[];
        return { data: calls.filter((x) => ids.includes(String(x.external_id))).map((x) => ({ external_id: x.external_id })) };
      },
      "calls:insert": (c) => {
        const v = c.values as Record<string, unknown>;
        if (calls.some((x) => x.external_id === v.external_id)) return { error: { message: "duplicate key", code: "23505" } };
        calls.push({ ...v, id: `call-${calls.length + 1}` });
        return { data: { id: `call-${calls.length}` } };
      },
      "contacts:select": { data: [] },
      "bookings:select": { data: [] },
      "audit_log:insert": (c) => { audits.push(c.values as Record<string, unknown>); return { data: { id: "a" } }; },
      "scheduled_jobs:select": (c) => {
        const like = String(c.filters.find((f) => f.method === "like")?.value ?? "").replace(/%$/, "");
        return { data: jobs.filter((j) => j.status === "pending" && String(j.dedupe_key ?? "").startsWith(like)) };
      },
      "scheduled_jobs:insert": (c) => { jobs.push({ ...(c.values as object), status: "pending" }); return { data: { id: "j" } }; },
    },
    { workspace_member_profiles: { data: [{ user_id: "user-ana", email: "ana@negocio.io" }, { user_id: "user-beto", email: "beto@negocio.io" }] } },
  );
  return { conn, calls, jobs, audits, db };
}

interface FathomWorld { pages: Record<string, { items: Meeting[]; next?: string }>; transcriptStatus?: number; status?: number; headers?: Record<string, string>; log: string[] }
function fathom(w: FathomWorld) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    w.log.push(url.pathname + url.search);
    if (url.pathname.endsWith("/meetings")) {
      if (w.status) return json({}, w.status, w.headers);
      const page = w.pages[url.searchParams.get("cursor") ?? "first"];
      return json({ items: page?.items ?? [], next_cursor: page?.next ?? null });
    }
    if (w.transcriptStatus) return json({}, w.transcriptStatus);
    return json({ transcript: [{ speaker: { display_name: "Ana" }, text: "Hola", timestamp: "00:00:01" }, { speaker: { display_name: "Lead" }, text: "Buenas", timestamp: "00:00:05" }] });
  });
}

const baseDeps = (w: ReturnType<typeof world>, fetchImpl: unknown): IngestDeps => ({
  supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW,
  tokenProvider: { get: async () => "TOKEN", force: async () => "TOKEN-2" },
});

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("syncFathomConnection", () => {
  it("con next_cursor pide la segunda pagina con ese cursor y guarda las llamadas de las dos", async () => {
    const w = world();
    const log: string[] = [];
    const f = fathom({ pages: { first: { items: [meeting(1), meeting(2)], next: "C2" }, C2: { items: [meeting(3)] } }, log });
    const r = await syncFathomConnection(baseDeps(w, f), CONN);
    expect(r.outcome).toBe("complete");
    expect(r.ingested).toBe(3);
    expect(w.calls.map((c) => c.external_id)).toEqual(["1", "2", "3"]);
    expect(log.some((l) => l.includes("cursor=C2"))).toBe(true);
  });

  it("20 reuniones nuevas: la primera corrida NO pasa de 9 pedidos, deja el cursor y reencola; la segunda sigue sin duplicar", async () => {
    const w = world();
    const log: string[] = [];
    const f = fathom({ pages: { first: { items: Array.from({ length: 20 }, (_, i) => meeting(i + 1)) } }, log });
    const deps = baseDeps(w, f);

    const r1 = await syncFathomConnection(deps, CONN);
    expect(r1.outcome).toBe("continued");
    expect(f.mock.calls.length).toBeLessThanOrEqual(9);
    expect(r1.ingested).toBe(8);
    expect(w.conn.sync_cursor).toBe(FIRST_PAGE);
    const continuation = w.jobs.find((j) => j.type === "fathom_sync");
    expect(continuation).toBeTruthy();
    expect(new Date(continuation!.run_at as string).getTime()).toBe(NOW.getTime() + 70_000);

    f.mockClear();
    w.jobs.length = 0;
    const r2 = await syncFathomConnection(deps, CONN);
    expect(f.mock.calls.length).toBeLessThanOrEqual(9);
    expect(r2.ingested).toBe(8);
    expect(r2.skippedExisting).toBeGreaterThanOrEqual(8);

    const r3 = await syncFathomConnection(deps, CONN);
    expect(r3.outcome).toBe("complete");
    expect(r3.ingested).toBe(4);
    expect(w.calls).toHaveLength(20);
    expect(new Set(w.calls.map((c) => c.external_id)).size).toBe(20);
    expect(w.conn.sync_cursor).toBeNull();
  });

  it("una reunion grabada por alguien que no es closer no guarda nada", async () => {
    const w = world();
    const f = fathom({ pages: { first: { items: [meeting(1, "setter@negocio.io"), meeting(2, "beto@negocio.io")] } }, log: [] });
    const r = await syncFathomConnection(baseDeps(w, f), CONN);
    expect(r.ingested).toBe(0);
    expect(r.skippedNotCloser).toBe(2);
    expect(w.calls).toHaveLength(0);
  });

  it("reconoce al closer por su correo alterno y le asigna la llamada", async () => {
    const w = world();
    const f = fathom({ pages: { first: { items: [meeting(1, "Ana.Personal@Gmail.com")] } }, log: [] });
    await syncFathomConnection(baseDeps(w, f), CONN);
    expect(w.calls[0]).toMatchObject({ recorded_by_user_id: "user-ana", recorded_by_email: "ana.personal@gmail.com", source: "fathom", analysis_status: "classifying" });
  });

  it("pide solo las llamadas de los closers (recorded_by[]) y desde la marca de agua menos 2 h", async () => {
    const w = world({ watermark: "2026-10-09T12:00:00Z" });
    const log: string[] = [];
    await syncFathomConnection(baseDeps(w, fathom({ pages: { first: { items: [] } }, log })), CONN);
    const url = new URL("https://x" + log[0]);
    expect(url.searchParams.getAll("recorded_by[]").sort()).toEqual(["ana.personal@gmail.com", "ana@negocio.io"]);
    expect(url.searchParams.get("created_after")).toBe(new Date(new Date("2026-10-09T12:00:00Z").getTime() - WATERMARK_OVERLAP_MS).toISOString());
  });

  it("la primera vez mira 14 dias hacia atras", async () => {
    const w = world();
    const log: string[] = [];
    await syncFathomConnection(baseDeps(w, fathom({ pages: { first: { items: [] } }, log })), CONN);
    expect(new URL("https://x" + log[0]).searchParams.get("created_after")).toBe(new Date(NOW.getTime() - INITIAL_WINDOW_MS).toISOString());
  });

  it("la misma reunion vista por dos conexiones es UNA sola fila", async () => {
    const w = world({ callsPre: ["1"] });
    const f = fathom({ pages: { first: { items: [meeting(1)] } }, log: [] });
    const r = await syncFathomConnection(baseDeps(w, f), CONN);
    expect(r.ingested).toBe(0);
    expect(w.calls).toHaveLength(1);
  });

  it("si otra conexion la inserta justo antes (23505), no es un error ni se duplica", async () => {
    const w = world();
    const racing = fakeDb({ ...{}, "calls:select": { data: [] }, "calls:insert": { error: { message: "dup", code: "23505" } }, "oauth_connections:select": () => ({ data: { ...w.conn } }), "oauth_connections:update": (c) => { Object.assign(w.conn, c.values); return { data: null }; }, "workspace_members:select": { data: [{ user_id: "user-ana", is_closer: true, closer_emails: [] }] }, "contacts:select": { data: [] } }, { workspace_member_profiles: { data: [{ user_id: "user-ana", email: "ana@negocio.io" }] } });
    const r = await syncFathomConnection({ ...baseDeps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] })), supabase: racing.client }, CONN);
    expect(r.outcome).toBe("complete");
    expect(r.ingested).toBe(0);
  });

  it("un 429 con Retry-After: 30 reencola a +30 s y la conexion sigue activa", async () => {
    const w = world();
    const f = fathom({ pages: {}, status: 429, headers: { "Retry-After": "30" }, log: [] });
    const r = await syncFathomConnection(baseDeps(w, f), CONN);
    expect(r.outcome).toBe("rate_limited");
    expect(w.conn.status).toBe("active");
    expect(w.conn.sync_last_error).toBe("Fathom pidió esperar");
    expect(new Date(w.jobs[0].run_at as string).getTime()).toBe(NOW.getTime() + 30_000);
  });

  it("un 502 deja la conexion activa con sync_last_error cargado", async () => {
    const w = world();
    const r = await syncFathomConnection(baseDeps(w, fathom({ pages: {}, status: 502, log: [] })), CONN);
    expect(r.outcome).toBe("temporary_error");
    expect(w.conn.status).toBe("active");
    expect(w.conn.sync_last_error).toContain("502");
    expect(w.conn.sync_cursor).toBeNull(); // no se invento una pasada a medias
  });

  it("una transcripcion que responde 404 guarda la llamada con transcripcion vacia y la encola para clasificar", async () => {
    const w = world();
    const f = fathom({ pages: { first: { items: [meeting(1)] } }, transcriptStatus: 404, log: [] });
    await syncFathomConnection(baseDeps(w, f), CONN);
    expect(w.calls[0]).toMatchObject({ external_id: "1", transcript: [] });
    expect(w.jobs.find((j) => j.type === "call_classify")).toMatchObject({ payload: { callId: "call-1" }, dedupe_key: "call_classify:call-1" });
  });

  it("un 401 fuerza UNA renovacion y reintenta; si vuelve el 401, la conexion cae y se avisa", async () => {
    const w = world();
    const get = vi.fn(async () => "TOKEN"), force = vi.fn(async () => "TOKEN-2");
    const f = fathom({ pages: {}, status: 401, log: [] });
    const r = await syncFathomConnection({ ...baseDeps(w, f), tokenProvider: { get, force } }, CONN);
    expect(force).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("reconnect");
    expect(w.conn.status).toBe("error");
  });

  it("la marca de agua avanza SOLO al terminar una pasada completa", async () => {
    const w = world({ watermark: "2026-10-01T00:00:00Z" });
    const f = fathom({ pages: { first: { items: Array.from({ length: 20 }, (_, i) => meeting(i + 1)) } }, log: [] });
    const deps = baseDeps(w, f);
    await syncFathomConnection(deps, CONN);
    expect(w.conn.sync_watermark).toBe("2026-10-01T00:00:00Z");
    await syncFathomConnection(deps, CONN);
    expect(w.conn.sync_watermark).toBe("2026-10-01T00:00:00Z");
    await syncFathomConnection(deps, CONN);
    expect(w.conn.sync_watermark! > "2026-10-01T00:00:00Z").toBe(true);
    expect(w.conn.last_synced_at).toBe(NOW.toISOString());
  });

  it("sin closers no pide nada; una conexion caida tampoco", async () => {
    const a = world({ closers: false });
    const log: string[] = [];
    expect((await syncFathomConnection(baseDeps(a, fathom({ pages: {}, log })), CONN)).outcome).toBe("no_closers");
    expect(log).toHaveLength(0);
    const b = world({ status: "revoked" });
    expect((await syncFathomConnection(baseDeps(b, fathom({ pages: {}, log })), CONN)).outcome).toBe("inactive");
    expect(log).toHaveLength(0);
  });

  it("una reunion sin recording_id se descarta", async () => {
    const w = world();
    const f = fathom({ pages: { first: { items: [{ ...meeting(1), recording_id: null }] } }, log: [] });
    await syncFathomConnection(baseDeps(w, f), CONN);
    expect(w.calls).toHaveLength(0);
  });

  it("la llamada nueva se audita como del webhook de Fathom", async () => {
    const w = world();
    await syncFathomConnection(baseDeps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] })), CONN);
    expect(w.audits[0]).toMatchObject({ entity_type: "call", action: "call.ingested", actor_type: "webhook", actor_label: "Fathom", performed_by: null });
  });

  it("nunca crea contactos", async () => {
    const w = world();
    await syncFathomConnection(baseDeps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] })), CONN);
    expect(w.db.writesTo("contacts")).toHaveLength(0);
    expect(w.db.rpcCalls.some((c) => c.name === "find_or_link_contact")).toBe(false);
    expect(w.calls[0]).toMatchObject({ contact_id: null, link_method: "none" });
  });

  it("vincula al contacto por el correo del invitado externo", async () => {
    const w = world();
    const db = fakeDb({
      ...{},
      "oauth_connections:select": () => ({ data: { ...w.conn } }),
      "oauth_connections:update": (c) => { Object.assign(w.conn, c.values); return { data: null }; },
      "workspace_members:select": { data: [{ user_id: "user-ana", is_closer: true, closer_emails: [] }] },
      "calls:select": { data: [] },
      "calls:insert": (c) => { w.calls.push(c.values as Record<string, unknown>); return { data: { id: "call-1" } }; },
      "contacts:select": { data: [{ id: "c-9", created_at: "2026-01-01T00:00:00Z", email: "Lead@X.com", secondary_email: null }] },
      "bookings:select": { data: [] },
      "audit_log:insert": { data: { id: "a" } },
      "scheduled_jobs:select": { data: [] },
      "scheduled_jobs:insert": { data: { id: "j" } },
    }, { workspace_member_profiles: { data: [{ user_id: "user-ana", email: "ana@negocio.io" }] } });
    const linked: unknown[] = [];
    await syncFathomConnection({ ...baseDeps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] })), supabase: db.client, onLinked: async (i) => { linked.push(i); } }, CONN);
    expect(w.calls[0]).toMatchObject({ contact_id: "c-9", link_method: "auto_email" });
    expect(linked).toEqual([{ callId: "call-1", contactId: "c-9", workspaceId: WS }]);
  });
});

describe("la clave de dedupe de la continuacion", () => {
  it("usa la misma clave que la funcion SQL", () => {
    expect(fathomSyncDedupeKey(CONN, NOW)).toMatch(/^fathom_sync:[0-9a-f-]{36}:\d+$/);
  });
});
