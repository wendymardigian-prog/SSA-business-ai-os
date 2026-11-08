import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDoc } from "./doc/schema";
import { publishDesignCore, setPublicOptionsCore, unpublishDesignCore, type Actor, type PublishingDeps } from "./publishing";
import { servePageImage } from "./public/serve";
import { CODE, DESIGN, PNG, WS, publicDb, rpcDesign } from "./testing/public-fixtures";
import { MemoryDb, type Row } from "./testing/memory-db";

const MAIN = "https://app.principal.test";
const NOW = new Date("2026-11-07T12:00:00Z");
const USER = "99999999-2222-3333-4444-555555555555";
const actor: Actor = { workspaceId: WS, userId: USER };
const DOC = emptyDoc("v45");
const WEB_DOC = emptyDoc("web");
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", MAIN));

function seed(design: Row = {}, workspace: Row = {}): MemoryDb {
  return new MemoryDb({
    designs: [
      { id: DESIGN, workspace_id: WS, name: "Carrusel de lanzamiento", format: "v45", doc: DOC, template_id: null, code: CODE, published: false, allow_download: true, allow_indexing: false, published_at: null, status: "draft", archived_at: null, ...design },
    ],
    workspaces: [{ id: WS, scheduling_public_base_url: null, ...workspace }],
  });
}
function deps() {
  return { audit: vi.fn(async (..._args: unknown[]) => "a1" as string | null), enqueue: vi.fn(async (..._args: unknown[]) => undefined), now: () => NOW } satisfies PublishingDeps;
}
const design = (db: MemoryDb) => db.rows("designs")[0];

