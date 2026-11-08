import { describe, expect, it, vi } from "vitest";
import { RenderFailed, RenderNotConfigured, RENDER_NOT_CONFIGURED_MESSAGE, type RenderRequest } from "../render-client";
import { designFileId } from "../content-sync";
import { CONTENT_MEDIA_BUCKET, DESIGN_CONTENT_SYNC_JOB, runContentSync } from "./content-sync";
import { DESIGN, NOW, POST, WS, docWithPages, mediaOf, networksOf, post, world } from "../testing/content-fixtures";
import type { MemoryDb } from "../testing/memory-db";

const png = (n: number) => `design-${DESIGN}-${n}`;
const PDF = `design-${DESIGN}-pdf`;
const path = (id: string, ext = "png") => `${WS}/${POST}/${id}.${ext}`;

/** Un servicio de render simulado: un PNG por página pedida o un PDF. */
function fakeRender() {
  return vi.fn(async (req: RenderRequest) => ({
    version: "test",
    files:
      req.format === "pdf"
        ? [{ page: 0, contentType: "application/pdf" as const, bytes: new Uint8Array([37, 80, 68, 70, 45, 49]) }]
        : (req.pages ?? [{ html: req.html! }]).map((_, page) => ({ page, contentType: "image/png" as const, bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]) })),
  }));
}

const deps = (render = fakeRender()) => ({ render, now: () => NOW, schedule: vi.fn(async () => ({ id: "job" })) as never });

const sync = (db: MemoryDb, payload: Record<string, unknown> = {}, d = deps()) => runContentSync(db.client, { designId: DESIGN, ...payload }, d);

