/**
 * Guardar las metricas y decidir cuando (F47).
 */

import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { EMPTY_POST_METRICS, type PostSnapshot } from "./types";
import {
  canRefreshNow,
  maybeComputeD7,
  persistAccountMetrics,
  persistPostMetrics,
  persistPosts,
  postsDueForSync,
  syncDate,
} from "./sync";

const WS = "ws-1";
const ACC = "sa-1";
const NOW = new Date("2026-10-01T06:00:00Z");

const snapshot = (over: Partial<PostSnapshot> = {}): PostSnapshot => ({
  platform: "instagram",
  externalPostId: "ig-9",
  publisherRef: null,
  url: "https://ig/9",
  caption: "El caption",
  mediaType: "reel",
  thumbnailUrl: "https://t/9",
  publishedAt: "2026-09-20T15:00:00Z",
  metrics: { ...EMPTY_POST_METRICS, likes: 40, reach: 1000 },
  ...over,
});

const db = (over: Record<string, unknown[]> = {}) =>
  memoryDb({
    social_posts: [],
    social_post_metrics_daily: [],
    social_account_metrics_daily: [],
    social_accounts: [{ id: ACC, workspace_id: WS }],
    ...over,
  });

describe("actualizar a mano (F47)", () => {
  it("la primera vez siempre se puede", () => {
    expect(canRefreshNow(null, NOW)).toEqual({ allowed: true });
  });

  it("dos veces en 15 minutos: la segunda se rechaza y dice cuanto falta", () => {
    // Apretar cinco veces no trae datos mas nuevos, quema la cuota del dia.
    const result = canRefreshNow("2026-10-01T05:55:00Z", NOW);

    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.message).toContain("10 minutos");
  });

  it("pasados los 15 minutos, si", () => {
    expect(canRefreshNow("2026-10-01T05:40:00Z", NOW).allowed).toBe(true);
  });

  it("una fecha rota no bloquea", () => {
    expect(canRefreshNow("ayer a la tarde", NOW).allowed).toBe(true);
  });
});

describe("guardar la fila del dia (F47)", () => {
  it("dos lecturas del mismo dia dejan una sola fila, corregida", async () => {
    const memory = db();

    await persistPostMetrics(memory.client, {
      workspaceId: WS,
      socialPostId: "sp-1",
      date: "2026-10-01",
      metrics: { ...EMPTY_POST_METRICS, likes: 10 },
    });
    await persistPostMetrics(memory.client, {
      workspaceId: WS,
      socialPostId: "sp-1",
      date: "2026-10-01",
      metrics: { ...EMPTY_POST_METRICS, likes: 25 },
    });

    const rows = memory.rows("social_post_metrics_daily");
    expect(rows).toHaveLength(1);
    expect(rows[0].likes).toBe(25);
  });

  it("una lectura sin ningun dato no escribe fila", async () => {
    // Una fila vacia se veria en el grafico como un dia en cero.
    const memory = db();

    const wrote = await persistPostMetrics(memory.client, {
      workspaceId: WS,
      socialPostId: "sp-1",
      date: "2026-10-01",
      metrics: { ...EMPTY_POST_METRICS },
    });

    expect(wrote).toBe(false);
    expect(memory.rows("social_post_metrics_daily")).toHaveLength(0);
  });

  it("un metric en null no pisa lo que ya estaba", async () => {
    const memory = db();

    await persistPostMetrics(memory.client, {
      workspaceId: WS,
      socialPostId: "sp-1",
      date: "2026-10-01",
      metrics: { ...EMPTY_POST_METRICS, likes: 10, reach: 500 },
    });
    await persistPostMetrics(memory.client, {
      workspaceId: WS,
      socialPostId: "sp-1",
      date: "2026-10-01",
      metrics: { ...EMPTY_POST_METRICS, likes: 12 },
    });

    expect(memory.rows("social_post_metrics_daily")[0]).toMatchObject({ likes: 12, reach: 500 });
  });
});

