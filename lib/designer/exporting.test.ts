import { describe, expect, it, vi } from "vitest";
import { emptyDoc, type DesignDoc } from "./doc/schema";
import { EXPORT_FAILED, EXPORT_LINK_SECONDS, exportStatusCore, requestExportCore, type ExportDeps } from "./exporting";
import { EXPORT_GIVE_UP_MS, isValidExportStamp, newExportStamp } from "./export";
import { runDesignRender } from "./jobs/render";
import { RenderNotConfigured, RENDER_NOT_CONFIGURED_MESSAGE, type RenderRequest } from "./render-client";
import { exportFolder } from "./storage";
import { MemoryDb, type Row } from "./testing/memory-db";

const WS = "11111111-2222-3333-4444-555555555555";
const OTHER_WS = "99999999-2222-3333-4444-555555555555";
const DESIGN = "aaaaaaaa-2222-3333-4444-555555555555";
const TEMPLATE = "bbbbbbbb-2222-3333-4444-555555555555";
const NOW = new Date("2026-11-07T12:00:00Z");
const actor = { workspaceId: WS };

function docWith(format: Parameters<typeof emptyDoc>[0], pages: number): DesignDoc {
  const doc = emptyDoc(format);
  for (let i = 1; i < pages; i++) doc.pages.push({ ...doc.pages[0], id: `pg_extra${i}` });
  return doc;
}

function seed(extra: { design?: Row; template?: Row } = {}): MemoryDb {
  return new MemoryDb({
    designs: [{ id: DESIGN, workspace_id: WS, name: "Certificado · Ana Pérez", doc: docWith("carta_h", 3), format: "carta_h", code: "K8F2-WQ4M-7TQA", rev: 1, values: {}, template_id: null, renders: {}, attempts: 0, ...extra.design }],
    design_templates: [{ id: TEMPLATE, workspace_id: WS, name: "Plantilla de constancia", doc: docWith("a4_v", 1), custom_vars: [], ...extra.template }],
    workspaces: [{ id: WS, design_settings: {}, name: "Academia Ejemplo", brand_name: null }],
  });
}

const deps = (extra: ExportDeps = {}) => ({ enqueue: vi.fn(async (..._args: unknown[]) => undefined), now: () => NOW, random: () => 0.42, renderConfigured: () => true, ...extra }) satisfies ExportDeps;
type Payload = { designId?: string; templateId?: string; purpose: string; exportKind: string; page?: number; stamp: string };
const payloadOf = (d: { enqueue: unknown }) => (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][1] as Payload;

