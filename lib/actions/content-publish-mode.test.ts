/**
 * Como se publica cada red y lo publicado a mano (Contenido v4, C2 y C3).
 *
 * Las acciones se llaman DIRECTO, salteando el editor: lo que la pantalla
 * deshabilita, el servidor tiene que rechazarlo igual.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";
const USER = "user-1";

let db: MemoryDb;
let role = "owner";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { logAudit } = vi.hoisted(() => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    role,
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const { setNetworkPublishMode, markNetworkPublished, unmarkNetworkPublished } = await import(
  "./content-schedule"
);

const video = {
  id: "v1",
  storage_path: `${WS}/${POST}/video.mp4`,
  mime_type: "video/mp4",
  kind: "video",
  size_bytes: 5_000_000,
  width: 1080,
  height: 1920,
  duration_ms: 30_000,
};

const inOneHour = () => new Date(Date.now() + 60 * 60_000).toISOString();

function seed(over: {
  status?: string;
  networks?: Record<string, unknown>[];
  accounts?: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  metrics?: Record<string, unknown>[];
} = {}) {
  db = memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Mi pieza",
        status: over.status ?? "approved",
        caption: "Un caption",
        media: [video],
        networks: over.networks ?? [
          { platform: "instagram", planned_at: inOneHour(), format: "reel", files: ["v1"], options: {} },
        ],
      },
    ],
    social_accounts: over.accounts ?? [
      { id: "acc-ig", workspace_id: WS, platform: "instagram", is_active: true, default_publisher: "zernio" },
    ],
    social_posts: over.rows ?? [],
    social_post_metrics_daily: over.metrics ?? [],
    social_post_comments: [],
    scheduled_jobs: [],
    workspace_roles: [],
  });
}

const network = (platform: string) =>
  (db.rows("content_posts")[0].networks as Array<Record<string, unknown>>).find((n) => n.platform === platform)!;
const liveRows = () => db.rows("social_posts").filter((r) => !r.deleted_at);
const postStatus = () => db.rows("content_posts")[0].status;

beforeEach(() => {
  role = "owner";
  logAudit.mockClear();
  seed();
});

describe("C2 · 'el sistema la publica'", () => {
  it("con cuenta conectada, pieza aprobada y fecha futura: crea la fila y su job", async () => {
    const result = await setNetworkPublishMode({ postId: POST, platform: "instagram", auto: true });

    expect(result.ok).toBe(true);
    expect(liveRows()).toHaveLength(1);
    // Zernio agenda de su lado: primero sube la media (uploading).
    expect(liveRows()[0]).toMatchObject({ origin: "system", status: "uploading", publisher: "zernio" });
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
    expect(network("instagram").auto).toBe(true);
    expect(postStatus()).toBe("scheduled");
  });

  it("SIN cuenta conectada el servidor lo rechaza, aunque se llame salteando el editor", async () => {
    seed({
      networks: [{ platform: "youtube", planned_at: inOneHour(), format: "video", files: ["v1"] }],
      accounts: [],
    });

    const result = await setNetworkPublishMode({ postId: POST, platform: "youtube", auto: true });

    expect(result.ok).toBe(false);
    expect(liveRows()).toHaveLength(0);
    expect(network("youtube").auto).toBeUndefined();
  });

  it("una cuenta sin publicador (Zernio desconectado) tampoco cuenta como conectada", async () => {
    seed({
      accounts: [{ id: "acc-ig", workspace_id: WS, platform: "instagram", is_active: true, default_publisher: null }],
    });

    const result = await setNetworkPublishMode({ postId: POST, platform: "instagram", auto: true });

    expect(result.ok).toBe(false);
    expect(liveRows()).toHaveLength(0);
  });

  it("una pieza sin aprobar no se programa sola", async () => {
    seed({ status: "in_review" });

    const result = await setNetworkPublishMode({ postId: POST, platform: "instagram", auto: true });

    expect(result.ok).toBe(false);
    expect(liveRows()).toHaveLength(0);
  });

  it("un Member no cambia como se publica", async () => {
    role = "member";

    const result = await setNetworkPublishMode({ postId: POST, platform: "instagram", auto: true });

    expect(result.ok).toBe(false);
    expect(liveRows()).toHaveLength(0);
  });
});

describe("C2 · volver a 'la subo yo'", () => {
  it("saca la red de la cola, cancela el job y CONSERVA la fecha como tentativa", async () => {
    const at = inOneHour();
    seed({
      status: "scheduled",
      networks: [{ platform: "linkedin", planned_at: at, format: "text", auto: true }],
      accounts: [
        { id: "acc-li", workspace_id: WS, platform: "linkedin", is_active: true, default_publisher: "linkedin_api" },
      ],
      rows: [
        {
          id: "sp-1",
          workspace_id: WS,
          content_post_id: POST,
          platform: "linkedin",
          publisher: "linkedin_api",
          origin: "system",
          status: "scheduled",
          scheduled_at: at,
        },
      ],
    });
    db.rows("scheduled_jobs").push({
      id: "job-1",
      type: "content_publish",
      status: "pending",
      payload: { socialPostId: "sp-1", workspaceId: WS },
    });

    const result = await setNetworkPublishMode({ postId: POST, platform: "linkedin", auto: false });

    expect(result.ok).toBe(true);
    expect(db.rows("social_posts")[0].status).toBe("cancelled");
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
    expect(network("linkedin")).toMatchObject({ auto: false, planned_at: at });
    // Sin nada en la cola, la pieza vuelve a Aprobado.
    expect(postStatus()).toBe("approved");
  });
});

describe("C3 · marcar como publicado", () => {
  it("crea una fila real con origin 'manual' y la pieza recalcula su estado", async () => {
    seed({
      status: "draft",
      networks: [{ platform: "youtube", planned_at: inOneHour(), format: "video", files: ["v1"] }],
      accounts: [],
    });

    const result = await markNetworkPublished({
      postId: POST,
      platform: "youtube",
      publishedAt: "2026-10-01T15:00:00.000Z",
      url: "https://youtu.be/abc",
    });

    expect(result.ok).toBe(true);
    expect(liveRows()).toHaveLength(1);
    expect(liveRows()[0]).toMatchObject({
      origin: "manual",
      status: "published",
      published_at: "2026-10-01T15:00:00.000Z",
      url: "https://youtu.be/abc",
      content_post_id: POST,
      platform: "youtube",
    });
    // Era la unica red: la pieza queda publicada sin tocar el dropdown.
    expect(postStatus()).toBe("published");
    expect(network("youtube")).toMatchObject({
      external_url: "https://youtu.be/abc",
      status_before_manual: "draft",
      auto: false,
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ kind: "content_marked_published" }) }),
    );
  });

  it("con otras redes todavia tentativas, la pieza queda publicada en parte", async () => {
    seed({
      status: "approved",
      networks: [
        { platform: "youtube", planned_at: null },
        { platform: "linkedin", planned_at: inOneHour() },
      ],
      accounts: [],
    });

    await markNetworkPublished({ postId: POST, platform: "youtube" });

    expect(postStatus()).toBe("partially_published");
  });

  it("todas marcadas a mano: Publicado", async () => {
    seed({ networks: [{ platform: "youtube" }, { platform: "linkedin" }], accounts: [] });

    await markNetworkPublished({ postId: POST, platform: "youtube" });
    await markNetworkPublished({ postId: POST, platform: "linkedin" });

    expect(postStatus()).toBe("published");
  });

  it("una red que estaba en la cola sale de la cola y reusa la fila: no hay dos publicaciones", async () => {
    seed({
      status: "scheduled",
      networks: [{ platform: "linkedin", planned_at: inOneHour(), auto: true }],
      accounts: [
        { id: "acc-li", workspace_id: WS, platform: "linkedin", is_active: true, default_publisher: "linkedin_api" },
      ],
      rows: [
        {
          id: "sp-1",
          workspace_id: WS,
          content_post_id: POST,
          platform: "linkedin",
          publisher: "linkedin_api",
          origin: "system",
          status: "scheduled",
          scheduled_at: inOneHour(),
        },
      ],
    });

    const result = await markNetworkPublished({ postId: POST, platform: "linkedin" });

    expect(result.ok).toBe(true);
    expect(liveRows()).toHaveLength(1);
    expect(liveRows()[0]).toMatchObject({ id: "sp-1", origin: "manual", status: "published", publisher: null });
    expect(db.rows("scheduled_jobs").filter((j) => (j.status ?? "pending") === "pending")).toHaveLength(0);
    expect(network("linkedin").auto).toBe(false);
  });

  it("una red ya publicada no se marca de nuevo", async () => {
    seed({
      rows: [
        { id: "sp-1", workspace_id: WS, content_post_id: POST, platform: "instagram", origin: "system", status: "published" },
      ],
    });

    const result = await markNetworkPublished({ postId: POST, platform: "instagram" });

    expect(result.ok).toBe(false);
    expect(liveRows()).toHaveLength(1);
  });

  it("un Member no marca como publicado", async () => {
    role = "member";

    const result = await markNetworkPublished({ postId: POST, platform: "instagram" });

    expect(result.ok).toBe(false);
    expect(liveRows()).toHaveLength(0);
  });

  it("un link que no es web, o una fecha que no llego, se rechazan con el motivo", async () => {
    const malLink = await markNetworkPublished({ postId: POST, platform: "instagram", url: "javascript:x" });
    const futuro = await markNetworkPublished({
      postId: POST,
      platform: "instagram",
      publishedAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    });

    expect(malLink.ok).toBe(false);
    expect(futuro.ok).toBe(false);
    expect(liveRows()).toHaveLength(0);
  });
});

describe("C3 · deshacer el marcado", () => {
  const manualRow = (over: Record<string, unknown> = {}) => ({
    id: "sp-m",
    workspace_id: WS,
    content_post_id: POST,
    platform: "youtube",
    origin: "manual",
    status: "published",
    published_at: "2026-10-01T15:00:00.000Z",
    engagement_d7: null,
    reach_d7: null,
    views_d7: null,
    interactions_d7: null,
    d7_computed_at: null,
    ...over,
  });

  it("sin metricas: se deshace y la pieza vuelve al estado que tenia", async () => {
    seed({
      status: "published",
      networks: [{ platform: "youtube", status_before_manual: "draft", published_manually_at: "x", external_url: null }],
      accounts: [],
      rows: [manualRow()],
    });

    const result = await unmarkNetworkPublished({ postId: POST, platform: "youtube" });

    expect(result.ok).toBe(true);
    expect(liveRows()).toHaveLength(0);
    // Borrado logico: la fila queda, marcada.
    expect(db.rows("social_posts")[0].deleted_at).toBeTruthy();
    expect(postStatus()).toBe("draft");
    expect(network("youtube")).not.toHaveProperty("published_manually_at");
  });

  it("con metricas de la red: se rechaza explicando por que", async () => {
    seed({
      status: "published",
      networks: [{ platform: "youtube", status_before_manual: "draft" }],
      accounts: [],
      rows: [manualRow()],
      metrics: [{ id: "m-1", social_post_id: "sp-m", date: "2026-10-02" }],
    });

    const result = await unmarkNetworkPublished({ postId: POST, platform: "youtube" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("métricas");
    expect(liveRows()).toHaveLength(1);
  });

  it("lo que publico el sistema no se deshace con este boton", async () => {
    seed({
      status: "published",
      networks: [{ platform: "youtube" }],
      rows: [manualRow({ origin: "system" })],
    });

    const result = await unmarkNetworkPublished({ postId: POST, platform: "youtube" });

    expect(result.ok).toBe(false);
  });
});
