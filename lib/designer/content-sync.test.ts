import { describe, expect, it, vi } from "vitest";
import { mediaIdFor } from "@/lib/content/media-library";
import type { MediaEntry } from "@/lib/content/media";
import type { NetworkStateId } from "@/lib/content/network-state";
import { contentTarget } from "./content-map";
import {
  CONTENT_SYNC_WAIT_MS,
  DESIGN_CONTENT_SYNC_JOB,
  contentSyncKey,
  designFileId,
  designFileIds,
  designFileName,
  designGroups,
  designIdOfFile,
  designSyncStatus,
  enqueueContentSync,
  enqueueContentSyncIfLinked,
  isDesignFileId,
  pickTargetForLink,
  syncDecision,
  syncDecisionWithForce,
} from "./content-sync";
import { DESIGN, NOW, WS, world } from "./testing/content-fixtures";

const STATES: NetworkStateId[] = ["none", "tent", "sched", "pub", "fail"];

describe("syncDecision: qué se hace según el estado de la red (F64)", () => {
  it("sin fecha y con fecha tentativa («la subo yo») se actualiza sola", () => {
    expect(syncDecision("none")).toBe("update");
    expect(syncDecision("tent")).toBe("update");
  });

  it("programada no se toca: se avisa", () => {
    expect(syncDecision("sched")).toBe("notify");
  });

  it("con la publicación fallida también avisa (opción conservadora, anotada en PENDIENTE)", () => {
    expect(syncDecision("fail")).toBe("notify");
  });

  it("publicada, o publicada a mano, nunca se toca", () => {
    expect(syncDecision("pub")).toBe("skip");
  });

  it("cubre los cinco estados y ninguno queda sin decisión", () => {
    for (const state of STATES) expect(["update", "notify", "skip"]).toContain(syncDecision(state));
  });

  it("«Actualizar los archivos» (force) actualiza lo programado y lo fallido, pero lo publicado nunca", () => {
    expect(syncDecisionWithForce("sched", true)).toBe("update");
    expect(syncDecisionWithForce("fail", true)).toBe("update");
    expect(syncDecisionWithForce("pub", true)).toBe("skip");
    expect(syncDecisionWithForce("tent", true)).toBe("update");
    expect(syncDecisionWithForce("sched", false)).toBe("notify");
  });
});

describe("ids estables de los archivos del diseño (F64)", () => {
  it("un PNG por página, con n desde 1, y el PDF con su propio id", () => {
    expect(designFileId(DESIGN, "png", 1)).toBe(`design-${DESIGN}-1`);
    expect(designFileId(DESIGN, "png", 12)).toBe(`design-${DESIGN}-12`);
    expect(designFileId(DESIGN, "pdf")).toBe(`design-${DESIGN}-pdf`);
  });

  it("el nombre del archivo en el bucket es el id más la extensión, y `mediaIdFor` vuelve a dar el mismo id", () => {
    for (const [output, page] of [["png", 1], ["png", 7], ["pdf", 1]] as const) {
      const name = designFileName(DESIGN, output, page);
      expect(name.endsWith(output === "pdf" ? ".pdf" : ".png")).toBe(true);
      expect(mediaIdFor(`${WS}/post/${name}`)).toBe(designFileId(DESIGN, output, page));
    }
  });

  it("los ids de un plan salen en el orden en que se publican", () => {
    expect(designFileIds(DESIGN, { output: "png", count: 3 })).toEqual([`design-${DESIGN}-1`, `design-${DESIGN}-2`, `design-${DESIGN}-3`]);
    expect(designFileIds(DESIGN, { output: "pdf", count: 1 })).toEqual([`design-${DESIGN}-pdf`]);
  });

  it("los ids NO cambian entre sincronizaciones: dos corridas con las mismas páginas dan los mismos", () => {
    expect(designFileIds(DESIGN, { output: "png", count: 5 })).toEqual(designFileIds(DESIGN, { output: "png", count: 5 }));
    // Sumar una página agrega un id al final; los anteriores siguen siendo los mismos.
    const before = designFileIds(DESIGN, { output: "png", count: 3 });
    const after = designFileIds(DESIGN, { output: "png", count: 4 });
    expect(after.slice(0, 3)).toEqual(before);
  });

  it("reconoce de qué diseño es un id y no confunde un archivo subido a mano", () => {
    expect(designIdOfFile(`design-${DESIGN}-3`)).toBe(DESIGN);
    expect(designIdOfFile(`design-${DESIGN}-pdf`)).toBe(DESIGN);
    expect(designIdOfFile("5f1c2d3e-aaaa-bbbb-cccc-1234567890ab")).toBeNull();
    expect(designIdOfFile("design-no-es-un-uuid-1")).toBeNull();
    expect(isDesignFileId(`design-${DESIGN}-2`, DESIGN)).toBe(true);
    expect(isDesignFileId(`design-${DESIGN}-2`, "otro")).toBe(false);
    expect(isDesignFileId("foto-1")).toBe(false);
  });
});

