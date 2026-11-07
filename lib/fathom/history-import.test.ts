import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { FATHOM_HISTORY_IMPORT_JOB, resumeHistoryImport, runFathomHistoryImport, startHistoryImport, stopHistoryImport, type HistoryDeps } from "./history-import";
import { newHistoryState, type FathomHistoryState } from "./history-state";

const WS = "ws-1";
const CONN = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-06T12:00:00.000Z");
const BEFORE = "2026-10-01T00:00:00.000Z";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const meeting = (i: number, email = "ana@negocio.io") => ({
  recording_id: i,
  created_at: "2026-06-01T10:00:00Z",
  recorded_by: { email },
  title: `Llamada ${i}`,
  calendar_invitees: [{ name: "Lead", email: "lead@x.com", is_external: true }],
});

function world(opts: { state?: FathomHistoryState | null; watermark?: string | null; status?: string; permission?: boolean; contact?: boolean; settings?: unknown } = {}) {
  const conn: Record<string, unknown> = {
    id: CONN, workspace_id: WS, user_id: "user-ana", status: opts.status ?? "active", vault_secret_prefix: "oauth_fathom_c1",
    token_expires_at: "2026-11-06T19:00:00Z", account_label: "ana@negocio.io",
    sync_watermark: opts.watermark ?? BEFORE, sync_cursor: null, sync_last_error: null, fathom_settings: opts.settings ?? {},
    history_import: opts.state === undefined ? newHistoryState({ runId: "run-1", from: null, before: BEFORE, now: NOW }) : opts.state,
  };
  const calls: Array<Record<string, unknown>> = [];
  const jobs: Array<Record<string, unknown>> = [];
  const db = fakeDb(
    {
      "oauth_connections:select": () => ({ data: { ...conn } }),
      "oauth_connections:update": (c) => {
        // Como la base: el avance solo se escribe si la corrida y el paso siguen siendo los esperados.
        const current = conn.history_import as FathomHistoryState | null;
        const runId = c.filters.find((f) => f.column === "history_import->>run_id");
        const step = c.filters.find((f) => f.column === "history_import->>step");
        if (runId && (runId.value !== current?.run_id || step?.value !== String(current?.step))) return { data: [] };
        Object.assign(conn, c.values);
        return { data: [{ id: CONN }] };
      },
      "workspace_members:select": { data: [{ user_id: "user-ana", role: "member", role_id: opts.permission === false ? "rol-sin" : null, closer_emails: [] }] },
      "workspace_roles:select": { data: [{ id: "rol-sin", system_role: null, permissions: { keys: [] } }] },
      "calls:select": (c) => {
        const ids = (c.filters.find((f) => f.method === "in")?.value ?? []) as string[];
        return { data: calls.filter((x) => ids.includes(String(x.external_id))).map((x) => ({ external_id: x.external_id })) };
      },
      "calls:insert": (c) => { calls.push({ ...(c.values as object), id: `call-${calls.length + 1}` }); return { data: { id: `call-${calls.length}` } }; },
      "contacts:select": { data: opts.contact ? [{ id: "c-9", created_at: "2026-01-01T00:00:00Z", email: "lead@x.com", secondary_email: null }] : [] },
      "bookings:select": { data: [] },
      "audit_log:insert": { data: { id: "a" } },
      "scheduled_jobs:select": { data: [] },
      "scheduled_jobs:insert": (c) => { jobs.push({ ...(c.values as object), status: "pending" }); return { data: { id: "j" } }; },
    },
    {
      workspace_member_profiles: { data: [{ user_id: "user-ana", email: "ana@negocio.io" }] },
      find_or_create_contact: { data: { contact_id: opts.contact ? "c-9" : null, created: false, matched_by: "email", conflicts: [], status: opts.contact ? "found" : "not_found" } },
    },
  );
  const state = () => conn.history_import as FathomHistoryState;
  return { conn, calls, jobs, db, state };
}

interface FathomWorld { pages: Record<string, { items: unknown[]; next?: string }>; status?: number; headers?: Record<string, string>; log: string[] }
function fathom(w: FathomWorld) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    w.log.push(url.pathname + url.search);
    if (url.pathname.endsWith("/meetings")) {
      if (w.status) return json({}, w.status, w.headers);
      const page = w.pages[url.searchParams.get("cursor") ?? "first"];
      return json({ items: page?.items ?? [], next_cursor: page?.next ?? null });
    }
    return json({ transcript: [{ speaker: { display_name: "Ana" }, text: "Hola", timestamp: "00:00:01" }] });
  });
}

