/**
 * Editar una pieza que ya esta agendada en Zernio (cambio aprobado M10).
 *
 * Zernio guarda su propia copia del texto al programar. Si se edita la pieza y
 * nadie le avisa, publica la version vieja mientras la pantalla muestra la
 * nueva: el caso que estos tests cuidan.
 */

import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { CONTENT_PROVIDER_SCHEDULE_JOB } from "@/lib/content/jobs";
import { applyContentResync, planContentResync, type PieceContentState } from "./content-resync";

const WS = "ws-1";
const IMAGE = {
  id: "m1",
  storage_path: `${WS}/content/a.jpg`,
  mime_type: "image/jpeg",
  kind: "image",
  size_bytes: 120_000,
  width: 1080,
  height: 1080,
};

const piece = (over: Partial<PieceContentState> = {}): PieceContentState => ({
  caption: "Texto aprobado",
  media: [IMAGE],
  networks: [
    { platform: "instagram", planned_at: "2026-10-30T15:00:00.000Z" },
    { platform: "linkedin", planned_at: "2026-10-30T15:00:00.000Z" },
  ],
  ...over,
});

function seed(rows: Record<string, unknown>[]) {
  return memoryDb({
    social_posts: rows.map((r) => ({
      workspace_id: WS,
      content_post_id: "post-1",
      deleted_at: null,
      scheduled_at: "2026-10-30T15:00:00.000Z",
      ...r,
    })),
    scheduled_jobs: [],
  });
}

const zernioIg = { id: "sp-ig", platform: "instagram", status: "scheduled", publisher: "zernio", publisher_ref: "zp-1" };
const directLi = { id: "sp-li", platform: "linkedin", status: "scheduled", publisher: "linkedin", publisher_ref: null };

describe("que redes agendadas en Zernio hay que reenviar", () => {
  it("cambia el caption base: se reenvia la de Zernio, no la de nuestra cola (esa lee la pieza al publicar)", async () => {
    const db = seed([zernioIg, directLi]);
    const plan = await planContentResync(db.client as never, {
      postId: "post-1",
      before: piece(),
      after: piece({ caption: "Texto corregido" }),
    });
    expect(plan).toEqual({ ok: true, targets: [{ id: "sp-ig", platform: "instagram" }] });
  });

  it("si solo cambia la fecha, no hay nada que reenviar (de eso se encarga reprogramar)", async () => {
    const db = seed([zernioIg]);
    const plan = await planContentResync(db.client as never, {
      postId: "post-1",
      before: piece(),
      after: piece({ networks: [{ platform: "instagram", planned_at: "2026-11-02T15:00:00.000Z" }] }),
    });
    expect(plan).toEqual({ ok: true, targets: [] });
  });

  it("una red con caption propio no cambia cuando cambia el base", async () => {
    const db = seed([zernioIg]);
    const networks = [{ platform: "instagram", caption: "El de Instagram" }];
    const plan = await planContentResync(db.client as never, {
      postId: "post-1",
      before: piece({ networks }),
      after: piece({ networks, caption: "Otro base" }),
    });
    expect(plan).toEqual({ ok: true, targets: [] });
  });

  it("un archivo nuevo en la biblioteca cambia lo que publica una red que usa la base", async () => {
    const db = seed([zernioIg]);
    const extra = { ...IMAGE, id: "m2", storage_path: `${WS}/content/b.jpg` };
    const plan = await planContentResync(db.client as never, {
      postId: "post-1",
      before: piece(),
      after: piece({ media: [IMAGE, extra] }),
    });
    expect(plan.ok && plan.targets.map((t) => t.id)).toEqual(["sp-ig"]);
  });

  it("una publicacion ya publicada no se reenvia", async () => {
    const db = seed([{ ...zernioIg, status: "published" }]);
    const plan = await planContentResync(db.client as never, {
      postId: "post-1",
      before: piece(),
      after: piece({ caption: "Despues de publicar" }),
    });
    expect(plan).toEqual({ ok: true, targets: [] });
  });

  it("si la version nueva no se puede publicar, se frena el guardado con un motivo claro", async () => {
    const db = seed([zernioIg]);
    const plan = await planContentResync(db.client as never, {
      postId: "post-1",
      before: piece(),
      after: piece({ caption: "x".repeat(5000) }),
    });
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.error).toMatch(/^Instagram está programada/);
  });
});

describe("reenviar", () => {
  it("la fila vuelve a 'uploading' y el job de agenda del proveedor corre ya", async () => {
    const db = seed([zernioIg]);
    const warnings = await applyContentResync(db.client as never, {
      workspaceId: WS,
      targets: [{ id: "sp-ig", platform: "instagram" }],
    });

    expect(warnings).toEqual([]);
    expect(db.tables.social_posts?.[0]?.status).toBe("uploading");
    const jobs = (db.tables.scheduled_jobs ?? []).filter((j) => j.type === CONTENT_PROVIDER_SCHEDULE_JOB);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({ socialPostId: "sp-ig", workspaceId: WS });
  });

  it("una fila que ya estaba en camino (la fecha cambio en el mismo guardado) no encola otro job", async () => {
    const db = seed([{ ...zernioIg, status: "uploading" }]);
    const warnings = await applyContentResync(db.client as never, {
      workspaceId: WS,
      targets: [{ id: "sp-ig", platform: "instagram" }],
    });

    expect(warnings).toEqual([]);
    expect(db.tables.scheduled_jobs ?? []).toHaveLength(0);
  });
});