describe("design_content_sync: una pieza en Borrador (F64)", () => {
  it("sube un PNG por página, los anota en la biblioteca con su id y deja la red con esos ids en orden", async () => {
    const db = world({ pages: 3, rev: 4 });
    const render = fakeRender();
    const out = await sync(db, {}, deps(render));

    expect(out).toMatchObject({ status: "synced", networks: ["instagram"], files: [png(1), png(2), png(3)] });
    // Todo en el bucket de Contenido, con la forma `<negocio>/<pieza>/<archivo>`.
    expect(db.paths(CONTENT_MEDIA_BUCKET)).toEqual([path(png(1)), path(png(2)), path(png(3))].sort());
    expect(mediaOf(db).map((m) => m.id)).toEqual([png(1), png(2), png(3)]);
    expect(mediaOf(db)[1]).toMatchObject({ id: png(2), storage_path: path(png(2)), mime_type: "image/png", kind: "image", width: 1080, height: 1350, design_id: DESIGN, design_version: 4, design_page: 2, deleted_at: null });
    expect(networksOf(db)[0].files).toEqual([png(1), png(2), png(3)]);
    // El render es PNG ×1 al tamaño del diseño, una sola vez.
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toMatchObject({ format: "png", width: 1080, height: 1350, scale: 1 });
    // La pieza sigue en Borrador: sincronizar no cambia su estado.
    expect(post(db).status).toBe("draft");
  });

  it("los ids no cambian entre sincronizaciones: las redes siguen apuntando a los mismos", async () => {
    const db = world({ pages: 3, rev: 4 });
    await sync(db);
    const firstIds = mediaOf(db).map((m) => m.id);
    const firstFiles = [...(networksOf(db)[0].files as string[])];

    db.rows("designs")[0].rev = 7;
    await sync(db);

    expect(mediaOf(db).map((m) => m.id)).toEqual(firstIds);
    expect(networksOf(db)[0].files).toEqual(firstFiles);
    // Cambia la versión del diseño, no los ids.
    expect(mediaOf(db).every((m) => m.design_version === 7)).toBe(true);
    expect(db.paths(CONTENT_MEDIA_BUCKET)).toHaveLength(3);
  });

  it("si al diseño se le suma una página, las anteriores siguen con su id y la nueva entra al final", async () => {
    const db = world({ pages: 2 });
    await sync(db);
    db.rows("designs")[0].doc = docWithPages("v45", 3);
    db.rows("designs")[0].rev = 5;
    await sync(db);

    expect(networksOf(db)[0].files).toEqual([png(1), png(2), png(3)]);
    expect(mediaOf(db).map((m) => m.id)).toEqual([png(1), png(2), png(3)]);
  });

  it("si al diseño se le saca una página, la que sobra sale de la biblioteca y del bucket, y de la red", async () => {
    const db = world({ pages: 3 });
    await sync(db);
    db.rows("designs")[0].doc = docWithPages("v45", 2);
    db.rows("designs")[0].rev = 5;
    await sync(db);

    expect(mediaOf(db).map((m) => m.id)).toEqual([png(1), png(2)]);
    expect(networksOf(db)[0].files).toEqual([png(1), png(2)]);
    expect(db.paths(CONTENT_MEDIA_BUCKET)).toEqual([path(png(1)), path(png(2))]);
  });

  it("una página que sobra en una pieza ya publicada se marca borrada pero NO se borra del bucket", async () => {
    const db = world({
      pages: 3,
      networks: [
        { platform: "instagram", planned_at: null, format: "carousel", files: [] },
        { platform: "threads", planned_at: null, format: "carousel", files: [] },
      ],
      accounts: [],
    });
    await sync(db, { networks: ["threads"] });
    // Threads sale (publicada a mano) y la pieza queda publicada a medias: la red de Instagram sigue siendo del diseño.
    db.rows("social_posts").push({ id: "sp", content_post_id: POST, platform: "threads", status: "published", scheduled_at: null, published_at: "2026-11-09T00:00:00Z", origin: "manual", deleted_at: null });
    post(db).status = "partially_published";
    db.rows("designs")[0].doc = docWithPages("v45", 2);
    db.rows("designs")[0].rev = 5;
    await sync(db);

    // Threads publicó con las tres páginas y no se toca; por eso la tercera se queda.
    expect(networksOf(db).find((n) => n.platform === "threads")!.files).toEqual([png(1), png(2), png(3)]);
    expect(db.paths(CONTENT_MEDIA_BUCKET)).toContain(path(png(3)));
    expect(mediaOf(db).some((m) => m.id === png(3) && !m.deleted_at)).toBe(true);
  });

  it("lo que la persona subió a mano, sus portadas y el resto de la pieza no se tocan", async () => {
    const manual = { id: "manual-1", storage_path: `${WS}/${POST}/manual-1.jpg`, mime_type: "image/jpeg", kind: "image", size_bytes: 5 };
    const db = world({ pages: 2, media: [manual], networks: [{ platform: "instagram", planned_at: "2026-12-01T10:00:00Z", format: "carousel", files: ["manual-1"], caption: "Propio", options: { a: 1 } }] });
    await sync(db);

    expect(mediaOf(db)[0]).toMatchObject({ id: "manual-1" });
    expect(networksOf(db)[0]).toMatchObject({ planned_at: "2026-12-01T10:00:00Z", caption: "Propio", options: { a: 1 }, format: "carousel", files: [png(1), png(2)] });
    expect(post(db).caption).toBe("Un caption");
  });

  it("conserva la portada y el texto alternativo que la persona le puso a un archivo del diseño", async () => {
    const db = world({ pages: 2 });
    await sync(db);
    const entry = mediaOf(db)[0];
    entry.is_cover = true;
    entry.alt_text = "Portada";
    db.rows("designs")[0].rev = 9;
    await sync(db);

    expect(mediaOf(db)[0]).toMatchObject({ is_cover: true, alt_text: "Portada", design_version: 9 });
  });

  it("un carrusel con una sola página queda armado pero con el aviso de Contenido (no se programa)", async () => {
    const db = world({ pages: 1 });
    const out = await sync(db);

    expect(out.status).toBe("synced");
    expect((out as { warnings: string[] }).warnings.join(" ")).toContain("Faltan archivos");
    expect(networksOf(db)[0].files).toEqual([png(1)]);
  });

  it("una imagen con varias páginas deja todas y avisa que sobran, sin recortar en silencio", async () => {
    const db = world({ pages: 3, networks: [{ platform: "instagram", planned_at: null, format: "image", files: [] }] });
    const out = await sync(db);

    expect(networksOf(db)[0].files).toEqual([png(1), png(2), png(3)]);
    expect((out as { warnings: string[] }).warnings.join(" ")).toContain("Sobran archivos");
  });
});