describe("pedir una exportación (F46)", () => {
  it("PDF de un diseño: encola un design_render de exportación con su marca y devuelve «preparando»", async () => {
    const db = seed();
    const d = deps();
    const out = await requestExportCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "pdf" }, d);
    expect(out).toMatchObject({ ok: true, data: { status: "preparing" } });
    const stamp = out.ok && out.data.status === "preparing" ? out.data.stamp : "";
    expect(isValidExportStamp(stamp)).toBe(true);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(payloadOf(d)).toEqual({ designId: DESIGN, purpose: "export", exportKind: "pdf", stamp });
  });

  it("ZIP, y PNG con la página pedida o la primera", async () => {
    const zip = deps();
    await requestExportCore(seed().client, actor, { kind: "design", id: DESIGN, exportKind: "zip" }, zip);
    expect(payloadOf(zip)).toMatchObject({ exportKind: "zip" });
    expect(payloadOf(zip).page).toBeUndefined();

    const third = deps();
    await requestExportCore(seed().client, actor, { kind: "design", id: DESIGN, exportKind: "png", page: 2 }, third);
    expect(payloadOf(third)).toMatchObject({ exportKind: "png", page: 2 });

    const first = deps();
    await requestExportCore(seed().client, actor, { kind: "design", id: DESIGN, exportKind: "png" }, first);
    expect(payloadOf(first)).toMatchObject({ exportKind: "png", page: 0 });
  });

  it("una plantilla exporta una PRUEBA: el pedido lleva la plantilla, no un diseño, y no se crea ninguna generación ni link", async () => {
    const db = seed();
    const d = deps();
    const out = await requestExportCore(db.client, actor, { kind: "template", id: TEMPLATE, exportKind: "pdf" }, d);
    expect(out.ok).toBe(true);
    expect(payloadOf(d)).toMatchObject({ templateId: TEMPLATE, purpose: "export", exportKind: "pdf" });
    expect(payloadOf(d).designId).toBeUndefined();
    expect(db.log.filter((entry) => entry.op !== "update" || entry.table === "designs")).toEqual([]);
    expect(db.rows("designs")).toHaveLength(1);
  });

  it("el pedido queda en la cola con una clave que evita pedir lo mismo dos veces", async () => {
    const db = seed();
    const out = await requestExportCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "pdf" }, { now: () => NOW, random: () => 0.42, renderConfigured: () => true });
    const stamp = out.ok && out.data.status === "preparing" ? out.data.stamp : "";
    expect(db.rows("scheduled_jobs")).toEqual([expect.objectContaining({ type: "design_render", dedupe_key: `design_render:${DESIGN}:export:${stamp}`, payload: { designId: DESIGN, purpose: "export", exportKind: "pdf", stamp } })]);
  });

  it("una página web no se exporta", async () => {
    const d = deps();
    const out = await requestExportCore(seed({ design: { doc: emptyDoc("web"), format: "web" } }).client, actor, { kind: "design", id: DESIGN, exportKind: "pdf" }, d);
    expect(out).toEqual({ ok: false, error: "Una página web se comparte con su link" });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("sin el servicio de render: «Falta conectar el servicio de render»", async () => {
    const d = deps({ renderConfigured: () => false });
    expect(await requestExportCore(seed().client, actor, { kind: "design", id: DESIGN, exportKind: "pdf" }, d)).toEqual({ ok: false, error: "Falta conectar el servicio de render" });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("una página que no existe, un tipo raro, un documento roto o una cola caída se dicen claro", async () => {
    const run = (input: Parameters<typeof requestExportCore>[2], db = seed(), d = deps()) => requestExportCore(db.client, actor, input, d);
    expect(await run({ kind: "design", id: DESIGN, exportKind: "png", page: 9 })).toEqual({ ok: false, error: "Esa página no existe en este diseño" });
    expect((await run({ kind: "design", id: DESIGN, exportKind: "exe" as never })).ok).toBe(false);
    expect((await run({ kind: "design", id: DESIGN, exportKind: "pdf" }, seed({ design: { doc: { v: 1 } } }))).ok).toBe(false);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = deps({ enqueue: vi.fn(async () => Promise.reject(new Error("cola caída"))) });
    expect(await run({ kind: "design", id: DESIGN, exportKind: "pdf" }, seed(), broken)).toEqual({ ok: false, error: "No se pudo preparar el archivo. Probá de nuevo." });
    spy.mockRestore();
  });

  it("un diseño de OTRO negocio es «no existe»", async () => {
    const d = deps();
    const out = await requestExportCore(seed({ design: { workspace_id: OTHER_WS } }).client, actor, { kind: "design", id: DESIGN, exportKind: "pdf" }, d);
    expect(out).toEqual({ ok: false, error: "No encontramos ese diseño." });
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});

describe("seguir una exportación (F46)", () => {
  const stamp = newExportStamp(NOW, () => 0.42);
  const folder = exportFolder(WS, DESIGN, stamp);
  const status = (db: MemoryDb, input: Partial<Parameters<typeof exportStatusCore>[2]> = {}, at = NOW) =>
    exportStatusCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "pdf", stamp, ...input }, { now: () => at });

  it("mientras no hay archivo: «preparando»", async () => {
    expect(await status(seed())).toEqual({ ok: true, data: { status: "preparing", stamp } });
  });

  it("con el archivo: un link firmado de corta duración con un nombre legible", async () => {
    const db = seed();
    db.put("design-renders", `${folder}/document.pdf`, new Uint8Array([37]), "application/pdf");
    const out = await status(db);
    expect(out).toMatchObject({ ok: true, data: { status: "ready", fileName: "certificado-ana-perez.pdf" } });
    const url = out.ok && out.data.status === "ready" ? out.data.url : "";
    expect(url).toContain(`ttl=${EXPORT_LINK_SECONDS}`);
    expect(url).toContain("download=certificado-ana-perez.pdf");
    expect(EXPORT_LINK_SECONDS).toBeLessThanOrEqual(300);
  });

  it("el ZIP y la página de un PNG se llaman como corresponde", async () => {
    const db = seed();
    db.put("design-renders", `${folder}/imagenes.zip`, new Uint8Array([1]), "application/zip");
    db.put("design-renders", `${folder}/page-03.png`, new Uint8Array([1]), "image/png");
    expect(await status(db, { exportKind: "zip" })).toMatchObject({ ok: true, data: { status: "ready", fileName: "certificado-ana-perez-imagenes.zip" } });
    expect(await status(db, { exportKind: "png", page: 2 })).toMatchObject({ ok: true, data: { status: "ready", fileName: "certificado-ana-perez-pagina-3.png" } });
    // Otro tipo o otra página de la misma carpeta todavía no está.
    expect(await status(db, { exportKind: "png", page: 0 })).toMatchObject({ ok: true, data: { status: "preparing" } });
  });

  it("una exportación que falla del todo deja error.json y se devuelve el motivo en vez de quedar «preparando» para siempre", async () => {
    const db = seed();
    db.put("design-renders", `${folder}/error.json`, new TextEncoder().encode(JSON.stringify({ error: "No se pudieron preparar las imágenes del diseño.", at: NOW.toISOString() })), "application/json");
    expect(await status(db)).toEqual({ ok: false, error: "No se pudieron preparar las imágenes del diseño." });
  });

  it("un error.json ilegible dice «No se pudo armar el archivo»", async () => {
    const db = seed();
    db.put("design-renders", `${folder}/error.json`, new TextEncoder().encode("{no es json"), "application/json");
    expect(await status(db)).toEqual({ ok: false, error: EXPORT_FAILED });
    expect(EXPORT_FAILED).toMatch(/^No se pudo armar el archivo/);
  });

  it("si el archivo está, gana sobre un error viejo", async () => {
    const db = seed();
    db.put("design-renders", `${folder}/error.json`, new TextEncoder().encode(JSON.stringify({ error: "viejo" })), "application/json");
    db.put("design-renders", `${folder}/document.pdf`, new Uint8Array([37]), "application/pdf");
    expect(await status(db)).toMatchObject({ ok: true, data: { status: "ready" } });
  });

  it("pasado todo lo que reintenta el job sin archivo ni motivo, deja de esperar", async () => {
    const db = seed();
    const justBefore = new Date(NOW.getTime() + EXPORT_GIVE_UP_MS - 1000);
    const after = new Date(NOW.getTime() + EXPORT_GIVE_UP_MS + 1000);
    expect(await status(db, {}, justBefore)).toMatchObject({ ok: true, data: { status: "preparing" } });
    expect(await status(db, {}, after)).toEqual({ ok: false, error: EXPORT_FAILED });
  });

  it("una marca que no es nuestra (una ruta, por ejemplo) se rechaza sin tocar el almacenamiento", async () => {
    const db = seed();
    for (const bad of ["../otro", `${stamp}/../..`, "", "1/2", "a".repeat(80)]) expect(await status(db, { stamp: bad })).toEqual({ ok: false, error: "El pedido no es válido." });
    expect(db.storageLog).toEqual([]);
  });

  it("una pieza de OTRO negocio: nunca se mira su carpeta", async () => {
    const db = seed({ design: { workspace_id: OTHER_WS } });
    db.put("design-renders", `${OTHER_WS}/${DESIGN}/exports/${stamp}/document.pdf`, new Uint8Array([37]), "application/pdf");
    expect(await status(db)).toEqual({ ok: false, error: "No encontramos ese diseño." });
  });

  it("una prueba de plantilla se busca en la carpeta de la plantilla", async () => {
    const db = seed();
    db.put("design-renders", `${exportFolder(WS, TEMPLATE, stamp)}/document.pdf`, new Uint8Array([37]), "application/pdf");
    expect(await status(db, { kind: "template", id: TEMPLATE })).toMatchObject({ ok: true, data: { status: "ready", fileName: "plantilla-de-constancia.pdf" } });
  });
});

describe("de punta a punta con el job de render (simulado)", () => {
  const render = vi.fn(async (req: RenderRequest) => ({
    version: "t",
    files: req.format === "pdf" ? [{ page: 0, contentType: "application/pdf" as const, bytes: new Uint8Array([37]) }] : (req.pages ?? [{ html: req.html! }]).map((_p, page) => ({ page, contentType: "image/png" as const, bytes: new Uint8Array([1]) })),
  }));

  it("pedir → el job exporta → el estado da el link", async () => {
    const db = seed();
    const requested = await requestExportCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "zip" }, { now: () => NOW, random: () => 0.42, renderConfigured: () => true });
    const payload = db.rows("scheduled_jobs")[0].payload as never;
    expect((await exportStatusCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "zip", stamp: (requested.ok && requested.data.status === "preparing" && requested.data.stamp) || "" }, { now: () => NOW })).ok).toBe(true);

    await runDesignRender(db.client, payload, { render, now: () => NOW, schedule: vi.fn() });
    const after = await exportStatusCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "zip", stamp: (payload as { stamp: string }).stamp }, { now: () => NOW });
    expect(after).toMatchObject({ ok: true, data: { status: "ready", fileName: "certificado-ana-perez-imagenes.zip" } });
  });

  it("si el servicio no está, el job deja el motivo y el estado lo devuelve (no queda «preparando»)", async () => {
    const db = seed();
    const requested = await requestExportCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "pdf" }, { now: () => NOW, random: () => 0.42, renderConfigured: () => true });
    const payload = db.rows("scheduled_jobs")[0].payload as { stamp: string };
    expect(requested.ok).toBe(true);
    await runDesignRender(db.client, payload as never, { render: async () => Promise.reject(new RenderNotConfigured()), now: () => NOW, schedule: vi.fn() });
    expect(await exportStatusCore(db.client, actor, { kind: "design", id: DESIGN, exportKind: "pdf", stamp: payload.stamp }, { now: () => NOW })).toEqual({ ok: false, error: RENDER_NOT_CONFIGURED_MESSAGE });
  });

  it("«Exportar prueba» de una plantilla: el job usa datos de ejemplo y deja el archivo en la carpeta de la plantilla, sin crear un diseño", async () => {
    const db = seed();
    await requestExportCore(db.client, actor, { kind: "template", id: TEMPLATE, exportKind: "pdf" }, { now: () => NOW, random: () => 0.42, renderConfigured: () => true });
    const payload = db.rows("scheduled_jobs")[0].payload as { stamp: string };
    await runDesignRender(db.client, payload as never, { render, now: () => NOW, schedule: vi.fn() });
    expect(db.paths("design-renders")).toEqual([`${exportFolder(WS, TEMPLATE, payload.stamp)}/document.pdf`]);
    expect(db.rows("designs")).toHaveLength(1);
    expect(await exportStatusCore(db.client, actor, { kind: "template", id: TEMPLATE, exportKind: "pdf", stamp: payload.stamp }, { now: () => NOW })).toMatchObject({ ok: true, data: { status: "ready" } });
  });
});
