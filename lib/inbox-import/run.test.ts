import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/inbox-sync", () => ({ importInboxPage: vi.fn() }));

import { importInboxPage } from "@/lib/inbox-sync";
import {
  describeZernioFailure,
  INBOX_IMPORT_JOB,
  INBOX_IMPORT_PASS_JOB,
  runInboxImportPass,
  runInboxImportStep,
  startInboxImport,
  startInboxImports,
  type ImportDeps,
} from "./run";
import { newImportState, type InboxImportState } from "./state";

const importPage = vi.mocked(importInboxPage);
const NOW = new Date("2026-10-28T12:00:00Z");

interface ChannelRow {
  id: string;
  workspace_id: string;
  late_account_id: string;
  platform: string;
  provider: string;
  is_active: boolean;
  inbox_import: unknown;
}

/** Un `channels` en memoria: lectura por id + workspace y update con los filtros de la corrida. */
function makeDb(rows: ChannelRow[]) {
  const writes: InboxImportState[] = [];
  const db = {
    from(table: string) {
      if (table !== "channels") throw new Error(`tabla inesperada ${table}`);
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const q = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return q;
            },
            maybeSingle() {
              const row = rows.find((r) => r.id === filters.id && r.workspace_id === filters.workspace_id);
              return Promise.resolve({ data: row ? { ...row } : null, error: null });
            },
          };
          return q;
        },
        update(patch: { inbox_import: InboxImportState }) {
          const filters: Record<string, unknown> = {};
          const apply = () => {
            const matches = rows.filter((r) => {
              if (r.id !== filters.id) return false;
              const cur = r.inbox_import as InboxImportState | null;
              if ("inbox_import->>run_id" in filters && cur?.run_id !== filters["inbox_import->>run_id"]) return false;
              if ("inbox_import->>step" in filters && String(cur?.step) !== filters["inbox_import->>step"]) return false;
              return true;
            });
            for (const r of matches) {
              r.inbox_import = JSON.parse(JSON.stringify(patch.inbox_import));
              writes.push(r.inbox_import as InboxImportState);
            }
            return matches;
          };
          const q = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return q;
            },
            select() {
              return Promise.resolve({ data: apply().map((r) => ({ id: r.id })), error: null });
            },
            then(resolve: (v: { data: null; error: null }) => unknown) {
              apply();
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return q;
        },
      };
    },
  };
  return { db: db as never, rows, writes };
}

function channel(over: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "ch-1",
    workspace_id: "ws-1",
    late_account_id: "acc-1",
    platform: "instagram",
    provider: "zernio",
    is_active: true,
    inbox_import: null,
    ...over,
  };
}

function deps(over: Partial<ImportDeps> = {}) {
  const schedule = vi.fn().mockResolvedValue({ id: "job" });
  return {
    schedule,
    d: {
      now: () => NOW,
      keyState: async () => ({ state: "present" as const, key: "k" }),
      createClient: () => ({}) as never,
      schedule,
      newRunId: () => "run-1",
      ...over,
    } satisfies ImportDeps,
  };
}

function pageResult(over: Partial<Awaited<ReturnType<typeof importInboxPage>>> = {}) {
  return { received: 50, imported: 50, hasMore: true, nextCursor: "c-2", accountFailure: null, ...over };
}

beforeEach(() => importPage.mockReset());