const file = (id: string, extra: Partial<MediaEntry> = {}): MediaEntry => ({
  id,
  storage_path: `${WS}/post/${id}.png`,
  mime_type: "image/png",
  kind: "image",
  size_bytes: 10,
  ...extra,
});

describe("designGroups: la biblioteca agrupada por diseño (F65)", () => {
  it("agrupa por design_id, deja afuera lo subido a mano y lo borrado", () => {
    const groups = designGroups([
      file("manual"),
      file("a2", { design_id: "d1", design_page: 2, design_version: 3 }),
      file("a1", { design_id: "d1", design_page: 1, design_version: 3 }),
      file("b1", { design_id: "d2", design_page: 1, design_version: 1 }),
      file("a3", { design_id: "d1", design_page: 3, design_version: 3, deleted_at: "2026-11-01T00:00:00Z" }),
    ]);

    expect(groups.map((g) => g.designId)).toEqual(["d1", "d2"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a1", "a2"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["b1"]);
  });

  it("las páginas salen por número y el PDF va al final", () => {
    const [group] = designGroups([file("pdf", { design_id: "d1", design_page: null, design_version: 2 }), file("p2", { design_id: "d1", design_page: 2 }), file("p1", { design_id: "d1", design_page: 1 })]);

    expect(group.entries.map((e) => e.id)).toEqual(["p1", "p2", "pdf"]);
  });

  it("la versión del grupo es la más nueva de sus archivos; sin ninguna, null", () => {
    expect(designGroups([file("a", { design_id: "d1", design_version: 2 }), file("b", { design_id: "d1", design_version: 5 })])[0].version).toBe(5);
    expect(designGroups([file("a", { design_id: "d1" })])[0].version).toBeNull();
  });

  it("sin archivos de diseño no hay grupos (la pieza se ve como siempre)", () => {
    expect(designGroups([])).toEqual([]);
    expect(designGroups([file("a"), file("b")])).toEqual([]);
    expect(designGroups([file("a", { design_id: "" })])).toEqual([]);
  });
});

describe("designSyncStatus: el aviso «El diseño cambió» (F64, F65)", () => {
  it("con los archivos al día no hay nada pendiente", () => {
    expect(designSyncStatus({ designRev: 4, syncedVersion: 4, networkState: "sched" })).toBe("synced");
    expect(designSyncStatus({ designRev: 3, syncedVersion: 4, networkState: "tent" })).toBe("synced");
  });

  it("si el diseño cambió y la red se actualiza sola, está pendiente", () => {
    expect(designSyncStatus({ designRev: 5, syncedVersion: 4, networkState: "tent" })).toBe("pending");
    expect(designSyncStatus({ designRev: 5, syncedVersion: 4, networkState: "none" })).toBe("pending");
  });

  it("si el diseño cambió y la red está programada o falló, hay que decidir", () => {
    expect(designSyncStatus({ designRev: 5, syncedVersion: 4, networkState: "sched" })).toBe("changed");
    expect(designSyncStatus({ designRev: 5, syncedVersion: 4, networkState: "fail" })).toBe("changed");
  });

  it("una red publicada nunca avisa ni queda pendiente", () => {
    expect(designSyncStatus({ designRev: 9, syncedVersion: 1, networkState: "pub" })).toBe("synced");
    expect(designSyncStatus({ designRev: 9, syncedVersion: null, networkState: "pub" })).toBe("synced");
  });

  it("sin ninguna sincronización todavía: pendiente si va a armarse sola, aviso si está programada", () => {
    expect(designSyncStatus({ designRev: 1, syncedVersion: null, networkState: "tent" })).toBe("pending");
    expect(designSyncStatus({ designRev: 1, syncedVersion: null, networkState: "sched" })).toBe("changed");
  });

  it("si la red ya no está en la pieza, no hay a dónde sincronizar", () => {
    expect(designSyncStatus({ designRev: 5, syncedVersion: 1, networkState: null })).toBe("synced");
  });
});

describe("pickTargetForLink: la publicación al vincular a una pieza existente", () => {
  it("respeta el formato que la red de la pieza ya tiene si sirve", () => {
    expect(pickTargetForLink({ platform: "instagram", designFormat: "v45", pageCount: 3, existingFormat: "image" })?.format).toBe("image");
  });

  it("sin formato, un diseño de varias páginas va a un carrusel y uno de una página a una imagen", () => {
    expect(pickTargetForLink({ platform: "instagram", designFormat: "v45", pageCount: 5 })?.format).toBe("carousel");
    expect(pickTargetForLink({ platform: "instagram", designFormat: "v45", pageCount: 1 })?.format).toBe("image");
    expect(pickTargetForLink({ platform: "linkedin", designFormat: "sq", pageCount: 6 })?.format).toBe("pdf");
    expect(pickTargetForLink({ platform: "linkedin", designFormat: "sq", pageCount: 1 })?.format).toBe("image");
  });

  it("un formato de la red que no se arma con un diseño (un Reel) no gana: se elige uno que sirva", () => {
    expect(pickTargetForLink({ platform: "instagram", designFormat: "v45", pageCount: 4, existingFormat: "reel" })?.format).toBe("carousel");
  });

  it("un diseño que no sirve para esa red da null", () => {
    expect(pickTargetForLink({ platform: "instagram", designFormat: "carta_v", pageCount: 2 })).toBeNull();
    expect(pickTargetForLink({ platform: "youtube", designFormat: "v45", pageCount: 2 })).toBeNull();
    expect(pickTargetForLink({ platform: "linkedin", designFormat: "carta_v", pageCount: 3 })?.format).toBe("pdf");
  });

  it("una historia de varias páginas va a la historia de Instagram o a las fotos de TikTok", () => {
    expect(pickTargetForLink({ platform: "tiktok", designFormat: "story", pageCount: 4 })).toEqual(contentTarget("tiktok", "photos"));
    expect(pickTargetForLink({ platform: "instagram", designFormat: "story", pageCount: 4 })?.format).toBe("story");
  });
});

describe("encolar la sincronización", () => {
  it("la clave junta los guardados seguidos en una sola sincronización, y la forzada es otra", () => {
    expect(contentSyncKey(DESIGN)).toBe(`design_content_sync:${DESIGN}`);
    expect(contentSyncKey(DESIGN, true)).toBe(`design_content_sync:${DESIGN}:force`);
    expect(DESIGN_CONTENT_SYNC_JOB).toBe("design_content_sync");
  });

  it("enqueueContentSync agenda con la espera y la clave", async () => {
    const schedule = vi.fn(async () => ({ id: "j" }));
    const out = await enqueueContentSync(world().client, { designId: DESIGN }, { waitMs: CONTENT_SYNC_WAIT_MS, schedule: schedule as never, now: () => NOW });

    expect(out).toEqual({ queued: true });
    const [, type, payload, runAt, key] = schedule.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>, Date, string];
    expect(type).toBe("design_content_sync");
    expect(payload).toEqual({ designId: DESIGN });
    expect(runAt.getTime()).toBe(NOW.getTime() + 30_000);
    expect(key).toBe(`design_content_sync:${DESIGN}`);
  });

  it("con una igual pendiente (23505) alcanza con esa y no es un error", async () => {
    const schedule = vi.fn(async () => {
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    });
    expect(await enqueueContentSync(world().client, { designId: DESIGN }, { schedule: schedule as never })).toEqual({ queued: false });
  });

  it("otro error sí sube (no se traga un fallo de la cola)", async () => {
    const schedule = vi.fn(async () => {
      throw new Error("caída");
    });
    await expect(enqueueContentSync(world().client, { designId: DESIGN }, { schedule: schedule as never })).rejects.toThrow("caída");
  });

  it("guardar una versión de un diseño VINCULADO encola con 30 s de espera", async () => {
    const schedule = vi.fn(async () => ({ id: "j" }));
    const out = await enqueueContentSyncIfLinked(world().client, DESIGN, { schedule: schedule as never, now: () => NOW });

    expect(out).toEqual({ queued: true });
    const [, , , runAt] = schedule.mock.calls[0] as unknown as [unknown, string, unknown, Date];
    expect(runAt.getTime() - NOW.getTime()).toBe(CONTENT_SYNC_WAIT_MS);
  });

  it("un diseño sin pieza, archivado, plantilla o inexistente no encola nada", async () => {
    for (const design of [{ content_post_id: null }, { archived_at: "2026-11-01T00:00:00Z" }, { template_id: "t1" }]) {
      const schedule = vi.fn(async () => ({ id: "j" }));
      expect(await enqueueContentSyncIfLinked(world({ design }).client, DESIGN, { schedule: schedule as never })).toEqual({ queued: false });
      expect(schedule).not.toHaveBeenCalled();
    }
    const schedule = vi.fn(async () => ({ id: "j" }));
    expect(await enqueueContentSyncIfLinked(world().client, "no-existe", { schedule: schedule as never })).toEqual({ queued: false });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("nunca lanza: si la cola falla, guardar el diseño sigue andando", async () => {
    const schedule = vi.fn(async () => {
      throw new Error("caída");
    });
    expect(await enqueueContentSyncIfLinked(world().client, DESIGN, { schedule: schedule as never })).toEqual({ queued: false });
  });
});
