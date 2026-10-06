/**
 * F77: el conteo del día para el tope diario.
 *
 * Lo que hay que fijar: que el día sea el de la zona del workspace (no UTC),
 * que lo hecho a mano en la red cuente, que lo fallido no cuente, y que
 * reprogramar una pieza no la cuente contra sí misma.
 */
import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { countPublicationsForDay } from "./daily-count";

const WS = "ws-1";
const TZ = "America/Costa_Rica"; // UTC-6, sin horario de verano
// 3 de octubre, 12:00 en Costa Rica = 18:00 UTC.
const AT = new Date("2026-10-03T18:00:00Z");

const row = (id: string, over: Record<string, unknown>) => ({
  id,
  workspace_id: WS,
  platform: "tiktok",
  content_post_id: null,
  status: "published",
  media_type: null,
  scheduled_at: null,
  published_at: null,
  deleted_at: null,
  ...over,
});

const count = (rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  countPublicationsForDay(memoryDb({ social_posts: rows }).client as never, {
    workspaceId: WS,
    platform: "tiktok",
    at: AT,
    timeZone: TZ,
    ...extra,
  });

describe("countPublicationsForDay (F77)", () => {
  it("cuenta lo publicado y lo agendado para ese día, separado por tipo", async () => {
    const out = await count([
      row("a", { published_at: "2026-10-03T15:00:00Z", media_type: "video" }),
      row("b", { published_at: "2026-10-03T16:00:00Z", media_type: "carousel" }),
      row("c", { status: "scheduled", scheduled_at: "2026-10-03T23:00:00Z", media_type: "video" }),
    ]);

    expect(out).toEqual({ total: 3, video: 2, image: 1 });
  });

  it("el día es el de la zona del workspace, no el de UTC", async () => {
    // Costa Rica es UTC-6. El 3 de octubre local va de las 06:00 UTC del 3
    // hasta las 06:00 UTC del 4.
    //  - 04:00 UTC del 4  = 22:00 del 3 local: DENTRO (en UTC ya es el 4).
    //  - 07:00 UTC del 3  = 01:00 del 3 local: DENTRO.
    //  - 06:30 UTC del 4  = 00:30 del 4 local: FUERA.
    //  - 05:30 UTC del 3  = 23:30 del 2 local: FUERA.
    const out = await count([
      row("dentro-noche", { published_at: "2026-10-04T04:00:00Z" }),
      row("dentro-madrugada", { published_at: "2026-10-03T07:00:00Z" }),
      row("fuera-ya-es-4", { published_at: "2026-10-04T06:30:00Z" }),
      row("fuera-ya-era-2", { published_at: "2026-10-03T05:30:00Z" }),
    ]);

    expect(out.total).toBe(2);
  });

  it("lo publicado a mano en la red (status null) también gasta el tope", async () => {
    const out = await count([row("externa", { status: null, published_at: "2026-10-03T15:00:00Z" })]);

    expect(out.total).toBe(1);
  });

  it("lo fallido y lo cancelado no cuentan", async () => {
    const out = await count([
      row("f", { status: "failed", published_at: "2026-10-03T15:00:00Z" }),
      row("c", { status: "cancelled", scheduled_at: "2026-10-03T20:00:00Z" }),
    ]);

    expect(out.total).toBe(0);
  });

  it("reprogramar una pieza no la cuenta contra sí misma", async () => {
    const rows = [row("a", { status: "scheduled", scheduled_at: "2026-10-03T20:00:00Z", content_post_id: "pieza-1" })];

    expect((await count(rows)).total).toBe(1);
    expect((await count(rows, { excludePostId: "pieza-1" })).total).toBe(0);
  });

  it("no mezcla otra red ni una fila borrada", async () => {
    const out = await count([
      row("ig", { platform: "instagram", published_at: "2026-10-03T15:00:00Z" }),
      row("borrada", { published_at: "2026-10-03T15:00:00Z", deleted_at: "2026-10-03T16:00:00Z" }),
    ]);

    expect(out.total).toBe(0);
  });

  it("un tipo desconocido cuenta en el total pero no en video ni fotos", async () => {
    const out = await count([row("a", { published_at: "2026-10-03T15:00:00Z", media_type: null })]);

    expect(out).toEqual({ total: 1, video: 0, image: 0 });
  });
});