describe("startInboxImport", () => {
  it("arma la corrida y encola su primera vuelta", async () => {
    const { db, rows } = makeDb([channel()]);
    const { d, schedule } = deps();

    const res = await startInboxImport(db, { workspaceId: "ws-1", channelId: "ch-1" }, { pass: "auto" }, d);

    expect(res).toEqual({ started: true, runId: "run-1", pass: 1 });
    expect(rows[0].inbox_import).toMatchObject({ run_id: "run-1", status: "running", pass: 1, step: 0 });
    expect(schedule).toHaveBeenCalledWith(
      db,
      INBOX_IMPORT_JOB,
      { workspaceId: "ws-1", channelId: "ch-1", runId: "run-1", step: 0 },
      NOW,
      "inbox_import:ch-1:run-1:0",
    );
  });

  it("no arma otra mientras una esta corriendo (dos clics a Sincronizar)", async () => {
    const { db } = makeDb([channel({ inbox_import: newImportState(1, "vieja", new Date(NOW.getTime() - 60_000)) })]);
    const { d, schedule } = deps();

    const res = await startInboxImport(db, { workspaceId: "ws-1", channelId: "ch-1" }, { pass: "auto" }, d);

    expect(res).toEqual({ started: false, reason: "running" });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("en un canal ya importado, Sincronizar es una pasada suelta", async () => {
    const done = { ...newImportState(1, "vieja", NOW), status: "done" as const };
    const { db } = makeDb([channel({ inbox_import: done })]);
    const { d } = deps();

    const res = await startInboxImport(db, { workspaceId: "ws-1", channelId: "ch-1" }, { pass: "auto" }, d);

    expect(res).toMatchObject({ started: true, pass: "manual" });
  });

  it("el canal se busca con el workspace de quien llama: el de otro no existe", async () => {
    const { db } = makeDb([channel({ workspace_id: "ws-otro" })]);
    const { d } = deps();

    expect(await startInboxImport(db, { workspaceId: "ws-1", channelId: "ch-1" }, { pass: 1 }, d)).toEqual({
      started: false,
      reason: "not_found",
    });
  });

  it("un canal desactivado o que no es de Zernio no se importa", async () => {
    const { db } = makeDb([channel({ is_active: false }), channel({ id: "ch-2", provider: "evolution" })]);
    const { d } = deps();

    expect(await startInboxImport(db, { workspaceId: "ws-1", channelId: "ch-1" }, { pass: 1 }, d)).toMatchObject({ reason: "inactive" });
    expect(await startInboxImport(db, { workspaceId: "ws-1", channelId: "ch-2" }, { pass: 1 }, d)).toMatchObject({ reason: "not_zernio" });
  });

  it("si no se puede encolar, queda en error con el motivo (no corriendo para siempre)", async () => {
    const { db, rows } = makeDb([channel()]);
    const { d } = deps({ schedule: vi.fn().mockRejectedValue(new Error("cola caida")) });

    const res = await startInboxImport(db, { workspaceId: "ws-1", channelId: "ch-1" }, { pass: 1 }, d);

    expect(res).toEqual({ started: false, reason: "queue" });
    expect(rows[0].inbox_import).toMatchObject({ status: "error" });
  });

  it("varios canales: uno que falla no frena a los otros", async () => {
    const { db } = makeDb([channel(), channel({ id: "ch-2" })]);
    let n = 0;
    const { d } = deps({ newRunId: () => `run-${++n}` });

    const res = await startInboxImports(db, "ws-1", ["ch-1", "ch-x", "ch-2"], 1, d);

    expect(res).toEqual({ started: 2, running: 0 });
  });
});

describe("runInboxImportStep", () => {
  function running(over: Partial<InboxImportState> = {}): InboxImportState {
    return { ...newImportState(1, "run-1", NOW), ...over };
  }
  const payload = { workspaceId: "ws-1", channelId: "ch-1", runId: "run-1", step: 0 };

  it("lee dos paginas por vuelta, guarda el avance y encola la siguiente enseguida", async () => {
    const { db, rows } = makeDb([channel({ inbox_import: running() })]);
    const { d, schedule } = deps();
    importPage.mockResolvedValueOnce(pageResult({ nextCursor: "c-2" })).mockResolvedValueOnce(pageResult({ nextCursor: "c-3", imported: 20 }));

    expect(await runInboxImportStep(db, payload, d)).toBe("continued");

    expect(importPage).toHaveBeenCalledTimes(2);
    expect(importPage.mock.calls[1][0]).toMatchObject({ phase: "active", cursor: "c-2", pageSize: 50 });
    expect(rows[0].inbox_import).toMatchObject({ step: 1, cursor: "c-3", scanned: 100, imported: 70 });
    expect(schedule).toHaveBeenCalledWith(
      db,
      INBOX_IMPORT_JOB,
      { workspaceId: "ws-1", channelId: "ch-1", runId: "run-1", step: 1 },
      NOW,
      "inbox_import:ch-1:run-1:1",
    );
  });

  it("recorre todo, sin tope de 200: siete paginas de las activas y despues las archivadas", async () => {
    const { db, rows } = makeDb([channel({ inbox_import: running() })]);
    const { d } = deps();
    for (let i = 1; i <= 6; i++) importPage.mockResolvedValueOnce(pageResult({ nextCursor: `c-${i + 1}` }));
    importPage.mockResolvedValueOnce(pageResult({ hasMore: false, nextCursor: null }));
    importPage.mockResolvedValueOnce(pageResult({ received: 10, imported: 10, hasMore: false, nextCursor: null }));

    let step = 0;
    let outcome = "";
    while (outcome !== "finished") {
      outcome = await runInboxImportStep(db, { ...payload, step }, d);
      step += 1;
    }

    expect(rows[0].inbox_import).toMatchObject({ status: "done", phase: "archived", scanned: 360, imported: 360 });
    expect(importPage.mock.calls.map((c) => c[0].phase)).toEqual([...Array(7).fill("active"), "archived"]);
  });

  it("al terminar la pasada 1 agenda la de 24 horas", async () => {
    const { db } = makeDb([channel({ inbox_import: running({ phase: "archived" }) })]);
    const { d, schedule } = deps();
    importPage.mockResolvedValueOnce(pageResult({ hasMore: false, nextCursor: null }));

    expect(await runInboxImportStep(db, payload, d)).toBe("finished");

    expect(schedule).toHaveBeenCalledWith(
      db,
      INBOX_IMPORT_PASS_JOB,
      { workspaceId: "ws-1", channelId: "ch-1", pass: 2 },
      new Date(NOW.getTime() + 24 * 60 * 60_000),
      "inbox_import_pass:ch-1:2",
    );
  });

  it("un 429 reagenda la MISMA pagina al minuto y no lanza", async () => {
    const { db, rows } = makeDb([channel({ inbox_import: running({ cursor: "c-5" }) })]);
    const { d, schedule } = deps();
    importPage.mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { statusCode: 429 }));

    expect(await runInboxImportStep(db, payload, d)).toBe("waiting");

    expect(importPage).toHaveBeenCalledTimes(1);
    expect(rows[0].inbox_import).toMatchObject({ status: "running", cursor: "c-5", retries: 1, step: 1 });
    expect(schedule.mock.calls[0][3]).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it("agotados los reintentos queda incompleta, con lo ya importado", async () => {
    const { db, rows } = makeDb([channel({ inbox_import: running({ retries: 3, imported: 140 }) })]);
    const { d } = deps();
    importPage.mockRejectedValueOnce(Object.assign(new Error("Bad Gateway"), { statusCode: 502 }));

    expect(await runInboxImportStep(db, payload, d)).toBe("finished");

    expect(rows[0].inbox_import).toMatchObject({ status: "partial", imported: 140 });
    expect((rows[0].inbox_import as InboxImportState).last_error).toMatch(/502/);
  });

  it("el aviso de Zernio de que la cuenta fallo se espera como un 429", async () => {
    const { db, rows } = makeDb([channel({ inbox_import: running() })]);
    const { d } = deps();
    importPage.mockResolvedValueOnce(pageResult({ accountFailure: "Meta rate limit", received: 0, imported: 0, hasMore: false, nextCursor: null }));

    expect(await runInboxImportStep(db, payload, d)).toBe("waiting");
    expect((rows[0].inbox_import as InboxImportState).last_error).toMatch(/Meta rate limit/);
  });

  it("sin clave de Zernio queda incompleta sin esperar ni llamar a Zernio", async () => {
    const { db, rows } = makeDb([channel({ inbox_import: running() })]);
    const { d } = deps({ keyState: async () => ({ state: "absent" as const }) });

    expect(await runInboxImportStep(db, payload, d)).toBe("no_key");

    expect(importPage).not.toHaveBeenCalled();
    expect((rows[0].inbox_import as InboxImportState).last_error).toMatch(/Falta la clave/);
  });

  it("si no se pudo leer la clave (Vault), espera y reintenta", async () => {
    const { db } = makeDb([channel({ inbox_import: running() })]);
    const { d } = deps({ keyState: async () => ({ state: "unknown" as const }) });

    expect(await runInboxImportStep(db, payload, d)).toBe("waiting");
    expect(importPage).not.toHaveBeenCalled();
  });

  it("una vuelta de una corrida vieja no sigue", async () => {
    const { db } = makeDb([channel({ inbox_import: running({ run_id: "run-nueva" }) })]);
    const { d, schedule } = deps();

    expect(await runInboxImportStep(db, payload, d)).toBe("superseded");
    expect(importPage).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("la misma vuelta repetida por la cola no avanza dos veces", async () => {
    const { db } = makeDb([channel({ inbox_import: running({ step: 1 }) })]);
    const { d } = deps();

    expect(await runInboxImportStep(db, payload, d)).toBe("superseded");
  });

  it("si otra vuelta gano mientras esta leia, esta no escribe ni encola", async () => {
    const row = channel({ inbox_import: running() });
    const { db } = makeDb([row]);
    const { d, schedule } = deps();
    importPage.mockImplementationOnce(async () => {
      // Mientras tanto alguien arranco otra corrida.
      row.inbox_import = newImportState("manual", "run-otra", NOW);
      return pageResult();
    });
    importPage.mockResolvedValueOnce(pageResult({ nextCursor: "c-3" }));

    expect(await runInboxImportStep(db, payload, d)).toBe("superseded");
    expect(schedule).not.toHaveBeenCalled();
    expect((row.inbox_import as InboxImportState).run_id).toBe("run-otra");
  });

  it("un canal desactivado a mitad de camino corta sin error", async () => {
    const { db } = makeDb([channel({ is_active: false, inbox_import: running() })]);
    const { d } = deps();

    expect(await runInboxImportStep(db, payload, d)).toBe("channel_gone");
  });
});

describe("runInboxImportPass", () => {
  it("arranca la pasada que le toca", async () => {
    const done = { ...newImportState(1, "vieja", NOW), status: "done" as const };
    const { db, rows } = makeDb([channel({ inbox_import: done })]);
    const { d } = deps();

    expect(await runInboxImportPass(db, { workspaceId: "ws-1", channelId: "ch-1", pass: 2 }, d)).toMatchObject({ started: true, pass: 2 });
    expect(rows[0].inbox_import).toMatchObject({ pass: 2, status: "running" });
  });

  it("si hay otra corrida en marcha, se corre una hora en vez de perderse", async () => {
    const { db } = makeDb([channel({ inbox_import: newImportState("manual", "otra", NOW) })]);
    const { d, schedule } = deps();

    await runInboxImportPass(db, { workspaceId: "ws-1", channelId: "ch-1", pass: 3 }, d);

    expect(schedule).toHaveBeenCalledWith(
      db,
      INBOX_IMPORT_PASS_JOB,
      { workspaceId: "ws-1", channelId: "ch-1", pass: 3 },
      new Date(NOW.getTime() + 60 * 60_000),
      "inbox_import_pass:ch-1:3",
    );
  });
});

describe("describeZernioFailure", () => {
  it("429, 5xx y sin codigo (red) se esperan; 401 y 403 son la clave; otro 4xx no se espera", () => {
    expect(describeZernioFailure(429).temporary).toBe(true);
    expect(describeZernioFailure(503).temporary).toBe(true);
    expect(describeZernioFailure(undefined).temporary).toBe(true);
    expect(describeZernioFailure(401)).toMatchObject({ temporary: false, message: expect.stringMatching(/clave/) });
    expect(describeZernioFailure(404).temporary).toBe(false);
  });
});