describe("design_content_sync: según el estado de cada red (F64)", () => {
  const oldMedia = [1, 2, 3].map((n) => ({ id: png(n), storage_path: path(png(n)), mime_type: "image/png", kind: "image", size_bytes: 10, design_id: DESIGN, design_version: 3, design_page: n }));
  const scheduledNet = [{ platform: "instagram", planned_at: "2026-12-01T10:00:00Z", format: "carousel", files: [png(1), png(2), png(3)] }];
  const queued = (status: string) => [{ id: "sp", content_post_id: POST, platform: "instagram", status, scheduled_at: "2026-12-01T10:00:00Z", published_at: null, origin: "system", publisher: null, publisher_ref: null, deleted_at: null }];

  it("Programada: no se toca. No renderiza ni sube nada y avisa que quedó sin actualizar", async () => {
    const db = world({ pages: 3, rev: 4, media: oldMedia, networks: scheduledNet, publications: queued("scheduled") });
    const render = fakeRender();
    const before = JSON.stringify(post(db));
    const out = await sync(db, {}, deps(render));

    expect(out).toEqual({ status: "noop", held: [{ platform: "instagram", action: "notify", reason: "scheduled" }] });
    expect(render).not.toHaveBeenCalled();
    expect(JSON.stringify(post(db))).toBe(before);
    expect(db.paths(CONTENT_MEDIA_BUCKET)).toEqual([]);
  });

  it("Programada con «Actualizar los archivos» (force): ahí sí se actualiza, con los mismos ids", async () => {
    const db = world({ pages: 3, rev: 5, media: oldMedia, networks: scheduledNet, publications: queued("scheduled") });
    const out = await sync(db, { force: true });

    expect(out.status).toBe("synced");
    expect(mediaOf(db).map((m) => [m.id, m.design_version])).toEqual([[png(1), 5], [png(2), 5], [png(3), 5]]);
    expect(networksOf(db)[0].files).toEqual([png(1), png(2), png(3)]);
  });

  it("Programada en Zernio con force: se valida ANTES de escribir; un carrusel de una página no pasa y no se guarda nada", async () => {
    const zernio = [{ id: "sp", content_post_id: POST, platform: "instagram", status: "scheduled", scheduled_at: "2026-12-01T10:00:00Z", published_at: null, origin: "system", publisher: "zernio", publisher_ref: "z-1", deleted_at: null }];
    const db = world({ pages: 1, rev: 5, media: oldMedia, networks: scheduledNet, publications: zernio });
    const out = await sync(db, { force: true });

    expect(out.status).toBe("failed");
    expect((out as { error: string }).error).toContain("está programada y así no se puede publicar");
    // Nada se escribió: la pieza queda como estaba.
    expect(mediaOf(db).map((m) => m.id)).toEqual([png(1), png(2), png(3)]);
    expect(networksOf(db)[0].files).toEqual([png(1), png(2), png(3)]);
    expect(db.paths(CONTENT_MEDIA_BUCKET)).toEqual([]);
  });

  it("Fallo: se trata como programada (aviso), y con force se actualiza", async () => {
    const db = world({ pages: 3, rev: 5, media: oldMedia, networks: scheduledNet, publications: queued("failed") });

    expect(await sync(db)).toEqual({ status: "noop", held: [{ platform: "instagram", action: "notify", reason: "failed" }] });
    expect((await sync(db, { force: true })).status).toBe("synced");
  });

  it("Publicada (también a mano): nunca se toca, ni con force", async () => {
    const published = [{ id: "sp", content_post_id: POST, platform: "instagram", status: "published", scheduled_at: null, published_at: "2026-11-09T00:00:00Z", origin: "manual", deleted_at: null }];
    const db = world({ pages: 3, rev: 9, media: oldMedia, networks: scheduledNet, publications: published, postStatus: "published" });
    const render = fakeRender();
    const before = JSON.stringify(post(db));

    expect(await sync(db, { force: true }, deps(render))).toEqual({ status: "noop", held: [{ platform: "instagram", action: "skip", reason: "published" }] });
    expect(render).not.toHaveBeenCalled();
    expect(JSON.stringify(post(db))).toBe(before);
  });

  it("Fecha tentativa (la subo yo, sin cola): se actualiza sola", async () => {
    const db = world({ pages: 3, rev: 5, media: oldMedia, networks: scheduledNet });

    expect((await sync(db)).status).toBe("synced");
  });

  it("una fila cancelada no cuenta como programada: vuelve a ser una fecha tentativa y se actualiza", async () => {
    const db = world({ pages: 3, rev: 5, media: oldMedia, networks: scheduledNet, publications: queued("cancelled") });

    expect((await sync(db)).status).toBe("synced");
  });

  it("una red en la cola sin cuenta conectada tampoco está programada de verdad: se actualiza", async () => {
    const db = world({ pages: 3, rev: 5, media: oldMedia, networks: scheduledNet, publications: queued("scheduled"), accounts: [] });

    expect((await sync(db)).status).toBe("synced");
  });

  it("si la persona cambió el formato de la red a uno que no se arma con un diseño (un Reel), no se toca", async () => {
    const db = world({ pages: 3, networks: [{ platform: "instagram", planned_at: null, format: "reel", files: ["x"] }] });

    expect(await sync(db)).toEqual({ status: "noop", held: [{ platform: "instagram", action: "skip", reason: "format" }] });
    expect(networksOf(db)[0].files).toEqual(["x"]);
  });

  it("si el diseño pasó a un formato que esa publicación no admite, no se toca", async () => {
    const db = world({ format: "a4_v", pages: 2 });

    expect(await sync(db)).toEqual({ status: "noop", held: [{ platform: "instagram", action: "skip", reason: "format_mismatch" }] });
  });

  it("con dos redes, se actualiza la que puede y la que está publicada queda como estaba", async () => {
    const db = world({
      pages: 3,
      media: oldMedia,
      networks: [
        { platform: "instagram", planned_at: null, format: "carousel", files: [png(1), png(2), png(3)] },
        { platform: "threads", planned_at: null, format: "carousel", files: [png(1), png(2)] },
      ],
      publications: [{ id: "sp", content_post_id: POST, platform: "threads", status: "published", scheduled_at: null, published_at: "2026-11-09T00:00:00Z", origin: "system", deleted_at: null }],
      accounts: [],
    });
    const out = await sync(db, { networks: ["threads"] });

    expect(out).toMatchObject({ status: "synced", networks: ["instagram"], held: [{ platform: "threads", action: "skip", reason: "published" }] });
    expect(networksOf(db).find((n) => n.platform === "threads")!.files).toEqual([png(1), png(2)]);
  });
});

