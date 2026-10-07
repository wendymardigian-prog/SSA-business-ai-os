/**
 * La cola de lecturas de metricas: una por cuenta y por hora, y un pendiente
 * repetido no es un error (F47).
 */
import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { metricsSyncKey, queueMetricsSync } from "./queue";

const WS = "ws-1";
const NOW = new Date("2026-10-07T14:21:00Z");

/** El unico parcial de 00061: misma clave con un job pendiente. */
const pendingKeyClash = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  a.dedupe_key != null && a.dedupe_key === b.dedupe_key && b.status === "pending";

function db(jobs: Array<Record<string, unknown>> = []) {
  return memoryDb({ scheduled_jobs: jobs }, { unique: { scheduled_jobs: pendingKeyClash } });
}

describe("queueMetricsSync", () => {
  it("encola un job por cuenta, con la cuenta y el workspace", async () => {
    const mem = db();

    const result = await queueMetricsSync(mem.client, WS, ["sa-ig", "sa-yt"], NOW);

    expect(result).toEqual({ queued: 2, alreadyQueued: 0 });
    const jobs = mem.rows("scheduled_jobs");
    expect(jobs.map((j) => j.type)).toEqual(["metrics_sync", "metrics_sync"]);
    expect(jobs.map((j) => j.payload)).toEqual([
      { workspaceId: WS, socialAccountId: "sa-ig" },
      { workspaceId: WS, socialAccountId: "sa-yt" },
    ]);
    expect(jobs[0].dedupe_key).toBe("metrics:sa-ig:2026-10-07T14");
  });

  it("si ya hay uno pendiente de esa hora, no lanza y lo cuenta aparte", async () => {
    const mem = db([
      { type: "metrics_sync", status: "pending", dedupe_key: metricsSyncKey("sa-ig", NOW) },
    ]);

    const result = await queueMetricsSync(mem.client, WS, ["sa-ig", "sa-yt"], NOW);

    expect(result).toEqual({ queued: 1, alreadyQueued: 1 });
  });

  it("sin cuentas no encola nada", async () => {
    const mem = db();
    expect(await queueMetricsSync(mem.client, WS, [], NOW)).toEqual({ queued: 0, alreadyQueued: 0 });
    expect(mem.rows("scheduled_jobs")).toHaveLength(0);
  });
});
