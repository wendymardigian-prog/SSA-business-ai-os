/**
 * Publicaciones trabadas (A14).
 *
 * El caso real: el proceso se corta despues de tomar la fila. No queda job
 * pendiente porque ya se consumio, ni revision agendada porque el publicador
 * nunca contesto. Sin barrido, la fila dice "publicando" para siempre.
 */

import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { sweepStuckPublications, STUCK_AFTER_MINUTES } from "./sweep";

const NOW = new Date("2026-09-26T12:00:00Z");
const hace = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const db = (rows: Array<Record<string, unknown>>) =>
  memoryDb({
    social_posts: rows.map((r) => ({ workspace_id: "ws-1", deleted_at: null, ...r })),
    scheduled_jobs: [],
  });

describe("A14 · destrabar publicaciones", () => {
  it("una fila vieja en publicando vuelve a la cola", async () => {
    const d = db([{ id: "sp-1", status: "publishing", updated_at: hace(STUCK_AFTER_MINUTES + 5) }]);

    const result = await sweepStuckPublications(d.client, NOW);

    expect(result.recovered).toBe(1);
    expect(d.rows("social_posts")[0].status).toBe("failed");
    // Temporal: no se sabe si salio, asi que se reintenta.
    expect(d.rows("social_posts")[0].last_error_kind).toBe("temporary");
    expect(d.rows("scheduled_jobs")).toHaveLength(1);
  });

  it("una que recien empezo no se toca", async () => {
    const d = db([{ id: "sp-1", status: "publishing", updated_at: hace(2) }]);

    const result = await sweepStuckPublications(d.client, NOW);

    expect(result.recovered).toBe(0);
    expect(d.rows("social_posts")[0].status).toBe("publishing");
  });

  it("una ya publicada no se toca aunque sea vieja", async () => {
    const d = db([{ id: "sp-1", status: "published", updated_at: hace(600) }]);

    const result = await sweepStuckPublications(d.client, NOW);

    expect(result.recovered).toBe(0);
    expect(d.rows("social_posts")[0].status).toBe("published");
  });

  it("sin filas trabadas no hace nada", async () => {
    const d = db([]);

    expect(await sweepStuckPublications(d.client, NOW)).toEqual({ recovered: 0 });
  });
});
