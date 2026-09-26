import { describe, it, expect } from "vitest";
import { planCleanup, type PostToClean } from "./cleanup";
import type { MediaEntry } from "./media";

const NOW = new Date("2026-09-26T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const media = (path: string, over: Partial<MediaEntry> = {}): MediaEntry => ({
  storage_path: path,
  mime_type: "video/mp4",
  kind: "video",
  size_bytes: 1000,
  ...over,
});

const post = (over: Partial<PostToClean> = {}): PostToClean => ({
  id: "p1",
  publishedAt: daysAgo(40),
  media: [media("ws/p1/a.mp4")],
  ...over,
});

describe("limpiar la media publicada (F23)", () => {
  it("una pieza publicada hace 40 dias con retencion 30: se borra y queda marcada", () => {
    const plans = planCleanup({ posts: [post()], retentionDays: 30, now: NOW });

    expect(plans).toHaveLength(1);
    expect(plans[0].paths).toEqual(["ws/p1/a.mp4"]);
    expect(plans[0].media[0].deleted_at).toBeTruthy();
  });

  it("publicada hace 10 dias con retencion 30: no se toca", () => {
    expect(planCleanup({ posts: [post({ publishedAt: daysAgo(10) })], retentionDays: 30, now: NOW })).toEqual([]);
  });

  it("retencion 0 es no borrar nunca", () => {
    // Lo que se pone cuando el archivo original es la unica copia.
    expect(planCleanup({ posts: [post()], retentionDays: 0, now: NOW })).toEqual([]);
  });

  it("una pieza que nunca se publico conserva su media, por vieja que sea", () => {
    // La fecha que importa es la de publicacion, no la de subida.
    expect(planCleanup({ posts: [post({ publishedAt: null })], retentionDays: 30, now: NOW })).toEqual([]);
  });

  it("lo que ya estaba borrado no se vuelve a borrar", () => {
    const plans = planCleanup({
      posts: [post({ media: [media("ws/p1/a.mp4", { deleted_at: daysAgo(5) })] })],
      retentionDays: 30,
      now: NOW,
    });

    expect(plans).toEqual([]);
  });

  it("de una pieza con parte borrada, solo se borra lo que queda", () => {
    const plans = planCleanup({
      posts: [
        post({
          media: [media("ws/p1/a.mp4", { deleted_at: daysAgo(5) }), media("ws/p1/b.mp4")],
        }),
      ],
      retentionDays: 30,
      now: NOW,
    });

    expect(plans[0].paths).toEqual(["ws/p1/b.mp4"]);
    // La marca vieja no se pisa con la de hoy.
    expect(plans[0].media[0].deleted_at).toBe(daysAgo(5));
  });

  it("una fecha rota se saltea en vez de romper el cron", () => {
    expect(planCleanup({ posts: [post({ publishedAt: "ayer" })], retentionDays: 30, now: NOW })).toEqual([]);
  });
});
