/**
 * Desconectar una cuenta con redes programadas (Contenido v4, C2).
 */

import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { unscheduleOnDisconnect } from "./disconnect-networks";

const WS = "ws-1";
const credentialsFor = async () => ({ token: "k" });

function seed(over: Record<string, Record<string, unknown>[]> = {}) {
  return memoryDb({
    social_posts: [
      {
        id: "sp-1",
        workspace_id: WS,
        content_post_id: "post-1",
        platform: "instagram",
        publisher: "zernio",
        publisher_ref: "zp-1",
        status: "scheduled",
        deleted_at: null,
      },
    ],
    content_posts: [
      { id: "post-1", workspace_id: WS, title: "La pieza", networks: [{ platform: "instagram", auto: true, planned_at: "2026-10-20T16:00:00.000Z" }] },
    ],
    scheduled_jobs: [
      { id: "job-1", type: "content_provider_schedule", status: "pending", payload: { socialPostId: "sp-1" } },
    ],
    notifications: [],
    ...over,
  });
}

describe("C2 · desconectar una cuenta con redes programadas", () => {
  it("cancela en Zernio, desprograma, conserva la fecha como tentativa y avisa", async () => {
    const db = seed();
    const cancel = vi.fn().mockResolvedValue({ data: null, error: null });
    // El cliente simulado de Zernio: solo lo que cancelOnProvider necesita.
    vi.doMock("@/lib/zernio-client", () => ({
      createZernioClient: () => ({ posts: { deletePost: cancel } }),
    }));
    vi.resetModules();
    const { registerPublishing } = await import("./bootstrap");
    const { unscheduleOnDisconnect: run } = await import("./disconnect-networks");
    registerPublishing();

    const result = await run(db.client as never, { workspaceId: WS, publisher: "zernio", credentialsFor });

    expect(result).toEqual({ unscheduled: 1, failed: 0 });
    expect(cancel).toHaveBeenCalled();
    expect(db.rows("social_posts")[0].status).toBe("cancelled");
    expect(db.rows("scheduled_jobs").filter((j) => (j.status ?? "pending") === "pending")).toHaveLength(0);
    const network = (db.rows("content_posts")[0].networks as Array<Record<string, unknown>>)[0];
    expect(network).toMatchObject({ auto: false, planned_at: "2026-10-20T16:00:00.000Z" });
    expect(db.rows("notifications")).toHaveLength(1);

    vi.doUnmock("@/lib/zernio-client");
  });

  it("si Zernio no contesta, la fila sigue en la cola y se cuenta como fallo", async () => {
    const db = seed();
    vi.doMock("@/lib/zernio-client", () => ({
      createZernioClient: () => ({
        posts: { deletePost: vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { statusCode: 500 })) },
      }),
    }));
    vi.resetModules();
    const { registerPublishing } = await import("./bootstrap");
    const { unscheduleOnDisconnect: run } = await import("./disconnect-networks");
    registerPublishing();

    const result = await run(db.client as never, { workspaceId: WS, publisher: "zernio", credentialsFor });

    expect(result).toEqual({ unscheduled: 0, failed: 1 });
    expect(db.rows("social_posts")[0].status).toBe("scheduled");

    vi.doUnmock("@/lib/zernio-client");
  });

  it("sin nada programado con ese publicador, no hace nada y no avisa", async () => {
    const db = seed({ social_posts: [] });

    const result = await unscheduleOnDisconnect(db.client as never, {
      workspaceId: WS,
      publisher: "zernio",
      credentialsFor,
    });

    expect(result).toEqual({ unscheduled: 0, failed: 0 });
    expect(db.rows("notifications")).toHaveLength(0);
  });
});