const deps = (w: ReturnType<typeof world>, fetchImpl: unknown, over: Partial<HistoryDeps> = {}): HistoryDeps => ({
  supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW,
  tokenProvider: { get: async () => "TOKEN", force: async () => "TOKEN-2" },
  ...over,
});
const payload = (step = 0) => ({ connectionId: CONN, runId: "run-1", step });

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("runFathomHistoryImport", () => {
  it("trae las paginas, marca lo importado como historia y termina", async () => {
    const w = world();
    const f = fathom({ pages: { first: { items: [meeting(1)], next: "C2" }, C2: { items: [meeting(2)] } }, log: [] });
    expect(await runFathomHistoryImport(deps(w, f), payload())).toBe("finished");
    expect(w.calls.map((c) => c.external_id)).toEqual(["1", "2"]);
    expect(w.calls.every((c) => c.imported_from_history === true)).toBe(true);
    expect(w.state()).toMatchObject({ status: "done", imported: 2 });
    expect(w.jobs.filter((j) => j.type === FATHOM_HISTORY_IMPORT_JOB)).toHaveLength(0);
  });

  it("pide solo el rango y solo lo que grabo esa persona", async () => {
    const w = world({ state: newHistoryState({ runId: "run-1", from: "2026-01-01T12:00:00.000Z", before: BEFORE, now: NOW }) });
    const log: string[] = [];
    await runFathomHistoryImport(deps(w, fathom({ pages: { first: { items: [] } }, log })), payload());
    const url = new URL("https://x" + log[0]);
    expect(url.searchParams.get("created_after")).toBe("2026-01-01T12:00:00.000Z");
    expect(url.searchParams.get("created_before")).toBe(BEFORE);
    expect(url.searchParams.getAll("recorded_by[]")).toEqual(["ana@negocio.io"]);
  });

  it("lo que grabo otra persona no entra", async () => {
    const w = world();
    await runFathomHistoryImport(deps(w, fathom({ pages: { first: { items: [meeting(1, "beto@negocio.io")] } }, log: [] })), payload());
    expect(w.calls).toHaveLength(0);
    expect(w.state()).toMatchObject({ status: "done", imported: 0 });
  });

  it("no pasa de 9 pedidos por vuelta, se reencola a +70 s y la vuelta siguiente sigue sin duplicar", async () => {
    const w = world();
    const f = fathom({ pages: { first: { items: Array.from({ length: 20 }, (_, i) => meeting(i + 1)) } }, log: [] });
    const d = deps(w, f);

    expect(await runFathomHistoryImport(d, payload(0))).toBe("continued");
    expect(f.mock.calls.length).toBeLessThanOrEqual(9);
    expect(w.state()).toMatchObject({ status: "running", imported: 8, step: 1 });
    const job = w.jobs.find((j) => j.type === FATHOM_HISTORY_IMPORT_JOB)!;
    expect(new Date(job.run_at as string).getTime()).toBe(NOW.getTime() + 70_000);
    expect(job.payload).toEqual({ connectionId: CONN, runId: "run-1", step: 1 });

    expect(await runFathomHistoryImport(d, payload(1))).toBe("continued");
    expect(await runFathomHistoryImport(d, payload(2))).toBe("finished");
    expect(w.calls).toHaveLength(20);
    expect(new Set(w.calls.map((c) => c.external_id)).size).toBe(20);
    expect(w.state()).toMatchObject({ status: "done", imported: 20 });
  });

  it("NO dispara call_linked aunque la llamada se vincule a un contacto", async () => {
    const w = world({ contact: true });
    const onLinked = vi.fn();
    await runFathomHistoryImport(deps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] }), { onLinked }), payload());
    expect(w.calls[0]).toMatchObject({ contact_id: "c-9", imported_from_history: true });
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("igual se manda a clasificar", async () => {
    const w = world();
    await runFathomHistoryImport(deps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] })), payload());
    expect(w.jobs.find((j) => j.type === "call_classify")).toBeTruthy();
  });

  it("una vuelta vieja, repetida o de una importacion frenada no hace nada", async () => {
    const f = fathom({ pages: { first: { items: [meeting(1)] } }, log: [] });
    const repetida = world();
    expect(await runFathomHistoryImport(deps(repetida, f), payload(5))).toBe("superseded");
    const otra = world();
    expect(await runFathomHistoryImport(deps(otra, f), { connectionId: CONN, runId: "vieja", step: 0 })).toBe("superseded");
    const frenada = world({ state: { ...newHistoryState({ runId: "run-1", from: null, before: BEFORE, now: NOW }), status: "stopped" } });
    expect(await runFathomHistoryImport(deps(frenada, f), payload())).toBe("superseded");
    expect(f).not.toHaveBeenCalled();
  });

  it("si la frenan a mitad de la vuelta, esa vuelta no pisa el frenado ni se reencola", async () => {
    const w = world();
    const items = Array.from({ length: 20 }, (_, i) => meeting(i + 1));
    const base = fathom({ pages: { first: { items } }, log: [] });
    const f = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/meetings") && w.state().status === "running") await stopHistoryImport({ supabase: w.db.client, now: () => NOW }, CONN);
      return base(input);
    });
    expect(await runFathomHistoryImport(deps(w, f), payload())).toBe("superseded");
    expect(w.state().status).toBe("stopped");
    expect(w.jobs.filter((j) => j.type === FATHOM_HISTORY_IMPORT_JOB)).toHaveLength(0);
  });

  it("un 429 respeta el Retry-After, no lanza y deja la conexion activa", async () => {
    const w = world();
    const f = fathom({ pages: {}, status: 429, headers: { "Retry-After": "120" }, log: [] });
    expect(await runFathomHistoryImport(deps(w, f), payload())).toBe("continued");
    expect(w.conn.status).toBe("active");
    expect(w.state()).toMatchObject({ status: "running", retries: 1 });
    const job = w.jobs.find((j) => j.type === FATHOM_HISTORY_IMPORT_JOB)!;
    expect(new Date(job.run_at as string).getTime()).toBe(NOW.getTime() + 120_000);
  });

  it("un 502 espera y agotados los reintentos queda incompleta", async () => {
    const w = world();
    const f = fathom({ pages: {}, status: 502, log: [] });
    expect(await runFathomHistoryImport(deps(w, f), payload(0))).toBe("continued");
    expect(await runFathomHistoryImport(deps(w, f), payload(1))).toBe("continued");
    expect(await runFathomHistoryImport(deps(w, f), payload(2))).toBe("continued");
    expect(await runFathomHistoryImport(deps(w, f), payload(3))).toBe("finished");
    expect(w.state().status).toBe("partial");
    expect(w.conn.status).toBe("active");
  });

  it("un 401 que sobrevive a la renovacion deja la conexion caida y la importacion incompleta", async () => {
    const w = world();
    const f = fathom({ pages: {}, status: 401, log: [] });
    expect(await runFathomHistoryImport(deps(w, f), payload())).toBe("finished");
    expect(w.conn.status).toBe("error");
    expect(w.state().status).toBe("partial");
    expect(w.state().last_error).toContain("reconect");
  });

  it("sin calls.view no consulta a Fathom y queda incompleta con el motivo", async () => {
    const w = world({ permission: false });
    const f = fathom({ pages: {}, log: [] });
    expect(await runFathomHistoryImport(deps(w, f), payload())).toBe("finished");
    expect(f).not.toHaveBeenCalled();
    expect(w.state().status).toBe("partial");
    expect(w.state().last_error).toContain("permiso");
  });

  it("desconectada: no consulta a Fathom", async () => {
    const w = world({ status: "revoked" });
    const f = fathom({ pages: {}, log: [] });
    expect(await runFathomHistoryImport(deps(w, f), payload())).toBe("finished");
    expect(f).not.toHaveBeenCalled();
    expect(w.state().status).toBe("partial");
  });
});