describe("publicar (F45)", () => {
  it("deja el diseño publicado y listo, guarda la versión «publish» y encola el render de todas las páginas", async () => {
    const db = seed();
    const d = deps();
    const out = await publishDesignCore(db.client, actor, { designId: DESIGN }, d);
    expect(out).toEqual({ ok: true, data: { link: `${MAIN}/d/${CODE}` } });
    expect(design(db)).toMatchObject({ published: true, status: "ready", published_at: NOW.toISOString(), allow_download: true });
    expect(db.rows("design_versions")).toEqual([expect.objectContaining({ design_id: DESIGN, workspace_id: WS, reason: "publish", author_kind: "user", author_id: USER, doc: DOC })]);
    expect(d.enqueue).toHaveBeenCalledWith(db.client, { designId: DESIGN, purpose: "publish" });
  });

  it("el link sale del dominio del negocio si lo tiene, y si no del principal", async () => {
    const own = await publishDesignCore(seed({}, { scheduling_public_base_url: "https://links.negocio.test" }).client, actor, { designId: DESIGN }, deps());
    expect(own).toEqual({ ok: true, data: { link: `https://links.negocio.test/d/${CODE}` } });
    const main = await publishDesignCore(seed().client, actor, { designId: DESIGN }, deps());
    expect(main).toEqual({ ok: true, data: { link: `${MAIN}/d/${CODE}` } });
  });

  it("guarda las opciones que elegiste al publicar", async () => {
    const db = seed();
    await publishDesignCore(db.client, actor, { designId: DESIGN, allowDownload: false }, deps());
    expect(design(db).allow_download).toBe(false);
  });

  it("una página web no se renderiza y puede aparecer en buscadores si se elige", async () => {
    const db = seed({ format: "web", doc: WEB_DOC });
    const d = deps();
    expect((await publishDesignCore(db.client, actor, { designId: DESIGN, allowIndexing: true }, d)).ok).toBe(true);
    expect(design(db)).toMatchObject({ published: true, allow_indexing: true });
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(db.rows("design_versions")).toHaveLength(1);
  });

  it("«aparecer en buscadores» solo existe en una página web: en otro formato se rechaza y no se escribe nada", async () => {
    const db = seed();
    const d = deps();
    const out = await publishDesignCore(db.client, actor, { designId: DESIGN, allowIndexing: true }, d);
    expect(out).toEqual({ ok: false, error: "Solo una página web puede aparecer en buscadores." });
    expect(db.log).toHaveLength(0);
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("publicar de nuevo lo ya publicado es «publicar los cambios»: no cambia la fecha, guarda otra versión y vuelve a renderizar", async () => {
    const db = seed({ published: true, status: "ready", published_at: "2026-10-01T00:00:00Z" });
    const d = deps();
    await publishDesignCore(db.client, actor, { designId: DESIGN }, d);
    expect(design(db).published_at).toBe("2026-10-01T00:00:00Z");
    expect(db.rows("design_versions")).toHaveLength(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ event: "design.republished" }) }));
  });

  it("un diseño archivado o anulado no se publica", async () => {
    expect((await publishDesignCore(seed({ archived_at: "2026-11-01T00:00:00Z" }).client, actor, { designId: DESIGN }, deps())).ok).toBe(false);
    expect((await publishDesignCore(seed({ status: "void", template_id: "t1" }).client, actor, { designId: DESIGN }, deps())).ok).toBe(false);
  });

  it("un diseño de OTRO negocio es «no existe»: no se lee, no se escribe", async () => {
    const db = seed({ workspace_id: "99999999-0000-0000-0000-000000000000" });
    const d = deps();
    expect(await publishDesignCore(db.client, actor, { designId: DESIGN }, d)).toEqual({ ok: false, error: "No encontramos ese diseño." });
    expect(db.log).toHaveLength(0);
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("una generación se publica sin tocar su estado, sin versión y sin volver a renderizar", async () => {
    const db = seed({ template_id: "t1", status: "ready", format: "carta_h" });
    const d = deps();
    expect((await publishDesignCore(db.client, actor, { designId: DESIGN }, d)).ok).toBe(true);
    expect(design(db)).toMatchObject({ published: true, status: "ready" });
    expect(db.rows("design_versions")).toHaveLength(0);
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("si no se puede escribir, no se guarda versión ni se encola, y se dice claro", async () => {
    const db = seed();
    db.failures.set("designs.update", "caída");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps();
    expect(await publishDesignCore(db.client, actor, { designId: DESIGN }, d)).toEqual({ ok: false, error: "No se pudo publicar. Probá de nuevo." });
    expect(db.rows("design_versions")).toHaveLength(0);
    expect(d.enqueue).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("si falla la versión o la cola, igual queda publicado (el link dice «se está preparando»)", async () => {
    const db = seed();
    db.failures.set("design_versions.insert", "caída");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps();
    d.enqueue.mockRejectedValueOnce(new Error("cola caída"));
    expect((await publishDesignCore(db.client, actor, { designId: DESIGN }, d)).ok).toBe(true);
    expect(design(db).published).toBe(true);
    spy.mockRestore();
  });

  it("queda en el historial con el actor y sin el código ni datos de más", async () => {
    const db = seed();
    const d = deps();
    await publishDesignCore(db.client, actor, { designId: DESIGN }, d);
    expect(d.audit).toHaveBeenCalledTimes(1);
    const call = d.audit.mock.calls[0][0] as { changes: unknown; metadata: unknown; [key: string]: unknown };
    expect(call).toMatchObject({ workspaceId: WS, entityType: "design", entityId: DESIGN, action: "design.published", performedBy: USER });
    expect(call.metadata).toEqual({ event: "design.published", format: "v45", kind: "design" });
    expect(call.changes).toEqual({ published: { old: false, new: true } });
    expect(JSON.stringify({ changes: call.changes, metadata: call.metadata })).not.toContain(CODE);
  });
});

describe("despublicar (F45)", () => {
  it("el diseño deja de estar publicado, vuelve a borrador y conserva su código y su fecha", async () => {
    const db = seed({ published: true, status: "ready", published_at: "2026-10-01T00:00:00Z" });
    const d = deps();
    expect(await unpublishDesignCore(db.client, actor, { designId: DESIGN }, d)).toEqual({ ok: true, data: undefined });
    expect(design(db)).toMatchObject({ published: false, status: "draft", code: CODE, published_at: "2026-10-01T00:00:00Z" });
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ event: "design.unpublished" }) }));
  });

  it("una generación despublicada conserva su estado", async () => {
    const db = seed({ template_id: "t1", published: true, status: "ready" });
    await unpublishDesignCore(db.client, actor, { designId: DESIGN }, deps());
    expect(design(db)).toMatchObject({ published: false, status: "ready" });
  });

  it("despublicar algo que no está publicado no hace nada", async () => {
    const db = seed();
    const d = deps();
    expect((await unpublishDesignCore(db.client, actor, { designId: DESIGN }, d)).ok).toBe(true);
    expect(db.log).toHaveLength(0);
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("un diseño de otro negocio no se toca", async () => {
    const db = seed({ published: true, workspace_id: "99999999-0000-0000-0000-000000000000" });
    expect((await unpublishDesignCore(db.client, actor, { designId: DESIGN }, deps())).ok).toBe(false);
    expect(design(db).published).toBe(true);
  });

  it("después de despublicar, el link responde 404 en el SIGUIENTE pedido (y el código sigue siendo el mismo)", async () => {
    // El estado público se modela como lo hace `design_public_get` para un diseño propio: solo si está publicado.
    const { db } = publicDb();
    db.rows("designs")[0].published = true;
    db.rows("designs")[0].format = "carta_h";
    db.rpcs.design_public_get = () => (db.rows("designs")[0].published ? rpcDesign() : null);
    const request = () => new Request(`https://links.test/d/${CODE}/p/1`, { headers: { "x-real-ip": "203.0.113.9" } });
    const quick = { notFound: async () => new Response(null, { status: 404 }) };

    const before = await servePageImage(db.client, request(), CODE, "1", quick);
    expect(before.status).toBe(200);
    expect(new Uint8Array(await before.arrayBuffer())).toEqual(PNG);

    db.rows("designs")[0].doc = emptyDoc("carta_h");
    db.rows("designs")[0].status = "ready";
    db.rows("designs")[0].name = "Diseño";
    db.rows("designs")[0].workspace_id = WS;
    const out = await unpublishDesignCore(db.client, actor, { designId: DESIGN }, deps());
    expect(out.ok).toBe(true);

    expect((await servePageImage(db.client, request(), CODE, "1", quick)).status).toBe(404);
    expect(db.rows("designs")[0].code).toBe(CODE);
  });
});

describe("opciones del link", () => {
  it("permitir o no la descarga", async () => {
    const db = seed({ published: true });
    const d = deps();
    expect((await setPublicOptionsCore(db.client, actor, { designId: DESIGN, allowDownload: false }, d)).ok).toBe(true);
    expect(design(db).allow_download).toBe(false);
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ changes: { allow_download: { old: true, new: false } }, metadata: expect.objectContaining({ event: "design.options_changed" }) }));
  });

  it("buscadores: solo una página web", async () => {
    const web = seed({ format: "web", doc: WEB_DOC });
    expect((await setPublicOptionsCore(web.client, actor, { designId: DESIGN, allowIndexing: true }, deps())).ok).toBe(true);
    expect(design(web).allow_indexing).toBe(true);
    const other = seed();
    expect(await setPublicOptionsCore(other.client, actor, { designId: DESIGN, allowIndexing: true }, deps())).toEqual({ ok: false, error: "Solo una página web puede aparecer en buscadores." });
    expect(design(other).allow_indexing).toBe(false);
  });

  it("sin cambios no escribe ni anota nada", async () => {
    const db = seed({ published: true });
    const d = deps();
    await setPublicOptionsCore(db.client, actor, { designId: DESIGN, allowDownload: true }, d);
    await setPublicOptionsCore(db.client, actor, { designId: DESIGN }, d);
    expect(db.log).toHaveLength(0);
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("apagar buscadores en una web se guarda", async () => {
    const db = seed({ format: "web", doc: WEB_DOC, allow_indexing: true });
    await setPublicOptionsCore(db.client, actor, { designId: DESIGN, allowIndexing: false }, deps());
    expect(design(db).allow_indexing).toBe(false);
  });
});
