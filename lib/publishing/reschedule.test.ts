/**
 * Mover de hora una publicacion ya programada (A5), con las dos formas de
 * programar que hay: nuestra cola (LinkedIn, Threads, YouTube) y la agenda
 * del proveedor (Zernio: Instagram y TikTok).
 *
 * El caso de Zernio es el que importa (Contenido v4): el post vive agendado
 * ALLA. Si al cambiar la fecha se encola un "publicar ahora" a la hora nueva
 * y no se toca el post de Zernio, la pieza sale dos veces: una a la hora
 * vieja (Zernio) y otra a la nueva (nuestra cola).
 */

import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import {
  CONTENT_PROVIDER_SCHEDULE_JOB,
  CONTENT_PUBLISH_JOB,
} from "@/lib/content/jobs";
import { reschedulePublication } from "./reschedule";

const WS = "ws-1";
const OLD_AT = "2026-10-15T16:00:00.000Z";
const NEW_AT = "2026-10-16T18:30:00.000Z";

function seed(row: Record<string, unknown>, jobs: Record<string, unknown>[] = []) {
  return memoryDb({
    social_posts: [
      {
        id: "sp-1",
        workspace_id: WS,
        content_post_id: "post-1",
        status: "scheduled",
        scheduled_at: OLD_AT,
        deleted_at: null,
        ...row,
      },
    ],
    scheduled_jobs: jobs,
  });
}

// `scheduleJob` no manda el estado: en la base real lo pone el default
// ('pending'). La base en memoria no tiene defaults.
const pendingJobs = (db: ReturnType<typeof memoryDb>) =>
  (db.tables.scheduled_jobs ?? []).filter((j) => (j.status ?? "pending") === "pending");

describe("reprogramar una publicacion agendada en Zernio", () => {
  it("NO encola un 'publicar ahora': eso la publicaria dos veces", async () => {
    const db = seed({ publisher: "zernio", publisher_ref: "zp-1" });

    const ok = await reschedulePublication(db.client as never, {
      socialPostId: "sp-1",
      workspaceId: WS,
      at: NEW_AT,
    });

    expect(ok).toBe(true);
    expect(pendingJobs(db).some((j) => j.type === CONTENT_PUBLISH_JOB)).toBe(false);
  });

  it("le pide a Zernio que mueva SU post: un job de agenda, que con la referencia hace updatePost", async () => {
    const db = seed({ publisher: "zernio", publisher_ref: "zp-1" });

    await reschedulePublication(db.client as never, { socialPostId: "sp-1", workspaceId: WS, at: NEW_AT });

    const jobs = pendingJobs(db);
    expect(jobs.map((j) => j.type)).toEqual([CONTENT_PROVIDER_SCHEDULE_JOB]);
    expect(jobs[0].payload).toMatchObject({ socialPostId: "sp-1", workspaceId: WS });

    const row = db.tables.social_posts[0];
    // La fecha nueva y la referencia de Zernio, que es lo que hace que el job
    // edite el post existente en vez de crear otro.
    expect(row.scheduled_at).toBe(NEW_AT);
    expect(row.publisher_ref).toBe("zp-1");
    // Hasta que Zernio confirme la hora nueva, no esta "programado" a esa hora.
    expect(row.status).toBe("uploading");
  });

  it("no deja un job de agenda viejo pendiente al lado del nuevo", async () => {
    const db = seed({ publisher: "zernio", publisher_ref: "zp-1" }, [
      {
        id: "job-viejo",
        type: CONTENT_PROVIDER_SCHEDULE_JOB,
        status: "pending",
        payload: { socialPostId: "sp-1", workspaceId: WS },
      },
    ]);

    await reschedulePublication(db.client as never, { socialPostId: "sp-1", workspaceId: WS, at: NEW_AT });

    expect(pendingJobs(db)).toHaveLength(1);
  });
});

describe("reprogramar una publicacion de nuestra cola (sin cambios)", () => {
  it("mueve la fila y deja UN solo job de publicar, a la hora nueva", async () => {
    const db = seed({ publisher: "linkedin_api", publisher_ref: null }, [
      {
        id: "job-viejo",
        type: CONTENT_PUBLISH_JOB,
        status: "pending",
        payload: { socialPostId: "sp-1", workspaceId: WS },
      },
    ]);

    const ok = await reschedulePublication(db.client as never, {
      socialPostId: "sp-1",
      workspaceId: WS,
      at: NEW_AT,
    });

    expect(ok).toBe(true);
    const jobs = pendingJobs(db);
    expect(jobs.map((j) => j.type)).toEqual([CONTENT_PUBLISH_JOB]);
    expect(new Date(String(jobs[0].run_at)).toISOString()).toBe(NEW_AT);
    expect(db.tables.social_posts[0]).toMatchObject({ status: "scheduled", scheduled_at: NEW_AT });
  });
});