describe("arrancar, seguir y frenar", () => {
  const control = (w: ReturnType<typeof world>) => ({ supabase: w.db.client, now: () => NOW });

  it("arranca con el limite en la marca de agua y encola la primera vuelta", async () => {
    const w = world({ state: null, watermark: "2026-10-20T00:00:00.000Z" });
    expect(await startHistoryImport(control(w), CONN, "2026-01-01T12:00:00.000Z")).toEqual({ ok: true });
    expect(w.state()).toMatchObject({ status: "running", from: "2026-01-01T12:00:00.000Z", before: "2026-10-20T00:00:00.000Z", step: 0 });
    expect(w.jobs.find((j) => j.type === FATHOM_HISTORY_IMPORT_JOB)).toBeTruthy();
  });

  it("no arma dos corridas a la vez", async () => {
    const w = world();
    const r = await startHistoryImport(control(w), CONN, null);
    expect(r).toEqual({ ok: false, error: "Ya hay una importación en curso" });
    expect(w.jobs).toHaveLength(0);
  });

  it("una fecha que ya cubre la consulta normal se rechaza", async () => {
    const w = world({ state: null, watermark: "2026-10-20T00:00:00.000Z" });
    const r = await startHistoryImport(control(w), CONN, "2026-11-01T12:00:00.000Z");
    expect(r.ok).toBe(false);
    expect(w.jobs).toHaveLength(0);
  });

  it("seguir retoma la misma pagina", async () => {
    const w = world({ state: { ...newHistoryState({ runId: "run-1", from: null, before: BEFORE, now: NOW }), status: "partial", cursor: "C7", imported: 30, step: 4 } });
    expect(await resumeHistoryImport(control(w), CONN)).toEqual({ ok: true });
    expect(w.state()).toMatchObject({ status: "running", cursor: "C7", imported: 30, step: 5 });
    expect(w.jobs.find((j) => j.type === FATHOM_HISTORY_IMPORT_JOB)?.payload).toEqual({ connectionId: CONN, runId: "run-1", step: 5 });
  });

  it("no sigue una que ya termino ni frena una que no corre", async () => {
    const hecha = world({ state: { ...newHistoryState({ runId: "run-1", from: null, before: BEFORE, now: NOW }), status: "done" } });
    expect((await resumeHistoryImport(control(hecha), CONN)).ok).toBe(false);
    expect((await stopHistoryImport(control(hecha), CONN)).ok).toBe(false);
  });
});

