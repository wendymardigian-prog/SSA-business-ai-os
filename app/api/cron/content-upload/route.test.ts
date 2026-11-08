/**
 * La ruta de subidas escribia `completed_at` y `error` en `scheduled_jobs`,
 * dos columnas que no existen: PostgREST rechazaba el UPDATE, el codigo no lo
 * miraba y el job quedaba en `processing` hasta que otra corrida lo volvia a
 * tomar. Estos tests recorren los cuatro finales de un job y comparan cada
 * UPDATE con las columnas reales (el tipo `Update` de lib/types/database.ts).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  /** El error que devuelve la base en los UPDATE que no son el claim. */
  saveError: null as { message: string } | null,
  handler: undefined as undefined | ((args: unknown) => Promise<void>),
}));

vi.mock("@/lib/cron-auth", () => ({ authorizeCronRequest: () => null }));
vi.mock("@/lib/publishing/bootstrap", () => ({ registerPublishing: () => {} }));
vi.mock("@/lib/content/jobs", () => ({ SLOW_JOB_TYPES: ["content_upload"] }));
vi.mock("@/lib/jobs/registry", () => ({ getJobHandler: () => state.handler }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from(table: string) {
      expect(table).toBe("scheduled_jobs");
      let isUpdate = false;
      const q = {
        select: () => q,
        in: () => q,
        or: () => q,
        lte: () => q,
        order: () => q,
        eq: () => q,
        limit: () => Promise.resolve({ data: state.jobs, error: null }),
        update(payload: Record<string, unknown>) {
          isUpdate = true;
          state.updates.push(payload);
          return q;
        },
        // El claim: siempre lo gana esta corrida.
        maybeSingle: () => Promise.resolve({ data: { id: "job-1" }, error: null }),
        then(resolve: (v: unknown) => void) {
          expect(isUpdate).toBe(true);
          resolve({ data: null, error: state.saveError });
        },
      };
      return q;
    },
  }),
}));

import { GET } from "./route";

/** Las columnas que se pueden escribir en `scheduled_jobs`, leidas del tipo. */
function writableColumns(): string[] {
  const src = readFileSync(path.join(process.cwd(), "lib/types/database.ts"), "utf8");
  const table = src.slice(src.indexOf("scheduled_jobs: {"));
  const update = table.slice(table.indexOf("Update: {"));
  const block = update.slice(0, update.indexOf("};"));
  return [...block.matchAll(/^\s*(\w+)\?:/gm)].map((m) => m[1]);
}

const request = {} as NextRequest;

function job(attempts: number) {
  return { id: "job-1", type: "content_upload", status: "pending", attempts, payload: {} };
}

beforeEach(() => {
  state.jobs = [];
  state.updates = [];
  state.saveError = null;
  state.handler = undefined;
});

afterEach(() => vi.restoreAllMocks());

describe("cron/content-upload: lo que escribe en scheduled_jobs", () => {
  it("el tipo Update de scheduled_jobs se puede leer", () => {
    expect(writableColumns()).toEqual(expect.arrayContaining(["status", "attempts", "last_error", "claimed_at", "run_at"]));
    expect(writableColumns()).not.toContain("error");
    expect(writableColumns()).not.toContain("completed_at");
  });

  const cases: Array<{ name: string; attempts: number; handler?: (args: unknown) => Promise<void>; final: Record<string, unknown> }> = [
    { name: "sin handler", attempts: 0, final: { status: "failed", last_error: 'sin handler para "content_upload"' } },
    { name: "sale bien", attempts: 0, handler: async () => {}, final: { status: "completed" } },
    {
      name: "falla y se reintenta",
      attempts: 0,
      handler: async () => {
        throw new Error("YouTube caido");
      },
      final: { status: "pending", attempts: 1, last_error: "YouTube caido", claimed_at: null },
    },
    {
      name: "falla por ultima vez",
      attempts: 2,
      handler: async () => {
        throw new Error("YouTube caido");
      },
      final: { status: "failed", attempts: 3, last_error: "YouTube caido" },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: solo escribe columnas que existen`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      state.jobs = [job(c.attempts)];
      state.handler = c.handler;

      const res = await GET(request);
      expect(res.status).toBe(200);

      // El claim y el final.
      expect(state.updates).toHaveLength(2);
      const columns = writableColumns();
      for (const payload of state.updates) {
        for (const key of Object.keys(payload)) expect(columns, `columna "${key}"`).toContain(key);
      }
      expect(state.updates[1]).toMatchObject(c.final);
    });
  }

  it("un UPDATE que la base rechaza no pasa en silencio", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.jobs = [job(0)];
    state.handler = async () => {};
    state.saveError = { message: "column does not exist" };

    const res = await GET(request);
    const body = await res.json();

    expect(body).toMatchObject({ ok: true, processed: 1, unsaved: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("marcarlo como completado"), "column does not exist");
  });
});