describe("guardar las publicaciones (F47)", () => {
  it("un post que ya es nuestro se ACTUALIZA, no se duplica", async () => {
    // Si no, el mismo post aparece dos veces: uno con caption y otro sin.
    const memory = db({
      social_posts: [
        {
          id: "sp-1",
          workspace_id: WS,
          social_account_id: ACC,
          external_post_id: "ig-9",
          origin: "system",
          status: "published",
          caption: null,
          deleted_at: null,
        },
      ],
    });

    const result = await persistPosts(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      platform: "instagram",
      posts: [snapshot()],
      date: "2026-10-01",
      now: NOW,
    });

    expect(result.created).toBe(0);
    expect(memory.rows("social_posts")).toHaveLength(1);
    expect(memory.rows("social_posts")[0]).toMatchObject({
      caption: "El caption",
      // Lo nuestro no se toca: el lector solo escribe lo que la red sabe.
      origin: "system",
      status: "published",
    });
  });

  it("uno que no conocemos entra como externo", async () => {
    const memory = db();

    const result = await persistPosts(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      platform: "instagram",
      posts: [snapshot()],
      date: "2026-10-01",
      now: NOW,
    });

    expect(result.created).toBe(1);
    expect(memory.rows("social_posts")[0]).toMatchObject({ origin: "external", status: null });
  });

  it("C3 · un post marcado a mano SIN link se vincula por fecha, no se duplica", async () => {
    const memory = db({
      content_posts: [{ id: "post-1", workspace_id: WS, title: "La pieza" }],
      social_posts: [
        {
          id: "sp-manual",
          workspace_id: WS,
          content_post_id: "post-1",
          social_account_id: null,
          external_post_id: null,
          platform: "instagram",
          origin: "manual",
          status: "published",
          published_at: "2026-09-20T14:30:00Z",
          url: null,
          deleted_at: null,
        },
      ],
    });

    const result = await persistPosts(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      platform: "instagram",
      posts: [snapshot()], // publishedAt 2026-09-20T15:00:00Z, 30 min despues
      date: "2026-10-01",
      now: NOW,
    });

    expect(result.created).toBe(0);
    expect(memory.rows("social_posts")).toHaveLength(1);
    expect(memory.rows("social_posts")[0]).toMatchObject({
      id: "sp-manual",
      content_post_id: "post-1",
      origin: "manual",
      external_post_id: "ig-9",
      social_account_id: ACC,
      caption: "El caption",
    });
  });

  it("C3 · un post marcado a mano CON link se vincula por el link", async () => {
    const memory = db({
      content_posts: [{ id: "post-1", workspace_id: WS, title: "La pieza" }],
      social_posts: [
        {
          id: "sp-manual",
          workspace_id: WS,
          content_post_id: "post-1",
          social_account_id: null,
          external_post_id: null,
          platform: "instagram",
          origin: "manual",
          status: "published",
          published_at: "2026-01-01T00:00:00Z", // lejos en el tiempo: solo el link lo salva
          url: "https://www.instagram.com/p/ig-9/?igsh=1",
          deleted_at: null,
        },
      ],
    });

    const result = await persistPosts(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      platform: "instagram",
      posts: [snapshot({ url: "https://instagram.com/p/ig-9" })],
      date: "2026-10-01",
      now: NOW,
    });

    expect(result.created).toBe(0);
    expect(memory.rows("social_posts")[0]).toMatchObject({ id: "sp-manual", external_post_id: "ig-9" });
  });

  it("C3 · dos manuales que podrian ser el mismo post: no se adopta ninguna", async () => {
    const memory = db({
      content_posts: [
        { id: "post-1", workspace_id: WS, title: "Pieza 1" },
        { id: "post-2", workspace_id: WS, title: "Pieza 2" },
      ],
      social_posts: [
        {
          id: "sp-1",
          workspace_id: WS,
          content_post_id: "post-1",
          external_post_id: null,
          platform: "instagram",
          origin: "manual",
          status: "published",
          published_at: "2026-09-20T15:05:00Z",
          url: null,
          deleted_at: null,
        },
        {
          id: "sp-2",
          workspace_id: WS,
          content_post_id: "post-2",
          external_post_id: null,
          platform: "instagram",
          origin: "manual",
          status: "published",
          published_at: "2026-09-20T14:55:00Z",
          url: null,
          deleted_at: null,
        },
      ],
    });

    const result = await persistPosts(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      platform: "instagram",
      posts: [snapshot()],
      date: "2026-10-01",
      now: NOW,
    });

    // Ninguna de las dos se toca, y el post entra como externo suelto: no se
    // adivina, pero tampoco se pierde.
    expect(result.created).toBe(1);
    expect(memory.rows("social_posts")).toHaveLength(3);
    expect(memory.rows("social_posts").filter((r) => r.external_post_id === "ig-9")).toHaveLength(1);
  });

  it("C3 · un comentario ya habia creado la fila externa antes que la sincronizacion: se pasa a la pieza", async () => {
    const memory = db({
      content_posts: [{ id: "post-1", workspace_id: WS, title: "La pieza" }],
      social_posts: [
        {
          id: "sp-manual",
          workspace_id: WS,
          content_post_id: "post-1",
          external_post_id: null,
          platform: "instagram",
          origin: "manual",
          status: "published",
          published_at: null,
          url: "https://instagram.com/p/ig-9",
          deleted_at: null,
        },
        {
          id: "sp-externa",
          workspace_id: WS,
          content_post_id: null,
          social_account_id: ACC,
          external_post_id: "ig-9",
          platform: "instagram",
          origin: "external",
          status: null,
          deleted_at: null,
        },
      ],
    });

    const result = await persistPosts(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      platform: "instagram",
      posts: [snapshot({ url: "https://instagram.com/p/ig-9" })],
      date: "2026-10-01",
      now: NOW,
    });

    const live = memory.rows("social_posts").filter((r) => !r.deleted_at);
    expect(result.created).toBe(0);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      id: "sp-externa",
      content_post_id: "post-1",
      origin: "manual",
      status: "published",
      external_post_id: "ig-9",
    });
    // La manual vieja queda borrada de forma logica, no duplicada.
    expect(memory.rows("social_posts").find((r) => r.id === "sp-manual")?.deleted_at).toBeTruthy();
  });

  it("guarda la fila del dia de cada post", async () => {
    const memory = db();

    await persistPosts(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      platform: "instagram",
      posts: [snapshot(), snapshot({ externalPostId: "ig-10" })],
      date: "2026-10-01",
      now: NOW,
    });

    expect(memory.rows("social_post_metrics_daily")).toHaveLength(2);
  });
});