describe("la importacion y lo que elige cada conexion", () => {
  const control = (w: ReturnType<typeof world>) => ({ supabase: w.db.client, now: () => NOW });

  it("aplica las reglas de la conexion", async () => {
    const w = world({ settings: { mode: "rules", rules: { title_contains: ["demo"] } } });
    const f = fathom({ pages: { first: { items: [{ ...meeting(1), title: "Demo" }, meeting(2)] } }, log: [] });
    await runFathomHistoryImport(deps(w, f), payload());
    expect(w.calls.map((c) => c.external_id)).toEqual(["1"]);
    expect(w.state()).toMatchObject({ status: "done", imported: 1 });
  });

  it("sin el pedido, lo importado no gasta IA al clasificarse", async () => {
    const w = world();
    const enqueue = vi.fn(async () => undefined);
    await runFathomHistoryImport(deps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] }), { enqueueClassify: enqueue }), payload());
    expect(enqueue).toHaveBeenCalledWith(expect.any(String), { noAi: true });
  });

  it("con el pedido, se clasifica con IA", async () => {
    const w = world({ state: newHistoryState({ runId: "run-1", from: null, before: BEFORE, now: NOW, classifyAi: true }) });
    const enqueue = vi.fn(async () => undefined);
    await runFathomHistoryImport(deps(w, fathom({ pages: { first: { items: [meeting(1)] } }, log: [] }), { enqueueClassify: enqueue }), payload());
    expect(enqueue).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it("en manual llega hasta ahora mismo: no hay consulta que cubra lo reciente", async () => {
    const w = world({ state: null, settings: { mode: "manual" } });
    expect(await startHistoryImport(control(w), CONN, null)).toEqual({ ok: true });
    expect(w.state().before).toBe(NOW.toISOString());
  });

  it("en manual se puede importar lo de hoy", async () => {
    const w = world({ state: null, settings: { mode: "manual" } });
    expect(await startHistoryImport(control(w), CONN, new Date(NOW.getTime() - 3600_000).toISOString())).toEqual({ ok: true });
  });

  it("quien salio de manual importa hasta el momento en que paso a automatico", async () => {
    const since = new Date(NOW.getTime() - 3600_000).toISOString();
    const w = world({ state: null, watermark: BEFORE, settings: { mode: "auto", auto_since: since } });
    await startHistoryImport(control(w), CONN, null);
    expect(w.state().before).toBe(since);
  });

  it("guarda el pedido de usar IA", async () => {
    const w = world({ state: null });
    await startHistoryImport(control(w), CONN, null, { classifyAi: true });
    expect(w.state().classify_ai).toBe(true);
  });
});
