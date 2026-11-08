import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleFlowScheduledRun } from "./flow-scheduled-run";
import { SCHEDULED_RUN_JOB } from "@/lib/scheduled-flows/schedule";

/**
 * Un doble chico de Supabase en memoria: lo justo que usa el trabajo (select con `eq`, insert con los índices únicos
 * de `trigger_fires` y de la cola, y update). Sin red.
 */
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "update" = "select";
    let patch: Row = {};
    const rows = () => (tables[table] ??= []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const builder = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return builder;
      },
      limit: () => builder,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: (p: Row) => {
        op = "update";
        patch = p;
        return builder;
      },
      insert: async (row: Row) => {
        const list = (tables[table] ??= []);
        if (table === "trigger_fires" && list.some((r) => r.trigger_id === row.trigger_id && r.dedupe_key === row.dedupe_key)) {
          return { error: { code: "23505", message: "duplicate" } };
        }
        if (table === "scheduled_jobs" && list.some((r) => r.dedupe_key === row.dedupe_key && r.status === "pending")) {
          return { error: { code: "23505", message: "duplicate" } };
        }
        list.push({ status: "pending", ...row });
        return { error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "update") for (const r of rows()) Object.assign(r, patch);
        resolve({ data: null, error: null });
      },
    };
    return builder;
  };
  return { from } as never;
}

const WS = "ws-1";
const FLOW = "flow-1";
const BA = "America/Argentina/Buenos_Aires";
// Lunes 9/11/2026 a las 9 en Buenos Aires.
const MONDAY_9 = "2026-11-09T12:00:00.000Z";
const WEEKLY = { repeat: "weekly", weekdays: [1], time: "09:00" };

let tables: Record<string, Row[]>;
beforeEach(() => {
  tables = {
    flows: [{ id: FLOW, workspace_id: WS, status: "published", version: 4 }],
    triggers: [{ id: "trg-1", flow_id: FLOW, type: "scheduled_time", is_active: true, config: WEEKLY }],
    workspaces: [{ id: WS, timezone: BA }],
    trigger_fires: [],
    scheduled_jobs: [],
    flow_sessions: [],
  };
});

const job = (payload: Record<string, unknown>) => ({ id: "job-1", type: SCHEDULED_RUN_JOB, attempts: 0, payload });
const payload = (over: Record<string, unknown> = {}) => ({ workspaceId: WS, flowId: FLOW, version: 4, occurrence: MONDAY_9, ...over });
const at = (iso: string) => () => new Date(iso);

describe("flow_scheduled_run", () => {
  it("corre la vez sin contacto, con las variables de la fecha, y agenda la siguiente", async () => {
    const execute = vi.fn(async () => undefined);
    const outcome = await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload()) }, { execute, now: at("2026-11-09T12:00:30.000Z") });

    expect(outcome).toBe("ran");
    expect(execute).toHaveBeenCalledTimes(1);
    const context = (execute.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(context).toMatchObject({
      flowId: FLOW,
      workspaceId: WS,
      contactId: null,
      triggerId: "trg-1",
      source: { type: "system", id: `schedule:${MONDAY_9}` },
      variables: { schedule: { date: "9 de noviembre de 2026", weekday: "lunes", time: "09:00" } },
    });
    // La siguiente: el lunes 16, con la misma versión.
    expect(tables.scheduled_jobs).toHaveLength(1);
    expect(tables.scheduled_jobs[0]).toMatchObject({
      type: SCHEDULED_RUN_JOB,
      run_at: "2026-11-16T12:00:00.000Z",
      payload: { flowId: FLOW, version: 4, occurrence: "2026-11-16T12:00:00.000Z" },
    });
  });

  it("una misma vez no corre dos veces (un reintento del trabajo)", async () => {
    const execute = vi.fn(async () => undefined);
    const ctx = { supabase: fakeDb(tables), job: job(payload()) };
    await handleFlowScheduledRun(ctx, { execute, now: at("2026-11-09T12:00:30.000Z") });
    const second = await handleFlowScheduledRun(ctx, { execute, now: at("2026-11-09T12:01:00.000Z") });
    expect(second).toBe("already_ran");
    expect(execute).toHaveBeenCalledTimes(1);
    // Y la siguiente sigue siendo una sola.
    expect(tables.scheduled_jobs.filter((j) => j.status === "pending")).toHaveLength(1);
  });

  it("no corre ni agenda si se volvió a publicar, se despublicó o la config cambió", async () => {
    const execute = vi.fn(async () => undefined);
    expect(await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload({ version: 3 })) }, { execute })).toBe("stale_version");

    tables.flows[0].status = "draft";
    expect(await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload()) }, { execute })).toBe("not_published");

    tables.flows[0].status = "published";
    tables.triggers[0].config = { ...WEEKLY, time: "10:00" };
    expect(await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload()) }, { execute })).toBe("stale_schedule");

    tables.flows = [];
    expect(await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload()) }, { execute })).toBe("flow_gone");

    expect(execute).not.toHaveBeenCalled();
    expect(tables.scheduled_jobs).toHaveLength(0);
  });

  it("más de dos horas tarde saltea esa vez pero agenda la siguiente", async () => {
    const execute = vi.fn(async () => undefined);
    const outcome = await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload()) }, { execute, now: at("2026-11-09T15:00:00.000Z") });
    expect(outcome).toBe("too_late");
    expect(execute).not.toHaveBeenCalled();
    expect(tables.scheduled_jobs[0]).toMatchObject({ run_at: "2026-11-16T12:00:00.000Z" });
  });

  it("una sola vez no agenda nada después", async () => {
    tables.triggers[0].config = { repeat: "once", date: "2026-11-09", time: "09:00" };
    const execute = vi.fn(async () => undefined);
    expect(await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload()) }, { execute, now: at("2026-11-09T12:00:10.000Z") })).toBe("ran");
    expect(tables.scheduled_jobs).toHaveLength(0);
  });

  it("si el flujo revienta, la siguiente igual queda agendada y no lanza", async () => {
    const execute = vi.fn(async () => {
      throw new Error("se cayó la base");
    });
    const outcome = await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job(payload()) }, { execute, now: at("2026-11-09T12:00:30.000Z") });
    expect(outcome).toBe("failed");
    expect(tables.scheduled_jobs).toHaveLength(1);
  });

  it("un trabajo sin lo mínimo no hace nada", async () => {
    const execute = vi.fn(async () => undefined);
    expect(await handleFlowScheduledRun({ supabase: fakeDb(tables), job: job({ flowId: FLOW }) }, { execute })).toBe("invalid_payload");
    expect(execute).not.toHaveBeenCalled();
  });
});