describe("design_content_sync: PDF de LinkedIn y varias redes (F64)", () => {
  it("el carrusel PDF de LinkedIn es UN archivo con todas las páginas, con su id estable", async () => {
    const db = world({ format: "sq", pages: 4, networks: [{ platform: "linkedin", planned_at: null, format: "pdf", files: [] }], design: { content_network: "linkedin" }, accounts: [] });
    const render = fakeRender();
    const out = await sync(db, {}, deps(render));

    expect(out).toMatchObject({ status: "synced", files: [PDF] });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toMatchObject({ format: "pdf", width: 1080, height: 1080 });
    expect((render.mock.calls[0][0].pages ?? []).length).toBe(4);
    expect(mediaOf(db)).toHaveLength(1);
    expect(mediaOf(db)[0]).toMatchObject({ id: PDF, storage_path: path(PDF, "pdf"), mime_type: "application/pdf", kind: "document", design_id: DESIGN, design_page: null });
    expect(networksOf(db)[0].files).toEqual([PDF]);
    expect(db.paths(CONTENT_MEDIA_BUCKET)).toEqual([path(PDF, "pdf")]);
  });

  it("al crear una pieza con Instagram y LinkedIn, las dos reciben sus archivos: PNG por página y un PDF", async () => {
    const db = world({
      pages: 3,
      networks: [
        { platform: "instagram", planned_at: null, format: "carousel", files: [] },
        { platform: "linkedin", planned_at: null, format: "pdf", files: [] },
      ],
      accounts: [],
    });
    const render = fakeRender();
    const out = await sync(db, { networks: ["linkedin"] }, deps(render));

    expect(out).toMatchObject({ status: "synced", networks: ["instagram", "linkedin"] });
    expect(render).toHaveBeenCalledTimes(2);
    expect(networksOf(db)[0].files).toEqual([png(1), png(2), png(3)]);
    expect(networksOf(db)[1].files).toEqual([PDF]);
    expect(mediaOf(db).map((m) => m.id)).toEqual([png(1), png(2), png(3), PDF]);
  });

  it("después de la primera vez, las redes que ya apuntan a los archivos del diseño se siguen actualizando solas", async () => {
    const db = world({
      pages: 2,
      networks: [
        { platform: "instagram", planned_at: null, format: "carousel", files: [] },
        { platform: "threads", planned_at: null, format: "carousel", files: [] },
      ],
      accounts: [],
    });
    await sync(db, { networks: ["threads"] });
    db.rows("designs")[0].doc = docWithPages("v45", 3);
    db.rows("designs")[0].rev = 8;
    const out = await sync(db);

    expect(out).toMatchObject({ status: "synced", networks: ["instagram", "threads"] });
    expect(networksOf(db)[1].files).toEqual([png(1), png(2), png(3)]);
  });
});

