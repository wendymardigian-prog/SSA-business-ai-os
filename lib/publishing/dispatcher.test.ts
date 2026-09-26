/**
 * El despachador de publicaciones (F35).
 *
 * Lo que se prueba aca es lo que no se puede probar mirando la pantalla: que
 * dos corridas simultaneas publiquen UNA sola vez, que un error temporal
 * espere y uno permanente no, y que una publicacion que quedo en el aire
 * termine en algo que se pueda leer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { PublishError } from "@/lib/jobs/errors";
import { registerPublisher, resetPublishers } from "./registry";
import type { Publisher, PublishResult } from "./types";
import {
  MAX_PUBLISH_ATTEMPTS,
  PUBLISH_RETRY_DELAYS_MS,
  claimForPublishing,
  nextPublishAttempt,
  nextRecheckDelay,
  rowFromFailure,
  rowFromResult,
  runPublication,
  runPublicationCheck,
} from "./dispatcher";

const WS = "ws-1";
const POST = "post-1";
const PUB = "sp-1";

function seedDb(over: Record<string, unknown> = {}): MemoryDb {
  return memoryDb({
    social_posts: [
      {
        id: PUB,
        workspace_id: WS,
        content_post_id: POST,
        social_account_id: "acc-1",
        platform: "instagram",
        publisher: "zernio",
        status: "scheduled",
        attempts: 0,
        deleted_at: null,
        ...over,
      },
    ],
    social_accounts: [{ id: "acc-1", workspace_id: WS, external_id: "ig-acc" }],
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Mi pieza",
        caption: "El caption base",
        media: [{ storage_path: `${WS}/p/a.jpg`, mime_type: "image/jpeg", kind: "image", size_bytes: 10 }],
        networks: [{ platform: "instagram", options: { contentType: "reel" } }],
        status: "scheduled",
      },
    ],
    scheduled_jobs: [],
    notifications: [],
  });
}

function publisherReturning(result: PublishResult | (() => never), id = "zernio"): Publisher {
  return {
    id: id as Publisher["id"],
    platforms: ["instagram"],
    publish: vi.fn(async () => (typeof result === "function" ? result() : result)),
  };
}

const deps = {
  signMedia: async (paths: string[]) => paths.map((p) => `https://signed.test/${p}`),
  credentialsFor: async () => ({ token: "k" }),
};

beforeEach(() => {
  resetPublishers();
});

// ── Decisiones puras ──────────────────────────────────────────────────────

describe("cuando reintentar (F35)", () => {
  it("espera 1, 5 y 15 minutos", () => {
    expect(nextPublishAttempt(1, "temporary")).toEqual({ action: "retry", delayMs: 60_000 });
    expect(nextPublishAttempt(2, "temporary")).toEqual({ action: "retry", delayMs: 300_000 });
    expect(PUBLISH_RETRY_DELAYS_MS[2]).toBe(900_000);
  });

  it("un error permanente no se reintenta ni una vez", () => {
    // Tres intentos contra una cuenta desconectada solo retrasan el aviso.
    expect(nextPublishAttempt(1, "permanent")).toEqual({ action: "give_up", reason: "permanent" });
  });

  it("despues del ultimo intento se rinde", () => {
    expect(nextPublishAttempt(MAX_PUBLISH_ATTEMPTS, "temporary")).toEqual({
      action: "give_up",
      reason: "exhausted",
    });
  });

  it("las revisiones se van espaciando y en algun momento se terminan", () => {
    expect(nextRecheckDelay(0)).toBe(120_000);
    expect(nextRecheckDelay(2)).toBe(1_800_000);
    expect(nextRecheckDelay(3)).toBeNull();
  });
});

describe("como queda la fila (F35)", () => {
  it("publicada guarda el id, el link y la hora, y limpia el error anterior", () => {
    const row = rowFromResult(
      { status: "published", externalId: "ig-9", externalUrl: "https://ig/9" },
      new Date("2026-10-01T15:00:00Z"),
    );

    expect(row).toMatchObject({
      status: "published",
      external_post_id: "ig-9",
      url: "https://ig/9",
      published_at: "2026-10-01T15:00:00.000Z",
      last_error: null,
    });
  });

  it("en proceso guarda la referencia y no inventa hora de publicacion", () => {
    const row = rowFromResult({ status: "processing", ref: "z1" }, new Date());

    expect(row.status).toBe("publishing");
    expect(row.publisher_ref).toBe("z1");
    expect(row.published_at).toBeUndefined();
  });

  it("mientras quede un reintento la fila vuelve a programada, no a fallida", () => {
    // Decir "fallo" cuando todavia va a salir asusta al pedo.
    const row = rowFromFailure(new PublishError("429", "temporary"), "instagram", {
      action: "retry",
      delayMs: 60_000,
    });

    expect(row.status).toBe("scheduled");
    expect(row.last_error_kind).toBe("temporary");
  });

  it("sin reintentos queda fallida con el motivo en castellano", () => {
    const row = rowFromFailure(new PublishError("invalid token", "permanent"), "instagram", {
      action: "give_up",
      reason: "permanent",
    });

    expect(row.status).toBe("failed");
    expect(row.last_error).toBeTruthy();
  });
});

// ── Contra la base ────────────────────────────────────────────────────────

describe("tomar la publicacion (F35)", () => {
  it("una sola corrida se la lleva", async () => {
    // El caso que importa: el cron corre cada minuto y una corrida lenta se
    // superpone con la siguiente. Publicar dos veces no se deshace.
    const db = seedDb();

    const primera = await claimForPublishing(db.client, PUB);
    const segunda = await claimForPublishing(db.client, PUB);

    expect(primera).not.toBeNull();
    expect(segunda).toBeNull();
  });

  it("una cancelada no se toma", async () => {
    const db = seedDb({ status: "cancelled" });

    expect(await claimForPublishing(db.client, PUB)).toBeNull();
  });
});

describe("publicar (F35)", () => {
  it("una publicacion que sale deja la fila y la pieza publicadas", async () => {
    const db = seedDb();
    registerPublisher(publisherReturning({ status: "published", externalId: "ig-9", externalUrl: "https://ig/9" }));

    const outcome = await runPublication(db.client, PUB, deps);

    expect(outcome.kind).toBe("published");
    expect(db.rows("social_posts")[0]).toMatchObject({
      status: "published",
      external_post_id: "ig-9",
      attempts: 1,
    });
    expect(db.rows("content_posts")[0].status).toBe("published");
  });

  it("le manda al publicador el caption y la media de la pieza, ya firmada", async () => {
    const db = seedDb();
    const publisher = publisherReturning({ status: "published", externalId: "x" });
    registerPublisher(publisher);

    await runPublication(db.client, PUB, deps);

    const input = (publisher.publish as ReturnType<typeof vi.fn>).mock.calls[0][0].input;
    expect(input.text).toBe("El caption base");
    expect(input.mediaUrls[0]).toContain("https://signed.test/");
    expect(input.accountRef).toBe("ig-acc");
    expect(input.options.contentType).toBe("reel");
  });

  it("si la red tiene caption propio, se publica el propio", async () => {
    // El editor muestra la variante: publicar lo base seria publicar otra cosa.
    const db = seedDb();
    db.rows("content_posts")[0].networks = [{ platform: "instagram", caption: "El propio" }];
    const publisher = publisherReturning({ status: "published", externalId: "x" });
    registerPublisher(publisher);

    await runPublication(db.client, PUB, deps);

    const input = (publisher.publish as ReturnType<typeof vi.fn>).mock.calls[0][0].input;
    expect(input.text).toBe("El propio");
  });

  it("un error temporal vuelve a programarla y agenda el reintento", async () => {
    const db = seedDb();
    registerPublisher(
      publisherReturning(() => {
        throw new PublishError("429 Too Many Requests", "temporary", 429);
      }),
    );

    const outcome = await runPublication(db.client, PUB, deps);

    expect(outcome.kind).toBe("retry");
    expect(db.rows("social_posts")[0].status).toBe("scheduled");
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
    expect(db.rows("scheduled_jobs")[0].type).toBe("content_publish");
  });

  it("un error permanente la deja fallida, sin reintento y con aviso", async () => {
    const db = seedDb();
    registerPublisher(
      publisherReturning(() => {
        throw new PublishError("invalid access token", "permanent", 401);
      }),
    );

    const outcome = await runPublication(db.client, PUB, deps);

    expect(outcome.kind).toBe("failed");
    expect(db.rows("social_posts")[0].status).toBe("failed");
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
    expect(db.rows("notifications")[0]).toMatchObject({ type: "content_publish_failed" });
  });

  it("al tercer intento fallido se rinde aunque el error sea temporal", async () => {
    const db = seedDb({ attempts: MAX_PUBLISH_ATTEMPTS - 1 });
    registerPublisher(
      publisherReturning(() => {
        throw new PublishError("503", "temporary", 503);
      }),
    );

    await runPublication(db.client, PUB, deps);

    expect(db.rows("social_posts")[0].status).toBe("failed");
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("un publicador que no existe es un fallo permanente, no un cuelgue", async () => {
    // Sin esto la fila quedaria en "publicando" para siempre.
    const db = seedDb({ publisher: "no_existe" });

    const outcome = await runPublication(db.client, PUB, deps);

    expect(outcome.kind).toBe("failed");
    expect(db.rows("social_posts")[0].status).toBe("failed");
  });

  it("si quedo en proceso, agenda la revision", async () => {
    const db = seedDb();
    registerPublisher(publisherReturning({ status: "processing", ref: "z1" }));

    const outcome = await runPublication(db.client, PUB, deps);

    expect(outcome.kind).toBe("processing");
    expect(db.rows("social_posts")[0]).toMatchObject({ status: "publishing", publisher_ref: "z1" });
    expect(db.rows("scheduled_jobs")[0].type).toBe("content_publish_check");
  });

  it("una fila que ya no estaba programada se saltea sin publicar", async () => {
    const db = seedDb({ status: "published" });
    const publisher = publisherReturning({ status: "published" });
    registerPublisher(publisher);

    const outcome = await runPublication(db.client, PUB, deps);

    expect(outcome.kind).toBe("skipped");
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("la pieza queda publicada solo cuando salieron todas sus redes", async () => {
    const db = seedDb();
    db.rows("social_posts").push({
      id: "sp-2",
      workspace_id: WS,
      content_post_id: POST,
      platform: "threads",
      status: "scheduled",
      attempts: 0,
      deleted_at: null,
    });
    registerPublisher(publisherReturning({ status: "published", externalId: "ig-9" }));

    await runPublication(db.client, PUB, deps);

    expect(db.rows("content_posts")[0].status).not.toBe("published");
  });
});

describe("revisar una que quedo en proceso (F35)", () => {
  const checkPublisher = (result: PublishResult): Publisher => ({
    id: "zernio",
    platforms: ["instagram"],
    publish: vi.fn(),
    getStatus: vi.fn(async () => result),
  });

  it("si ya salio, la completa", async () => {
    const db = seedDb({ status: "publishing", publisher_ref: "z1" });
    registerPublisher(checkPublisher({ status: "published", externalId: "ig-9" }));

    const outcome = await runPublicationCheck(
      db.client,
      { socialPostId: PUB, workspaceId: WS, checks: 0 },
      deps,
    );

    expect(outcome.kind).toBe("published");
    expect(db.rows("social_posts")[0].external_post_id).toBe("ig-9");
  });

  it("si sigue sin saberse, vuelve a preguntar mas tarde", async () => {
    const db = seedDb({ status: "publishing", publisher_ref: "z1" });
    registerPublisher(checkPublisher({ status: "processing" }));

    const outcome = await runPublicationCheck(
      db.client,
      { socialPostId: PUB, workspaceId: WS, checks: 1 },
      deps,
    );

    expect(outcome.kind).toBe("processing");
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
  });

  it("cuando se acaban las revisiones queda fallida avisando que puede haber salido", async () => {
    // Decir "fallo" a secas invitaria a republicarla y duplicarla.
    const db = seedDb({ status: "publishing", publisher_ref: "z1" });
    registerPublisher(checkPublisher({ status: "processing" }));

    await runPublicationCheck(db.client, { socialPostId: PUB, workspaceId: WS, checks: 3 }, deps);

    const row = db.rows("social_posts")[0];
    expect(row.status).toBe("failed");
    expect(String(row.last_error)).toContain("Fijate en la red");
  });

  it("una que ya se resolvio no se toca", async () => {
    const db = seedDb({ status: "published", publisher_ref: "z1" });
    const publisher = checkPublisher({ status: "published" });
    registerPublisher(publisher);

    const outcome = await runPublicationCheck(
      db.client,
      { socialPostId: PUB, workspaceId: WS, checks: 0 },
      deps,
    );

    expect(outcome.kind).toBe("skipped");
    expect(publisher.getStatus).not.toHaveBeenCalled();
  });
});
