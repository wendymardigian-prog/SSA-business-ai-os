/**
 * D6 · la red de seguridad de la programacion en Zernio.
 *
 * Si el webhook no llega, la fila se queda diciendo "programado" aunque el
 * post ya este publicado. Esto pregunta por las que deberian haber salido.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { registerPublisher, resetPublishers } from "./registry";
import { reconcileProviderSchedules, RECONCILE_AFTER_MINUTES } from "./reconcile";
import type { Publisher, PublishResult } from "./types";

const WS = "ws-1";
const NOW = new Date("2026-10-01T18:00:00Z");
const hace = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const deps = { credentialsFor: async () => ({ token: "k" }) };

function db(over: Record<string, unknown> = {}): MemoryDb {
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
        scheduled_at: hace(RECONCILE_AFTER_MINUTES + 10),
        deleted_at: null,
        ...over,
      },
    ],
    content_posts: [{ id: "post-1", workspace_id: WS, status: "scheduled", networks: [] }],
    social_accounts: [],
    triggers: [],
    notifications: [],
  });
}

function zernioSaying(result: PublishResult): Publisher {
  return {
    id: "zernio" as Publisher["id"],
    platforms: ["instagram"],
    publish: vi.fn(),
    getStatus: vi.fn(async () => result),
    scheduler: {} as never,
  };
}

beforeEach(() => resetPublishers());

describe("conciliar lo que el webhook no trajo", () => {
  it("una que ya se publico queda publicada", async () => {
    registerPublisher(
      zernioSaying({ status: "published", externalId: "ig-9", externalUrl: "https://ig/9" }),
    );
    const d = db();

    const result = await reconcileProviderSchedules(d.client, deps, NOW);

    expect(result).toEqual({ checked: 1, updated: 1 });
    expect(d.rows("social_posts")[0]).toMatchObject({
      status: "published",
      external_post_id: "ig-9",
    });
    // Y el estado de la pieza se pone al dia con ella.
    expect(d.rows("content_posts")[0].status).toBe("published");
  });

  it("una que fallo queda fallida y avisa", async () => {
    registerPublisher(zernioSaying({ status: "failed", error: "Instagram lo rechazo" }));
    const d = db();

    await reconcileProviderSchedules(d.client, deps, NOW);

    expect(d.rows("social_posts")[0].status).toBe("failed");
    expect(d.rows("notifications")).toHaveLength(1);
  });

  it("una que sigue en curso no se toca: apurarla haria publicar dos veces", async () => {
    registerPublisher(zernioSaying({ status: "processing" }));
    const d = db();

    const result = await reconcileProviderSchedules(d.client, deps, NOW);

    expect(result).toEqual({ checked: 1, updated: 0 });
    expect(d.rows("social_posts")[0].status).toBe("scheduled");
  });

  it("una cuya hora todavia no llego no se pregunta", async () => {
    const getStatus = vi.fn();
    registerPublisher({ ...zernioSaying({ status: "processing" }), getStatus });
    const d = db({ scheduled_at: hace(2) });

    expect(await reconcileProviderSchedules(d.client, deps, NOW)).toEqual({
      checked: 0,
      updated: 0,
    });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("las que no agenda el proveedor no le incumben: esas tienen su cola", async () => {
    registerPublisher(zernioSaying({ status: "published" }));
    const d = db({ publisher: "youtube_api" });

    expect(await reconcileProviderSchedules(d.client, deps, NOW)).toEqual({
      checked: 0,
      updated: 0,
    });
  });

  it("si el proveedor no contesta, no rompe la corrida", async () => {
    registerPublisher({
      id: "zernio" as Publisher["id"],
      platforms: ["instagram"],
      publish: vi.fn(),
      getStatus: vi.fn(async () => {
        throw new Error("Zernio no contesta");
      }),
    });
    const d = db();

    await expect(reconcileProviderSchedules(d.client, deps, NOW)).resolves.toEqual({
      checked: 1,
      updated: 0,
    });
    expect(d.rows("social_posts")[0].status).toBe("scheduled");
  });
});