describe("design_content_sync: si la pieza cambió mientras se renderizaba", () => {
  it("lo que la persona guardó en el medio se conserva y los archivos se aplican igual", async () => {
    const db = world({ pages: 2 });
    const render = fakeRender();
    const racing = vi.fn(async (req: RenderRequest) => {
      // La persona guarda su caption y agrega una red mientras el servicio de render trabaja.
      const row = post(db);
      row.caption = "Lo que escribió la persona";
      row.networks = [...(row.networks as unknown[]), { platform: "tiktok", planned_at: null, format: "photos", files: [] }];
      row.updated_at = "2026-11-08T11:00:00Z";
      return render(req);
    });
    const out = await sync(db, {}, deps(racing as never));

    expect(out.status).toBe("synced");
    expect(post(db).caption).toBe("Lo que escribió la persona");
    expect(networksOf(db).map((n) => n.platform)).toEqual(["instagram", "tiktok"]);
    expect(networksOf(db)[0].files).toEqual([png(1), png(2)]);
  });
});

describe("design_content_sync: fallos del servicio de render (nunca lanza)", () => {
  it("sin el servicio configurado: lo dice y queda para reintentar (no reagenda solo)", async () => {
    const db = world({ pages: 2 });
    const d = deps(vi.fn(async () => { throw new RenderNotConfigured(); }) as never);
    const out = await sync(db, {}, d);

    expect(out).toEqual({ status: "failed", error: RENDER_NOT_CONFIGURED_MESSAGE });
    expect(d.schedule).not.toHaveBeenCalled();
    expect(mediaOf(db)).toEqual([]);
    expect(networksOf(db)[0].files).toEqual([]);
  });

  it("un fallo pasajero se reagenda a 1, 5 y 15 minutos, con la misma clave y contando los intentos", async () => {
    const db = world({ pages: 2 });
    const flaky = vi.fn(async () => { throw new RenderFailed("caído", { retryable: true }); });
    const waits: number[] = [];
    for (const retry of [0, 1, 2]) {
      const d = deps(flaky as never);
      const out = await runContentSync(db.client, { designId: DESIGN, retry }, d);
      expect(out.status).toBe("retry");
      const call = (d.schedule as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      waits.push((call[3] as Date).getTime() - NOW.getTime());
      expect(call[1]).toBe(DESIGN_CONTENT_SYNC_JOB);
      expect(call[2]).toMatchObject({ designId: DESIGN, retry: retry + 1 });
      expect(call[4]).toBe(`design_content_sync:${DESIGN}`);
    }
    expect(waits).toEqual([60_000, 300_000, 900_000]);
  });

  it("al cuarto fallo deja de reagendar y lo dice", async () => {
    const db = world({ pages: 2 });
    const d = deps(vi.fn(async () => { throw new RenderFailed("caído", { retryable: true }); }) as never);
    const out = await runContentSync(db.client, { designId: DESIGN, retry: 3 }, d);

    expect(out.status).toBe("failed");
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("un fallo que no es del servicio no se reintenta", async () => {
    const db = world({ pages: 2 });
    const d = deps(vi.fn(async () => { throw new RenderFailed("documento roto", { retryable: false }); }) as never);

    expect((await sync(db, {}, d)).status).toBe("failed");
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("un error inesperado no lanza hacia la cola: queda dicho", async () => {
    const db = world({ pages: 2 });
    const d = deps(vi.fn(async () => { throw new TypeError("raro"); }) as never);

    await expect(sync(db, {}, d)).resolves.toEqual({ status: "failed", error: "No se pudo armar el archivo." });
  });

  it("si no se pudo subir un archivo, se reintenta y la pieza no queda a medias", async () => {
    const db = world({ pages: 2 });
    db.failures.set("storage.upload", "bucket caído");
    const d = deps();
    const out = await sync(db, {}, d);

    expect(out.status).toBe("retry");
    expect(mediaOf(db)).toEqual([]);
    expect(networksOf(db)[0].files).toEqual([]);
  });

  it("un reintento que ya está agendado (23505) no es un error", async () => {
    const db = world({ pages: 2 });
    const d = { render: vi.fn(async () => { throw new RenderFailed("caído", { retryable: true }); }) as never, now: () => NOW, schedule: vi.fn(async () => { throw Object.assign(new Error("dup"), { code: "23505" }); }) as never };

    expect((await sync(db, {}, d)).status).toBe("retry");
  });
});

describe("design_content_sync: lo que no se sincroniza", () => {
  it("un pedido sin diseño", async () => {
    expect(await runContentSync(world().client, {})).toEqual({ status: "skipped", reason: "bad_payload" });
    expect(await runContentSync(world().client, { designId: 5 })).toEqual({ status: "skipped", reason: "bad_payload" });
  });

  it("un diseño que no existe, sin pieza, archivado o generación", async () => {
    expect(await runContentSync(world().client, { designId: "otro" })).toEqual({ status: "skipped", reason: "not_found" });
    expect(await sync(world({ design: { content_post_id: null } }))).toEqual({ status: "skipped", reason: "not_linked" });
    expect(await sync(world({ design: { template_id: "t" } }))).toEqual({ status: "skipped", reason: "not_linked" });
    expect(await sync(world({ design: { archived_at: "2026-11-01T00:00:00Z" } }))).toEqual({ status: "skipped", reason: "archived" });
  });

  it("una pieza que ya no existe, o una red que ya no está en la pieza", async () => {
    const gone = world();
    gone.tables.content_posts = [];
    expect(await sync(gone)).toEqual({ status: "skipped", reason: "post_missing" });
    expect(await sync(world({ networks: [{ platform: "tiktok", planned_at: null, format: "photos", files: [] }] }))).toEqual({ status: "skipped", reason: "network_missing" });
  });

  it("una pieza de otro negocio no se toca", async () => {
    const db = world();
    db.rows("content_posts")[0].workspace_id = "otro-negocio";

    expect(await sync(db)).toEqual({ status: "skipped", reason: "post_missing" });
  });

  it("un documento que no valida no se reintenta", async () => {
    const db = world({ design: { doc: { v: 1 } } });

    expect((await sync(db)).status).toBe("failed");
  });
});

describe("el id del archivo es el del bucket", () => {
  it("el id que queda en la biblioteca es el nombre del archivo subido, sin la extensión", async () => {
    const db = world({ pages: 2 });
    await sync(db);

    for (const entry of mediaOf(db)) expect(String(entry.storage_path)).toBe(path(String(entry.id)));
    expect(designFileId(DESIGN, "png", 2)).toBe(png(2));
  });
});