describe("la cuenta (F47)", () => {
  it("usa la fecha del snapshot cuando la trae", async () => {
    const memory = db();

    await persistAccountMetrics(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      date: "2026-10-01",
      snapshot: {
        date: "2026-09-15",
        followers: 100,
        followersGained: null,
        followersLost: null,
        impressions: null,
        reach: null,
        profileViews: null,
        extra: {},
      },
    });

    expect(memory.rows("social_account_metrics_daily")[0].date).toBe("2026-09-15");
  });

  it("sin fecha propia usa la de hoy", async () => {
    // Los lectores que dan un solo numero no saben de que dia es.
    const memory = db();

    await persistAccountMetrics(memory.client, {
      workspaceId: WS,
      socialAccountId: ACC,
      date: "2026-10-01",
      snapshot: {
        date: "",
        followers: 100,
        followersGained: null,
        followersLost: null,
        impressions: null,
        reach: null,
        profileViews: null,
        extra: {},
      },
    });

    expect(memory.rows("social_account_metrics_daily")[0].date).toBe("2026-10-01");
  });
});

describe("que posts tocan hoy (F47)", () => {
  it("uno reciente leido ayer, si; uno de hace meses, no", async () => {
    const memory = db({
      social_posts: [
        {
          id: "sp-1",
          social_account_id: ACC,
          external_post_id: "ig-1",
          published_at: "2026-09-28",
          last_synced_at: "2026-09-30",
          deleted_at: null,
        },
        {
          id: "sp-2",
          social_account_id: ACC,
          external_post_id: "ig-2",
          published_at: "2026-01-01",
          last_synced_at: null,
          deleted_at: null,
        },
      ],
    });

    const due = await postsDueForSync(memory.client, { socialAccountId: ACC, now: NOW });

    expect(due.map((p) => p.externalPostId)).toEqual(["ig-1"]);
  });
});

describe("congelar el engagement a 7 dias (F47)", () => {
  it("se calcula con las filas ya guardadas, sin pedirle nada a la red", async () => {
    const memory = db({
      social_posts: [{ id: "sp-1", published_at: "2026-09-01T00:00:00Z" }],
      social_post_metrics_daily: [
        { social_post_id: "sp-1", date: "2026-09-08", likes: 30, comments: 10, reach: 1000 },
      ],
    });

    const done = await maybeComputeD7(memory.client, {
      socialPostId: "sp-1",
      publishedAt: "2026-09-01T00:00:00Z",
      now: NOW,
    });

    expect(done).toBe(true);
    expect(memory.rows("social_posts")[0]).toMatchObject({
      interactions_d7: 40,
      reach_d7: 1000,
      engagement_d7: 4,
    });
  });

  it("un post de ayer todavia no tiene numero comparable", async () => {
    const memory = db({ social_posts: [{ id: "sp-1" }] });

    expect(
      await maybeComputeD7(memory.client, {
        socialPostId: "sp-1",
        publishedAt: "2026-09-30T00:00:00Z",
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("la fecha del workspace (F47)", () => {
  it("sin zona configurada cae a UTC (respaldo neutro, no la de ningun negocio en particular)", () => {
    expect(syncDate(new Date("2026-10-01T02:00:00Z"), null)).toBe("2026-10-01");
  });
});
