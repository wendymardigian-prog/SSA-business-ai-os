import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { fathomSyncDedupeKey, fathomSyncKeyPrefix, queueFathomSync, queueFathomSyncNow, requeueFathomSync } from "./queue";

const CONN = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-10T18:07:30.000Z");

describe("fathomSyncDedupeKey", () => {
  it("es la conexion + la franja de 10 minutos (misma cuenta que la funcion SQL)", () => {
    const epoch = Math.floor(NOW.getTime() / 1000);
    expect(fathomSyncDedupeKey(CONN, NOW)).toBe(`fathom_sync:${CONN}:${Math.floor(epoch / 600)}`);
  });
  it("dentro de la misma franja la clave no cambia; en la siguiente si", () => {
    const a = fathomSyncDedupeKey(CONN, new Date("2026-10-10T18:00:00Z"));
    const b = fathomSyncDedupeKey(CONN, new Date("2026-10-10T18:09:59Z"));
    const c = fathomSyncDedupeKey(CONN, new Date("2026-10-10T18:10:00Z"));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
  it("todas empiezan con el prefijo de la conexion", () => {
    expect(fathomSyncDedupeKey(CONN, NOW).startsWith(fathomSyncKeyPrefix(CONN))).toBe(true);
  });
});

describe("queueFathomSync", () => {
  it("encola un job con la conexion en el payload", async () => {
    const db = fakeDb({ "scheduled_jobs:select": { data: [] }, "scheduled_jobs:insert": { data: { id: "j1" } } });
    const r = await queueFathomSyncNow(db.client, CONN, NOW);
    expect(r).toEqual({ queued: true });
    const insert = db.writesTo("scheduled_jobs")[0];
    expect(insert.values).toMatchObject({ type: "fathom_sync", payload: { connectionId: CONN }, dedupe_key: fathomSyncDedupeKey(CONN, NOW) });
  });

  it("si ya hay uno pendiente o procesando, no encola otro", async () => {
    const db = fakeDb({ "scheduled_jobs:select": { data: [{ id: "j0", status: "processing" }] } });
    const r = await queueFathomSyncNow(db.client, CONN, NOW);
    expect(r).toEqual({ queued: false, reason: "already" });
    expect(db.writes()).toHaveLength(0);
  });

  it("tocar dos veces seguidas deja un solo job (la segunda ve el pendiente)", async () => {
    let jobs: Array<{ id: string; status: string }> = [];
    const db = fakeDb({
      "scheduled_jobs:select": () => ({ data: jobs }),
      "scheduled_jobs:insert": () => { jobs = [{ id: "j1", status: "pending" }]; return { data: { id: "j1" } }; },
    });
    expect(await queueFathomSyncNow(db.client, CONN, NOW)).toEqual({ queued: true });
    expect(await queueFathomSyncNow(db.client, CONN, NOW)).toEqual({ queued: false, reason: "already" });
    expect(db.writesTo("scheduled_jobs")).toHaveLength(1);
  });

  it("un choque del unico (23505) cuenta como 'ya estaba'", async () => {
    const db = fakeDb({ "scheduled_jobs:select": { data: [] }, "scheduled_jobs:insert": { error: { message: "dup", code: "23505" } } });
    expect(await queueFathomSync(db.client, CONN, { now: NOW })).toEqual({ queued: false, reason: "already" });
  });

  it("otro error se informa sin lanzar", async () => {
    const db = fakeDb({ "scheduled_jobs:select": { data: [] }, "scheduled_jobs:insert": { error: { message: "caida", code: "XX000" } } });
    const r = await queueFathomSync(db.client, CONN, { now: NOW });
    expect(r).toMatchObject({ queued: false, reason: "error" });
  });
});

describe("requeueFathomSync", () => {
  it("agenda la continuacion a +70 s e ignora el job que esta procesando", async () => {
    const db = fakeDb({
      "scheduled_jobs:select": (call) => {
        const status = call.filters.find((f) => f.method === "in")?.value as string[];
        // El unico existente es el que esta corriendo: no cuenta como duplicado.
        return { data: status.includes("processing") ? [{ id: "j0", status: "processing" }] : [] };
      },
      "scheduled_jobs:insert": { data: { id: "j2" } },
    });
    const r = await requeueFathomSync(db.client, CONN, 70_000, NOW);
    expect(r).toEqual({ queued: true });
    expect(db.writesTo("scheduled_jobs")[0].values).toMatchObject({ run_at: new Date(NOW.getTime() + 70_000).toISOString() });
  });
});
