import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { DEFAULT_BACKGROUND_SETTINGS } from "./settings";
import { planDispatch } from "./plan";
import { enqueuePlanned, enqueueBgTask, continuationDedupeKey } from "./enqueue";

const TZ = "America/Costa_Rica";
const WS = "ws-1";

/**
 * El índice de la 00101: único sobre `dedupe_key` entre los `bg_task`, en
 * cualquier estado. Sin el filtro por tipo, este test no probaría el acote —
 * que es justo lo que evita romper la ventana de `agent_burst`.
 */
function db(): MemoryDb {
  return memoryDb(
    { scheduled_jobs: [] },
    {
      unique: {
        scheduled_jobs: (a, b) =>
          a.type === "bg_task" && b.type === "bg_task" && a.dedupe_key != null && a.dedupe_key === b.dedupe_key,
      },
    },
  );
}

const client = (d: MemoryDb) => d.client as SupabaseClient<Database>;
const bgJobs = (d: MemoryDb) => d.rows("scheduled_jobs").filter((r) => r.type === "bg_task");

describe("idempotencia del despacho (00101)", () => {
  // 04:00 en Costa Rica: la ventana diaria de las 03:00 ya venció.
  const dentroDeLaVentana = new Date("2026-09-16T10:00:00Z");
  const quinceMinutosDespues = new Date("2026-09-16T10:15:00Z");
  const ventanaSiguiente = new Date("2026-09-17T10:00:00Z");

  function correrCron(d: MemoryDb, now: Date) {
    return enqueuePlanned(client(d), WS, planDispatch(WS, DEFAULT_BACKGROUND_SETTINGS, now, TZ), now);
  }

  it("correr el planificador dos veces en la misma ventana deja un job", async () => {
    const d = db();
    const primera = await correrCron(d, dentroDeLaVentana);
    const segunda = await correrCron(d, quinceMinutosDespues);

    expect(primera).toEqual({ created: 1, skipped: 0, failed: 0 });
    expect(segunda).toEqual({ created: 0, skipped: 1, failed: 0 });
    expect(bgJobs(d)).toHaveLength(1);
  });

  it("después de que el job se completó no crea uno nuevo", async () => {
    const d = db();
    await correrCron(d, dentroDeLaVentana);
    // Lo que hacía fallar todo: el runner lo pasa a completed y la fila salía
    // del índice parcial de la 00061.
    bgJobs(d)[0].status = "completed";

    const despues = await correrCron(d, quinceMinutosDespues);

    expect(despues).toEqual({ created: 0, skipped: 1, failed: 0 });
    expect(bgJobs(d)).toHaveLength(1);
  });

  it("tampoco lo reencola si el job quedó fallido o cancelado", async () => {
    for (const estado of ["failed", "cancelled"]) {
      const d = db();
      await correrCron(d, dentroDeLaVentana);
      bgJobs(d)[0].status = estado;
      await correrCron(d, quinceMinutosDespues);
      expect(bgJobs(d), `estado ${estado}`).toHaveLength(1);
    }
  });

  it("en la ventana siguiente sí crea uno nuevo", async () => {
    const d = db();
    await correrCron(d, dentroDeLaVentana);
    bgJobs(d)[0].status = "completed";

    const manana = await correrCron(d, ventanaSiguiente);

    expect(manana).toEqual({ created: 1, skipped: 0, failed: 0 });
    expect(bgJobs(d)).toHaveLength(2);
    expect(bgJobs(d).map((r) => r.dedupe_key)).toEqual([
      "bg:ws-1:message_classification:2026-09-16",
      "bg:ws-1:message_classification:2026-09-17",
    ]);
  });

  it("una continuación no choca con la ventana que la encoló", async () => {
    const d = db();
    await correrCron(d, dentroDeLaVentana);
    const base = String(bgJobs(d)[0].dedupe_key);

    const r = await enqueueBgTask(client(d), {
      dedupeKey: continuationDedupeKey(base, 1),
      payload: { workspaceId: WS, task: "message_classification", window: "2026-09-16", part: 1 },
    });

    expect(r).toBe("created");
    expect(bgJobs(d)).toHaveLength(2);
  });

  it("el índice no toca los jobs de otro tipo con la misma clave", async () => {
    const d = db();
    // La ventana del agente: dos filas con la misma clave es el diseño de la
    // 00061, y el acote por tipo de la 00101 tiene que dejarlo pasar.
    const dos = await client(d)
      .from("scheduled_jobs")
      .insert([
        { type: "agent_burst", dedupe_key: "agent_burst:cv-1", payload: {}, run_at: new Date().toISOString(), status: "processing" },
        { type: "agent_burst", dedupe_key: "agent_burst:cv-1", payload: {}, run_at: new Date().toISOString(), status: "pending" },
      ]);

    expect(dos.error).toBeNull();
    expect(d.rows("scheduled_jobs").filter((r) => r.type === "agent_burst")).toHaveLength(2);
  });

  it("un error que no es de clave duplicada se cuenta como fallo", async () => {
    const roto = {
      from: () => ({ insert: async () => ({ error: { code: "42501", message: "permission denied" } }) }),
    } as unknown as SupabaseClient<Database>;

    const r = await enqueuePlanned(roto, WS, planDispatch(WS, DEFAULT_BACKGROUND_SETTINGS, dentroDeLaVentana, TZ));

    expect(r).toEqual({ created: 0, skipped: 0, failed: 1 });
  });
});
